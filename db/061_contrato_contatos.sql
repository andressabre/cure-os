-- =====================================================================
-- CURE OS — Migração 061: vários contatos de negociação por contrato (substitui os 3 campos únicos da 060, que estavam vazios).
-- RLS: gestor e financeiro (igual a contratos). Idempotente.
-- =====================================================================
create table if not exists contrato_contatos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id) on delete cascade,
  contrato_id uuid not null references contratos(id) on delete cascade,
  nome text,
  cargo text,
  telefone text,
  email text,
  observacao text,
  ordem smallint not null default 1,
  criado_em timestamptz not null default now()
);
create index if not exists contrato_contatos_contrato on contrato_contatos (contrato_id, ordem);

alter table contrato_contatos enable row level security;
drop policy if exists gestao_contrato_contatos on contrato_contatos;
create policy gestao_contrato_contatos on contrato_contatos as permissive for all to authenticated
  using (meu_perfil(clinica_id) = any (array['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))
  with check (meu_perfil(clinica_id) = any (array['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])
    and exists (select 1 from contratos c where c.id = contrato_id and c.clinica_id = contrato_contatos.clinica_id));

revoke all on contrato_contatos from anon, public;
grant select, insert, update, delete on contrato_contatos to authenticated;

alter table contratos drop column if exists contato_nome, drop column if exists contato_fone, drop column if exists contato_email;
