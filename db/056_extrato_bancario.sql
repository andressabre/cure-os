-- =====================================================================
-- CURE OS — Migração 056: Extrato bancário (OFX/CSV) e conciliação.
-- Cria `extrato_movimentos`: cada linha do extrato importado de uma conta
-- (`contas_financeiras`), com situação pendente/conciliado/ignorado e o
-- lançamento (`lancamentos`) que ela quitou. A baixa do lançamento é feita
-- pela tela (mesmas colunas do Financeiro), sempre com clique humano.
-- Dedupe: unique (conta_id, id_banco) — FITID do OFX ou hash estável da linha do CSV.
-- RLS igual à de `lancamentos` (db/051): gestor tudo; financeiro só contas da
-- carteira da empresa. Auditoria genérica (db/035). Sem função nova. Sem dados.
-- =====================================================================

create table if not exists extrato_movimentos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  conta_id uuid not null references contas_financeiras,   -- sem cascade: conta com extrato só se inativa
  data date not null,
  valor numeric(12,2) not null,                 -- positivo = crédito, negativo = débito
  descricao text,
  documento text,
  id_banco text not null,                       -- FITID (OFX) ou hash da linha (CSV)
  situacao text not null default 'pendente' check (situacao in ('pendente','conciliado','ignorado')),
  lancamento_id uuid references lancamentos on delete set null,
  -- Para "Desfazer" sem estragar baixa feita por outra via:
  --   baixa_anterior = colunas do lançamento ANTES de esta conciliação dar a baixa
  --   (null = a conciliação não baixou nada); lancamento_criado = o lançamento nasceu aqui.
  baixa_anterior jsonb,
  lancamento_criado boolean not null default false,
  conciliado_em timestamptz,
  importado_em timestamptz not null default now(),
  importado_por uuid default auth.uid(),
  arquivo text,
  unique (conta_id, id_banco)
);
create index if not exists extmov_clinica_situacao on extrato_movimentos (clinica_id, situacao);
create index if not exists extmov_conta_data on extrato_movimentos (conta_id, data);
create index if not exists extmov_lancamento on extrato_movimentos (lancamento_id) where lancamento_id is not null;

-- ---------------------------------------------------------------------
-- RLS: espelha gestao_lancamentos (db/051). A carteira vem da conta.
-- O EXISTS passa pela RLS de contas_financeiras: para o financeiro, conta de
-- carteira pessoal não aparece → linha negada (nunca "null = liberado").
-- Na escrita, o lançamento ligado precisa ser visível e da mesma clínica.
-- ---------------------------------------------------------------------
alter table extrato_movimentos enable row level security;
drop policy if exists gestao_extrato_movimentos on extrato_movimentos;
create policy gestao_extrato_movimentos on extrato_movimentos for all to authenticated
  using (
    meu_perfil(clinica_id) in ('gestor','financeiro')
    and exists (select 1 from contas_financeiras k
                 where k.id = extrato_movimentos.conta_id and k.clinica_id = extrato_movimentos.clinica_id
                   and (meu_perfil(extrato_movimentos.clinica_id) = 'gestor' or not carteira_pessoal(k.carteira_id))))
  with check (
    meu_perfil(clinica_id) in ('gestor','financeiro')
    and exists (select 1 from contas_financeiras k
                 where k.id = extrato_movimentos.conta_id and k.clinica_id = extrato_movimentos.clinica_id
                   and (meu_perfil(extrato_movimentos.clinica_id) = 'gestor' or not carteira_pessoal(k.carteira_id)))
    and (lancamento_id is null or exists (select 1 from lancamentos l
                 where l.id = extrato_movimentos.lancamento_id and l.clinica_id = extrato_movimentos.clinica_id)));

-- Privilégios: o app só usa SELECT/INSERT/UPDATE/DELETE (controlados pela RLS).
-- db/036 já fez `alter default privileges ... revoke truncate, trigger, references`, mas default
-- privileges valem só para tabelas criadas pelo MESMO papel que rodou a 036 (postgres, via migração).
-- O revoke explícito abaixo garante o mesmo resultado se esta migração rodar com outro papel.
revoke all on extrato_movimentos from anon;
revoke truncate, trigger, references on extrato_movimentos from authenticated;
grant select, insert, update, delete on extrato_movimentos to authenticated;

-- ---------------------------------------------------------------------
-- Auditoria genérica (db/035): tem `id` uuid e `clinica_id`, como as outras.
-- ---------------------------------------------------------------------
drop trigger if exists auditoria_extrato_movimentos on extrato_movimentos;
create trigger auditoria_extrato_movimentos after insert or update or delete on extrato_movimentos
  for each row execute function auditar();

-- ---------------------------------------------------------------------
-- TESTES (rodar em transação com rollback depois de aplicar)
-- T1 dedupe: inserir 2× a mesma (conta_id, id_banco) → 2ª falha com unique_violation.
-- T2 financeiro × pessoal: begin; set local role authenticated;
--    select set_config('request.jwt.claims','{"sub":"<uuid financeiro>"}',true);
--    insert into extrato_movimentos (clinica_id, conta_id, data, valor, id_banco)
--      values ('<clinica>','<conta de carteira pessoal>', current_date, 1, 't2');  -- esperado: erro de RLS
--    select count(*) from extrato_movimentos m join contas_financeiras k on k.id = m.conta_id
--      where carteira_pessoal(k.carteira_id);                                     -- esperado: 0
--    rollback;
-- T3 profissional/recepção: select count(*) from extrato_movimentos → 0.
-- T4 auditoria: update de situacao gera 1 linha em auditoria com campos ["situacao", …].
-- T5 get_advisors(security) e ferramentas/auditoria-rls.sql sem achados novos.
-- ---------------------------------------------------------------------
