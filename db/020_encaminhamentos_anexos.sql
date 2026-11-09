-- =====================================================================
-- CURE OS — Migração 020: encaminhamentos (pedido médico) + anexos por guia
-- Gestora (09/11/2026):
--  • O paciente tem encaminhamentos (pedido do médico), cada um com ÁREA
--    (fisio, nutri, psico…), validade e arquivo. O mesmo paciente pode ter
--    encaminhamentos de várias áreas: não podem se misturar.
--  • A autorização é vinculada a um encaminhamento da MESMA área, e a tela
--    sinaliza o vínculo. Sem regra fixa de quantidade (fisio ≈ 10 sessões;
--    psicoterapia conforme o CID): qtd_sessoes é só informativa.
--  • A guia que vai ao lote precisa do encaminhamento (anexo ANS 03) e da
--    guia assinada (anexo ANS 06) — Manual SulAmérica 6.2.
-- Arquivos: Storage privado "documentos", caminho <clinica_id>/...
-- =====================================================================

create table if not exists encaminhamentos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  paciente_id uuid not null references pacientes on delete cascade,
  area text not null check (area in ('fisioterapia','nutricao','psicologia','palmilha','outra')),
  solicitante_id uuid references solicitantes,
  data_pedido date not null,
  validade date,
  cid text,
  indicacao_clinica text,
  qtd_sessoes int check (qtd_sessoes is null or qtd_sessoes > 0),
  arquivo text,                       -- caminho no Storage (bucket documentos)
  arquivo_nome text,
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index if not exists encaminhamentos_paciente on encaminhamentos (paciente_id, area);

alter table autorizacoes
  add column if not exists encaminhamento_id uuid references encaminhamentos,
  add column if not exists area text check (area in ('fisioterapia','nutricao','psicologia','palmilha','outra'));

create table if not exists guia_anexos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  guia_id uuid not null references guias on delete cascade,
  tipo text not null check (tipo in ('02','03','04','05','06','14')),   -- tabela ANS de documentos (Manual SulAmérica 6.2.1)
  arquivo text not null,
  arquivo_nome text,
  enviado_portal_em date,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index if not exists guia_anexos_guia on guia_anexos (guia_id);

alter table encaminhamentos enable row level security;
alter table guia_anexos enable row level security;
drop policy if exists edita_encaminhamentos on encaminhamentos;
create policy edita_encaminhamentos on encaminhamentos for all
  using (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'))
  with check (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'));
drop policy if exists prof_encaminhamentos on encaminhamentos;
create policy prof_encaminhamentos on encaminhamentos for select
  using (meu_perfil(clinica_id) = 'profissional' and exists (select 1 from atendimentos a
    where a.paciente_id = encaminhamentos.paciente_id and a.profissional_id = meu_profissional(encaminhamentos.clinica_id)));
drop policy if exists edita_guia_anexos on guia_anexos;
create policy edita_guia_anexos on guia_anexos for all
  using (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'))
  with check (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'));

-- Storage privado
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 10485760)          -- 10 MB = limite do portal SulAmérica
on conflict (id) do nothing;

create or replace function pasta_clinica_ok(p_nome text, p_perfis text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$'
    then coalesce(meu_perfil(split_part(p_nome, '/', 1)::uuid)::text = any(p_perfis), false) else false end;
$$;

drop policy if exists documentos_ler on storage.objects;
create policy documentos_ler on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and pasta_clinica_ok(name, array['gestor','recepcao','financeiro']));
drop policy if exists documentos_enviar on storage.objects;
create policy documentos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and pasta_clinica_ok(name, array['gestor','recepcao','financeiro']));
drop policy if exists documentos_apagar on storage.objects;
create policy documentos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and pasta_clinica_ok(name, array['gestor']));

-- Vincula encaminhamento ↔ autorização (mesmo paciente e mesma área)
create or replace function vincular_encaminhamento(p_autorizacao uuid, p_encaminhamento uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare au autorizacoes; en encaminhamentos; v_pac uuid; avisos jsonb := '[]';
begin
  select * into au from autorizacoes where id = p_autorizacao;
  if coalesce(meu_perfil(au.clinica_id)::text, '') not in ('gestor','recepcao','financeiro') then raise exception 'Sem permissão'; end if;
  if p_encaminhamento is null then
    update autorizacoes set encaminhamento_id = null where id = au.id;
    return jsonb_build_object('avisos', avisos);
  end if;
  select * into en from encaminhamentos where id = p_encaminhamento;
  select paciente_id into v_pac from paciente_planos where id = au.paciente_plano_id;
  if en.id is null or en.paciente_id <> v_pac then raise exception 'O encaminhamento não é deste paciente.'; end if;
  if en.status <> 'ativo' then raise exception 'Encaminhamento cancelado.'; end if;
  if au.area is not null and au.area <> en.area then
    raise exception 'Área diferente: a autorização é de % e o encaminhamento é de %.', au.area, en.area; end if;
  if en.validade is not null and au.data_autorizacao is not null and en.validade < au.data_autorizacao then
    avisos := avisos || to_jsonb('O encaminhamento já estava vencido na data da autorização.'::text); end if;
  if en.arquivo is null then avisos := avisos || to_jsonb('Encaminhamento sem arquivo: anexe o pedido (obrigatório no faturamento).'::text); end if;
  update autorizacoes set encaminhamento_id = en.id, area = en.area,
    solicitante_id = coalesce(solicitante_id, en.solicitante_id),
    cid = coalesce(nullif(cid, ''), en.cid),
    indicacao_clinica = coalesce(nullif(indicacao_clinica, ''), en.indicacao_clinica)
  where id = au.id;
  -- guias ainda abertas herdam solicitante/CID se estiverem vazios
  update guias g set solicitante_id = coalesce(g.solicitante_id, en.solicitante_id),
    cid = coalesce(nullif(g.cid, ''), en.cid), indicacao_clinica = coalesce(nullif(g.indicacao_clinica, ''), en.indicacao_clinica)
  where g.autorizacao_id = au.id and g.lote_id is null and g.status in ('rascunho','pronta');
  return jsonb_build_object('avisos', avisos);
end $$;

-- Situação dos anexos por guia do lote (03 vem do encaminhamento da autorização ou de anexo próprio)
create or replace function anexos_lote(p_lote uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cli uuid;
begin
  select clinica_id into v_cli from lotes where id = p_lote;
  if coalesce(meu_perfil(v_cli)::text, '') not in ('gestor','financeiro','recepcao') then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'guia_id', g.id, 'numero', g.numero_guia_prestador, 'paciente', pa.nome,
    'primeira', (select min(i.data_realizacao) from guia_itens i where i.guia_id = g.id),
    'encaminhamento', (select jsonb_build_object('id', en.id, 'area', en.area, 'validade', en.validade, 'arquivo', en.arquivo,
        'arquivo_nome', en.arquivo_nome, 'data_pedido', en.data_pedido) from encaminhamentos en where en.id = au.encaminhamento_id),
    'anexos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'arquivo', x.arquivo, 'arquivo_nome', x.arquivo_nome,
        'enviado', x.enviado_portal_em) order by x.criado_em) from guia_anexos x where x.guia_id = g.id), '[]'))
    order by g.numero_guia_prestador)
    from guias g join paciente_planos pl on pl.id = g.paciente_plano_id join pacientes pa on pa.id = pl.paciente_id
    left join autorizacoes au on au.id = g.autorizacao_id
    where g.lote_id = p_lote), '[]');
end $$;

revoke execute on function vincular_encaminhamento(uuid, uuid), anexos_lote(uuid) from public, anon;
grant execute on function vincular_encaminhamento(uuid, uuid), anexos_lote(uuid) to authenticated;
