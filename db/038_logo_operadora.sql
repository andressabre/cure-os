-- Logo da operadora para a guia SP/SADT impressa ("modelo da operadora").
alter table operadoras add column if not exists logo text;
comment on column operadoras.logo is 'Data URL (PNG/JPEG) de imagem comprimida no navegador, largura máx. 400 px, até ~60 KB. Usada só na guia impressa. Nulo = guia sem logo.';
-- Sem mudança de RLS: vale a policy atual de operadoras.
