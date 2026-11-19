-- =====================================================================
-- CURE OS — Migração 064: fila do robô de autorização de guias (Bloco 1).
-- A tela "Autorizar guias" grava aqui os pedidos; um robô no computador da clínica (Bloco 2) lê a fila, preenche o portal do convênio
-- e grava o resultado. Esta migração só cria a fila: nenhuma credencial de portal passa por aqui.
-- Equipe (gestor, recepção, financeiro) enfileira e cancela; quem executa/atualiza o resultado é definido no Bloco 2.
-- Idempotente.
-- =====================================================================

create table if not exists fila_autorizacao_robo (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas(id),
  autorizacao_id uuid not null references autorizacoes(id) on delete cascade,
  modo text not null default 'conferencia' check (modo in ('conferencia','envio')),  -- conferencia = preenche e para antes de enviar
  status text not null default 'pendente'
    check (status in ('pendente','executando','aguardando_ok','autorizada','erro','precisa_humano','cancelada')),
  mensagem text,                                  -- motivo do erro / o que falta
  resultado jsonb,                                -- retorno do portal (senha, nº da guia, validade) antes de gravar na autorização
  tentativas smallint not null default 0,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
create index if not exists fila_robo_status on fila_autorizacao_robo (clinica_id, status, criado_em);
-- uma autorização só pode ter um pedido ativo por vez
create unique index if not exists fila_robo_uma_ativa on fila_autorizacao_robo (autorizacao_id)
  where status in ('pendente','executando','aguardando_ok');

-- RLS
alter table fila_autorizacao_robo enable row level security;
drop policy if exists equipe_ve_fila_robo on fila_autorizacao_robo;
create policy equipe_ve_fila_robo on fila_autorizacao_robo for select to authenticated
  using (meu_perfil(clinica_id) = any (array['gestor','recepcao','financeiro']::perfil_usuario[]));
drop policy if exists equipe_enfileira_robo on fila_autorizacao_robo;
create policy equipe_enfileira_robo on fila_autorizacao_robo for insert to authenticated
  with check (
    meu_perfil(clinica_id) = any (array['gestor','recepcao','financeiro']::perfil_usuario[])
    and status = 'pendente'
    and exists (select 1 from autorizacoes a where a.id = autorizacao_id and a.clinica_id = fila_autorizacao_robo.clinica_id and a.status = 'pendente'));
drop policy if exists equipe_cancela_robo on fila_autorizacao_robo;
create policy equipe_cancela_robo on fila_autorizacao_robo for update to authenticated
  using (meu_perfil(clinica_id) = any (array['gestor','recepcao','financeiro']::perfil_usuario[]) and status in ('pendente','aguardando_ok','erro','precisa_humano'))
  with check (meu_perfil(clinica_id) = any (array['gestor','recepcao','financeiro']::perfil_usuario[]) and status = 'cancelada');
-- (sem DELETE: o histórico da fila fica; cancelar = status 'cancelada')

grant select, insert, update on fila_autorizacao_robo to authenticated;
revoke all on fila_autorizacao_robo from anon;
revoke delete, truncate, trigger, references on fila_autorizacao_robo from authenticated;   -- db/036

-- Auditoria genérica (db/035): tabela tem id uuid e clinica_id
drop trigger if exists auditoria_fila_autorizacao_robo on fila_autorizacao_robo;
create trigger auditoria_fila_autorizacao_robo after insert or update or delete on fila_autorizacao_robo
  for each row execute function auditar();
