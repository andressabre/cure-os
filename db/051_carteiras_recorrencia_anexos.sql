-- =====================================================================
-- CURE OS — Migração 051: Carteiras (empresa × pessoal dos sócios),
-- recorrência fixa/média com reajuste anual, fatura confirmada e anexos.
-- Pessoal: visível só a gestores (os sócios); perfil "financeiro" vê só a empresa.
-- =====================================================================

create table if not exists carteiras (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  nome text not null,
  tipo text not null default 'empresa' check (tipo in ('empresa','pessoal')),
  ordem int not null default 100,
  ativo boolean not null default true,
  unique (clinica_id, nome)
);
create unique index if not exists carteira_empresa_unica on carteiras (clinica_id) where tipo = 'empresa';

insert into carteiras (clinica_id, nome, tipo, ordem)
select id, nome, 'empresa', 1 from clinicas on conflict do nothing;

-- true se a carteira é pessoal (usado na RLS; DEFINER para não depender da RLS de carteiras)
create or replace function carteira_pessoal(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select tipo = 'pessoal' from carteiras where id = p), false);
$$;
revoke execute on function carteira_pessoal(uuid) from public, anon;
grant execute on function carteira_pessoal(uuid) to authenticated;

alter table contas_financeiras add column if not exists carteira_id uuid references carteiras;
alter table categorias_financeiras add column if not exists uso text not null default 'empresa'
  check (uso in ('empresa','pessoal'));
alter table lancamentos
  add column if not exists carteira_id uuid references carteiras,
  add column if not exists recorrencia text check (recorrencia in ('fixa','media')),
  add column if not exists media_meses int check (media_meses between 1 and 12),
  add column if not exists reajuste_mes int check (reajuste_mes between 1 and 12),
  add column if not exists valor_confirmado boolean not null default false,   -- fatura chegou / valor real conhecido
  add column if not exists fatura_arquivo text,                               -- caminho no bucket financeiro
  add column if not exists comprovante_arquivo text;
create index if not exists lanc_carteira_venc on lancamentos (carteira_id, vencimento);
create index if not exists lanc_serie on lancamentos (serie_id) where serie_id is not null;

-- Sem carteira informada → carteira da empresa (repasse, lote, particular, contas antigas)
create or replace function carteira_padrao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.carteira_id is null then
    select id into new.carteira_id from carteiras where clinica_id = new.clinica_id and tipo = 'empresa';
  end if;
  return new;
end $$;
revoke execute on function carteira_padrao() from public, anon, authenticated;
drop trigger if exists lanc_carteira_padrao on lancamentos;
create trigger lanc_carteira_padrao before insert on lancamentos for each row execute function carteira_padrao();
drop trigger if exists conta_carteira_padrao on contas_financeiras;
create trigger conta_carteira_padrao before insert on contas_financeiras for each row execute function carteira_padrao();
update lancamentos l set carteira_id = c.id from carteiras c where l.carteira_id is null and c.clinica_id = l.clinica_id and c.tipo = 'empresa';
update contas_financeiras l set carteira_id = c.id from carteiras c where l.carteira_id is null and c.clinica_id = l.clinica_id and c.tipo = 'empresa';

-- Recorrência "média": ao confirmar/pagar uma conta, os meses futuros ainda não confirmados
-- da mesma série passam a prever a média dos últimos N valores reais.
create or replace function reprojetar_media() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_media numeric;
begin
  if new.serie_id is null or new.recorrencia is distinct from 'media' then return new; end if;
  if not (new.valor_confirmado or new.status = 'pago') then return new; end if;
  select round(avg(v), 2) into v_media from (
    select coalesce(valor_realizado, valor_previsto) v from lancamentos
    where serie_id = new.serie_id and status <> 'cancelado' and (valor_confirmado or status = 'pago')
    order by vencimento desc limit coalesce(new.media_meses, 3)) t;
  if v_media is not null then
    update lancamentos set valor_previsto = v_media
    where serie_id = new.serie_id and status = 'previsto' and not valor_confirmado
      and vencimento > new.vencimento and valor_previsto is distinct from v_media;
  end if;
  return new;
end $$;
revoke execute on function reprojetar_media() from public, anon, authenticated;
drop trigger if exists lanc_reprojetar_media on lancamentos;
create trigger lanc_reprojetar_media after insert or update of valor_previsto, valor_realizado, status, valor_confirmado
  on lancamentos for each row when (pg_trigger_depth() < 1) execute function reprojetar_media();

-- RLS: empresa = gestor/financeiro; pessoal = só gestor
alter table carteiras enable row level security;
drop policy if exists ver_carteiras on carteiras;
create policy ver_carteiras on carteiras for select to authenticated
  using (meu_perfil(clinica_id) = 'gestor' or (meu_perfil(clinica_id) = 'financeiro' and tipo = 'empresa'));
drop policy if exists gerir_carteiras on carteiras;
create policy gerir_carteiras on carteiras for all to authenticated
  using (meu_perfil(clinica_id) = 'gestor') with check (meu_perfil(clinica_id) = 'gestor');

do $$
declare t text;
begin
  foreach t in array array['contas_financeiras','lancamentos'] loop
    execute format('drop policy if exists gestao_%1$s on %1$I', t);
    execute format($p$create policy gestao_%1$s on %1$I for all to authenticated
      using (meu_perfil(clinica_id) = 'gestor' or (meu_perfil(clinica_id) = 'financeiro' and not carteira_pessoal(carteira_id)))
      with check (meu_perfil(clinica_id) = 'gestor' or (meu_perfil(clinica_id) = 'financeiro' and not carteira_pessoal(carteira_id)))$p$, t);
  end loop;
end $$;
grant select, insert, update, delete on carteiras to authenticated;

-- Categorias da casa (uso pessoal; não entram na DRE da empresa)
insert into categorias_financeiras (clinica_id, tipo, grupo_dre, nome, ordem, uso)
select c.id, 'despesa', 'despesa_operacional', n, o, 'pessoal' from clinicas c, (values
  ('Casa – aluguel/condomínio',200),('Casa – energia',201),('Casa – água',202),('Casa – IPTU',203),
  ('Casa – taxa de lixo',204),('Casa – internet e telefone',205),('Casa – saúde',206),('Casa – educação',207),
  ('Casa – transporte',208),('Casa – outras',209)) v(n,o)
on conflict (clinica_id, nome) do nothing;

-- Storage: faturas e comprovantes. Caminho <clinica>/<empresa|pessoal>/<lancamento>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit)
values ('financeiro', 'financeiro', false, 5242880) on conflict (id) do nothing;
create or replace function pasta_financeiro_ok(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$' then coalesce(
    case split_part(p_nome, '/', 2)
      when 'pessoal' then meu_perfil(split_part(p_nome, '/', 1)::uuid)::text = 'gestor'
      when 'empresa' then meu_perfil(split_part(p_nome, '/', 1)::uuid)::text in ('gestor','financeiro')
      else false end, false) else false end;
$$;
revoke execute on function pasta_financeiro_ok(text) from public, anon;
grant execute on function pasta_financeiro_ok(text) to authenticated;
drop policy if exists financeiro_ler on storage.objects;
create policy financeiro_ler on storage.objects for select to authenticated
  using (bucket_id = 'financeiro' and pasta_financeiro_ok(name));
drop policy if exists financeiro_enviar on storage.objects;
create policy financeiro_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'financeiro' and pasta_financeiro_ok(name));
drop policy if exists financeiro_apagar on storage.objects;
create policy financeiro_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'financeiro' and pasta_financeiro_ok(name));
