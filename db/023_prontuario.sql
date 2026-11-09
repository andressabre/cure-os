-- =====================================================================
-- CURE OS — Migração 023: PRONTUÁRIO
-- Decisões da gestora (09/11/2026):
--  • Sigilo: cada profissional lê SÓ o que ele escreveu. Nem gestão, nem recepção,
--    nem financeiro veem conteúdo clínico (RLS por autor, sem exceção de perfil).
--  • Modelo por área + campo livre: nutrição SOAPN; fisio avaliação + evolução;
--    psicologia registro documental (Res. CFP 001/2009); livre.
--  • Assinado = imutável (trigger). Correção só por ADENDO datado. Assinado não se apaga
--    (guarda mínima de 20 anos — Lei 13.787/2018).
--  • Anexos em bucket próprio "prontuario", invisível para gestão/recepção.
--  • Importação dos .txt do sistema antigo: cada profissional importa os SEUS.
-- =====================================================================

create table if not exists prontuario_registros (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete restrict,
  paciente_id uuid not null references pacientes on delete restrict,
  profissional_id uuid not null references profissionais on delete restrict,
  atendimento_id uuid references atendimentos on delete set null,
  area text not null check (area in ('nutricao','fisioterapia','psicologia','outra')),
  modelo text not null check (modelo in ('soapn','fisio_avaliacao','fisio_evolucao','psico_registro','livre')),
  data_registro date not null default current_date,
  conteudo jsonb not null default '{}',
  status text not null default 'rascunho' check (status in ('rascunho','assinado')),
  assinado_em timestamptz,
  hash_assinatura text,
  origem text not null default 'cure_os' check (origem in ('cure_os','sistema_antigo')),
  origem_arquivo text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists prontuario_reg_pac on prontuario_registros (paciente_id, profissional_id, data_registro desc);
create unique index if not exists prontuario_reg_arquivo on prontuario_registros (clinica_id, profissional_id, origem_arquivo)
  where origem_arquivo is not null;   -- reimportar o mesmo .txt não duplica

create table if not exists prontuario_adendos (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references prontuario_registros on delete restrict,
  clinica_id uuid not null references clinicas on delete restrict,
  profissional_id uuid not null references profissionais on delete restrict,
  texto text not null check (length(trim(texto)) > 0),
  criado_em timestamptz not null default now()
);

create table if not exists prontuario_anexos (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references prontuario_registros on delete restrict,
  clinica_id uuid not null references clinicas on delete restrict,
  profissional_id uuid not null references profissionais on delete restrict,
  arquivo text not null,
  nome text,
  criado_em timestamptz not null default now()
);

-- Imutabilidade e carimbo de assinatura
create or replace function prontuario_trava() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'assinado' then raise exception 'Registro assinado não pode ser apagado (guarda legal de 20 anos).'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'assinado' then raise exception 'Registro assinado não pode ser alterado. Use um adendo.'; end if;
    if new.clinica_id <> old.clinica_id or new.paciente_id <> old.paciente_id or new.profissional_id <> old.profissional_id then
      raise exception 'Não é permitido trocar paciente, profissional ou clínica do registro.'; end if;
  end if;
  new.atualizado_em := now();
  if new.status = 'assinado' then
    new.assinado_em := now();
    new.hash_assinatura := encode(sha256(convert_to(
      new.paciente_id::text || '|' || new.profissional_id::text || '|' || new.data_registro::text || '|' || new.modelo || '|' || new.conteudo::text, 'UTF8')), 'hex');
  end if;
  return new;
end $$;
drop trigger if exists prontuario_trava on prontuario_registros;
create trigger prontuario_trava before insert or update or delete on prontuario_registros
  for each row execute function prontuario_trava();

-- RLS: só o autor, qualquer perfil (a gestora vê o próprio como profissional)
alter table prontuario_registros enable row level security;
alter table prontuario_adendos enable row level security;
alter table prontuario_anexos enable row level security;

drop policy if exists pr_ler on prontuario_registros;
create policy pr_ler on prontuario_registros for select to authenticated
  using (profissional_id = meu_profissional(clinica_id));
drop policy if exists pr_criar on prontuario_registros;
create policy pr_criar on prontuario_registros for insert to authenticated
  with check (profissional_id = meu_profissional(clinica_id)
    and exists (select 1 from pacientes p where p.id = paciente_id and p.clinica_id = prontuario_registros.clinica_id));
drop policy if exists pr_editar on prontuario_registros;
create policy pr_editar on prontuario_registros for update to authenticated
  using (profissional_id = meu_profissional(clinica_id)) with check (profissional_id = meu_profissional(clinica_id));
drop policy if exists pr_apagar on prontuario_registros;
create policy pr_apagar on prontuario_registros for delete to authenticated
  using (profissional_id = meu_profissional(clinica_id) and status = 'rascunho');

-- Adendos: só criar e ler (sem update/delete = imutável); só em registro assinado do próprio autor
drop policy if exists pa_ler on prontuario_adendos;
create policy pa_ler on prontuario_adendos for select to authenticated using (profissional_id = meu_profissional(clinica_id));
drop policy if exists pa_criar on prontuario_adendos;
create policy pa_criar on prontuario_adendos for insert to authenticated
  with check (profissional_id = meu_profissional(clinica_id) and exists (select 1 from prontuario_registros r
    where r.id = registro_id and r.profissional_id = prontuario_adendos.profissional_id and r.status = 'assinado'));

drop policy if exists px_ler on prontuario_anexos;
create policy px_ler on prontuario_anexos for select to authenticated using (profissional_id = meu_profissional(clinica_id));
drop policy if exists px_criar on prontuario_anexos;
create policy px_criar on prontuario_anexos for insert to authenticated
  with check (profissional_id = meu_profissional(clinica_id) and exists (select 1 from prontuario_registros r
    where r.id = registro_id and r.profissional_id = prontuario_anexos.profissional_id));

-- O profissional passa a enxergar o cadastro dos pacientes que têm prontuário dele
-- (necessário para os importados do sistema antigo sem atendimento no Cure OS)
drop policy if exists prof_pacientes_prontuario on pacientes;
create policy prof_pacientes_prontuario on pacientes for select to authenticated
  using (exists (select 1 from prontuario_registros r where r.paciente_id = pacientes.id
    and r.profissional_id = meu_profissional(pacientes.clinica_id)));

-- Bucket próprio: <clinica_id>/<profissional_id>/<paciente_id>/<arquivo>; só o autor lê/envia; ninguém apaga
insert into storage.buckets (id, name, public, file_size_limit)
values ('prontuario', 'prontuario', false, 10485760) on conflict (id) do nothing;
create or replace function pasta_prontuario_ok(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$' and split_part(p_nome, '/', 2) ~ '^[0-9a-f-]{36}$'
    then meu_profissional(split_part(p_nome, '/', 1)::uuid) = split_part(p_nome, '/', 2)::uuid else false end;
$$;
drop policy if exists prontuario_ler on storage.objects;
create policy prontuario_ler on storage.objects for select to authenticated
  using (bucket_id = 'prontuario' and pasta_prontuario_ok(name));
drop policy if exists prontuario_enviar on storage.objects;
create policy prontuario_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'prontuario' and pasta_prontuario_ok(name));

-- Importação do sistema antigo: resolve o paciente pelo ID antigo SEM expor o cadastro;
-- grava assinado (histórico), autoria = quem está logado. Idempotente pelo nome do arquivo.
create or replace function importar_prontuario_antigo(p_clinica uuid, p_origem_id text, p_arquivo text,
  p_texto text, p_data date, p_area text) returns text
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := meu_profissional(p_clinica); v_pac uuid;
begin
  if v_prof is null then raise exception 'Só profissionais podem importar prontuário.'; end if;
  select id into v_pac from pacientes where clinica_id = p_clinica and origem = 'motivar_2012' and origem_id = p_origem_id limit 1;
  if v_pac is null then return 'paciente_nao_encontrado'; end if;
  if exists (select 1 from prontuario_registros where clinica_id = p_clinica and profissional_id = v_prof and origem_arquivo = p_arquivo) then
    return 'ja_importado'; end if;
  insert into prontuario_registros (clinica_id, paciente_id, profissional_id, area, modelo, data_registro, conteudo, status, origem, origem_arquivo)
  values (p_clinica, v_pac, v_prof, coalesce(p_area, 'outra'), 'livre', coalesce(p_data, current_date),
          jsonb_build_object('texto', p_texto), 'assinado', 'sistema_antigo', p_arquivo);
  return 'importado';
end $$;
revoke execute on function importar_prontuario_antigo(uuid,text,text,text,date,text) from public, anon;
grant execute on function importar_prontuario_antigo(uuid,text,text,text,date,text) to authenticated;

-- Lista "Meus pacientes" do profissional (atendidos ou com prontuário dele)
create or replace function meus_pacientes_prontuario(p_clinica uuid) returns table
  (paciente_id uuid, nome text, ultimo_atendimento timestamptz, registros bigint, rascunhos bigint, ultimo_registro date)
language sql stable security definer set search_path = public as $$
  with eu as (select meu_profissional(p_clinica) as id),
  pac as (
    select a.paciente_id from atendimentos a, eu where a.clinica_id = p_clinica and a.profissional_id = eu.id
    union select r.paciente_id from prontuario_registros r, eu where r.clinica_id = p_clinica and r.profissional_id = eu.id)
  select p.id, coalesce(p.nome_social, p.nome),
    (select max(a.inicio) from atendimentos a, eu where a.paciente_id = p.id and a.profissional_id = eu.id and a.status = 'atendido'),
    (select count(*) from prontuario_registros r, eu where r.paciente_id = p.id and r.profissional_id = eu.id),
    (select count(*) from prontuario_registros r, eu where r.paciente_id = p.id and r.profissional_id = eu.id and r.status = 'rascunho'),
    (select max(r.data_registro) from prontuario_registros r, eu where r.paciente_id = p.id and r.profissional_id = eu.id)
  from pac join pacientes p on p.id = pac.paciente_id
  where (select id from eu) is not null;
$$;
revoke execute on function meus_pacientes_prontuario(uuid) from public, anon;
grant execute on function meus_pacientes_prontuario(uuid) to authenticated;
