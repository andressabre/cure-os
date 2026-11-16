-- =====================================================================
-- CURE OS — Migração 057: lista de espera com oferta de vaga (item 13 do backlog).
-- Atendimento cancelado no futuro → tela "Lista de espera" mostra quem espera aquele profissional/serviço
-- e gera a mensagem wa.me em 1 clique (marca 'ofertado'). Sem função nova; RLS no padrão das outras tabelas.
-- Profissional: vê a fila da clínica inteira (já vê todos os pacientes — db/052) e cria/altera só as entradas em seu nome.
-- Idempotente.
-- =====================================================================

create table if not exists lista_espera (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id),
  paciente_id uuid not null references pacientes(id) on delete cascade,
  profissional_id uuid references profissionais(id),          -- null = qualquer profissional do serviço
  servico text not null,                                       -- mesmos nomes de serviço da agenda
  dias_semana smallint[],                                      -- null = qualquer dia (0 = domingo … 6 = sábado)
  periodo text not null default 'qualquer' check (periodo in ('qualquer','manha','tarde','noite')),
  urgencia text not null default 'normal' check (urgencia in ('normal','alta')),
  observacao text,
  situacao text not null default 'aguardando' check (situacao in ('aguardando','ofertado','agendado','desistiu')),
  ofertado_em timestamptz,
  atendimento_id uuid references atendimentos(id) on delete set null,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  constraint lista_espera_dias_ok check (dias_semana is null or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[])
);
create index if not exists lista_espera_situacao on lista_espera (clinica_id, situacao);

-- RLS
alter table lista_espera enable row level security;
drop policy if exists equipe_lista_espera on lista_espera;
create policy equipe_lista_espera on lista_espera for all to authenticated
  using (meu_perfil(clinica_id) = any (array['gestor','recepcao','financeiro']::perfil_usuario[]))
  with check (meu_perfil(clinica_id) = any (array['gestor','recepcao','financeiro']::perfil_usuario[]));
drop policy if exists prof_ver_lista_espera on lista_espera;
create policy prof_ver_lista_espera on lista_espera for select to authenticated
  using (meu_perfil(clinica_id) = 'profissional');
drop policy if exists prof_cria_lista_espera on lista_espera;
create policy prof_cria_lista_espera on lista_espera for insert to authenticated
  with check (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id));
drop policy if exists prof_altera_lista_espera on lista_espera;
create policy prof_altera_lista_espera on lista_espera for update to authenticated
  using (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id))
  with check (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id));
-- (profissional não exclui: usa "desistiu")

grant select, insert, update, delete on lista_espera to authenticated;
revoke all on lista_espera from anon;
revoke truncate, trigger, references on lista_espera from authenticated;   -- db/036

-- Auditoria genérica (db/035): tabela tem id uuid e clinica_id
drop trigger if exists auditoria_lista_espera on lista_espera;
create trigger auditoria_lista_espera after insert or update or delete on lista_espera
  for each row execute function auditar();
