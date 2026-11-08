-- =====================================================================
-- CURE OS — Migração 015: 1 guia por SENHA (corrige a 014)
-- Correção da gestora (08/11/2026): cada senha = 1 guia SP/SADT com suas
-- sessões (ex.: consulta = guia/senha A; sessões 1–10 = guia/senha B;
-- 11–20 = guia/senha C). A guia NÃO é dividida por mês nem por profissional:
-- todos os atendimentos ligados à autorização entram na mesma guia, até a
-- quantidade autorizada (3292 bloqueia o excedente).
-- Remove do agrupamento da guia_atendimento os filtros de mês e profissional.
-- =====================================================================
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('guia_atendimento(uuid,uuid,uuid,jsonb,boolean,jsonb)'::regprocedure);
  n := replace(d, ' and g.profissional_id = a.profissional_id', '');
  n := regexp_replace(n, '\s+and date_trunc\(''month'', g\.data_atendimento\) = date_trunc\(''month'', v_data\)', '');
  if n = d or position('date_trunc' in n) > 0 or position('g.profissional_id = a.profissional_id' in n) > 0 then
    raise exception 'Trecho esperado não encontrado na guia_atendimento';
  end if;
  execute n;
end $$;
