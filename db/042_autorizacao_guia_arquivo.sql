-- 042: PDF da guia emitida pela operadora (guia de solicitação autorizada) guardado na própria autorização.
alter table public.autorizacoes add column if not exists guia_arquivo text;
alter table public.autorizacoes add column if not exists guia_arquivo_nome text;
