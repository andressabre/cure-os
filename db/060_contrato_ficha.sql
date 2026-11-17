-- =====================================================================
-- CURE OS — Migração 060: ficha completa do contrato (página própria, como a do paciente).
-- Contato de negociação, dados para nota fiscal, conta de recebimento, link do portal de autorização, bloco livre
-- e acessos ao portal (código/usuário/senha + perfil de uso). Idempotente.
-- Os acessos ficam em tabela separada, só a gestora lê/grava, e NÃO entram na auditoria nem no backup ZIP
-- (a auditoria gravaria o valor da senha no log).
-- =====================================================================
alter table contratos
  add column if not exists contato_nome text,
  add column if not exists contato_fone text,
  add column if not exists contato_email text,
  add column if not exists nf_cnpj text,
  add column if not exists nf_razao text,
  add column if not exists nf_email text,
  add column if not exists nf_endereco text,
  add column if not exists conta_recebimento_id uuid references contas_financeiras(id) on delete set null,
  add column if not exists portal_url text,
  add column if not exists observacoes text;

create table if not exists contrato_portais (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id) on delete cascade,
  contrato_id uuid not null references contratos(id) on delete cascade,
  perfil text,          -- uso do acesso: usuário master, autorizador, secretaria…
  codigo text,
  usuario text,
  senha text,
  observacao text,
  ordem smallint not null default 1,
  criado_em timestamptz not null default now()
);
create index if not exists contrato_portais_contrato on contrato_portais (contrato_id, ordem);

alter table contrato_portais enable row level security;
drop policy if exists gestora_contrato_portais on contrato_portais;
create policy gestora_contrato_portais on contrato_portais as permissive for all to authenticated
  using (meu_perfil(clinica_id) = 'gestor'::perfil_usuario)
  with check (meu_perfil(clinica_id) = 'gestor'::perfil_usuario
    and exists (select 1 from contratos c where c.id = contrato_id and c.clinica_id = contrato_portais.clinica_id));

revoke all on contrato_portais from anon, public;
grant select, insert, update, delete on contrato_portais to authenticated;
