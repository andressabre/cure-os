-- 034 — Fecha EXECUTE de anon/public em funções comuns (não SECURITY DEFINER) que a db/025 não cobriu.
-- Achado pelo ferramentas/auditoria-rls.sql (bloco 1) em 10/11/2026. Sem mudança de comportamento:
-- `pendencias` continua para authenticated (painel); funções de gatilho não precisam de EXECUTE para ninguém.
revoke execute on function calcular_desconto_repasse(uuid) from public, anon, authenticated;
revoke execute on function pendencias(uuid) from public, anon;
grant  execute on function pendencias(uuid) to authenticated;
revoke execute on function trg_glosa_recalcula() from public, anon, authenticated;
revoke execute on function trg_glosa_notifica() from public, anon, authenticated;
-- Daqui em diante, funções novas nascem fechadas para quem não precisa:
alter default privileges in schema public revoke execute on functions from public;
