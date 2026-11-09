-- =====================================================================
-- CURE OS — Migração 019: SulAmérica = 1 guia (conta) por sessão
-- Gestora (09/11/2026): na SulAmérica a conta típica é a sessão com
-- eletro 31602185 (R$ 50,00) + 20103409 (R$ 68,82) = R$ 118,82; o
-- fechamento de 09/11 teve 54 contas com média R$ 117,87 → 1 conta por sessão,
-- com os dois procedimentos na MESMA guia SP/SADT.
--  • regras.guia_por_sessao = true: cada atendimento abre guia própria (mesma senha).
--    Guia por sessão já nasce completa → pronta para o lote ('cheia').
--  • 31602185 estava como HONORARIO (veio do PDF de honorários) → SP_SADT,
--    senão viraria uma guia separada e bloqueada no XML.
-- =====================================================================
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('guia_atendimento(uuid,uuid,uuid,jsonb,boolean,jsonb)'::regprocedure);
  n := replace(d, 'if v_aut is not null then
        select g.id into v_guia from guias g',
    'if v_aut is not null and not coalesce((c.regras->>''guia_por_sessao'')::boolean, false) then
        select g.id into v_guia from guias g');
  if n = d then raise exception 'Trecho esperado não encontrado na guia_atendimento'; end if;
  execute n;

  d := pg_get_functiondef('situacao_guia_lote(uuid)'::regprocedure);
  n := replace(d, 'when au.qtd_autorizada is null or r.realizadas >= au.qtd_autorizada then ''cheia''',
    'when au.qtd_autorizada is null or r.realizadas >= au.qtd_autorizada
           or coalesce((c.regras->>''guia_por_sessao'')::boolean, false) then ''cheia''');
  if n = d then raise exception 'Trecho esperado não encontrado na situacao_guia_lote'; end if;
  execute n;
end $$;

update contratos c set regras = coalesce(c.regras, '{}'::jsonb) || '{"guia_por_sessao": true}'::jsonb
from operadoras o where o.id = c.operadora_id and o.registro_ans = '006246';

update contrato_tabela t set tipo_guia = 'SP_SADT'
from contratos c, operadoras o, procedimentos p
where c.id = t.contrato_id and o.id = c.operadora_id and o.registro_ans = '006246'
  and p.id = t.procedimento_id and p.codigo = '31602185' and t.tipo_guia = 'HONORARIO';
