-- 031 — recebimentos.itens (jsonb): vários itens por pagamento (procedimento_id, descricao, qtd, valor); procedimento_id = 1º item.
alter table recebimentos add column if not exists itens jsonb not null default '[]'::jsonb;
