-- =====================================================================
-- CURE OS — Migração 018: prazo de entrega da conta + regras SulAmérica
-- Manual de Operações SulAmérica (atualizado 25/08/2026), item 6.3: a conta
-- não pode ser entregue mais de 90 dias após o atendimento. Com a regra
-- "guia só cheia ou com senha vencida", uma senha longa com sessões espaçadas
-- poderia passar do prazo → a guia passa a ficar pronta também quando a 1ª
-- sessão chega a (prazo − 10) dias: motivo 'prazo_entrega'.
-- Prazo vem de contratos.regras.prazo_entrega_dias (sem valor = sem limite).
-- =====================================================================
create or replace function situacao_guia_lote(p_guia uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'realizadas', r.realizadas,
    'autorizadas', au.qtd_autorizada,
    'validade', au.validade,
    'dias_para_vencer', case when au.validade is not null then au.validade - current_date end,
    'dias_desde_primeira', current_date - r.primeira,
    'prazo_entrega', (c.regras->>'prazo_entrega_dias')::int,
    'exige_senha', contrato_exige_senha(g.contrato_id),
    'motivo', case
      when not contrato_exige_senha(g.contrato_id) then 'sem_exigencia'
      when coalesce(g.senha, au.senha) is null or au.status is distinct from 'autorizada' then 'sem_senha'
      when au.qtd_autorizada is null or r.realizadas >= au.qtd_autorizada then 'cheia'
      when au.validade is not null and au.validade < current_date then 'senha_vencida'
      when (c.regras->>'prazo_entrega_dias') is not null
           and current_date - r.primeira >= (c.regras->>'prazo_entrega_dias')::int - 10 then 'prazo_entrega'
      else 'aguardando' end)
  from guias g
  join contratos c on c.id = g.contrato_id
  left join autorizacoes au on au.id = g.autorizacao_id
  cross join lateral (select count(distinct coalesce(i.atendimento_id, i.id))::int realizadas, min(i.data_realizacao) primeira
                      from guia_itens i where i.guia_id = g.id) r
  where g.id = p_guia;
$$;
revoke execute on function situacao_guia_lote(uuid) from public, anon;

-- criar_lote aceita o novo motivo
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('criar_lote(uuid,date,uuid[])'::regprocedure);
  n := replace(d, $q$('cheia','senha_vencida','sem_exigencia')$q$, $q$('cheia','senha_vencida','sem_exigencia','prazo_entrega')$q$);
  if n = d then raise exception 'Trecho esperado não encontrado na criar_lote'; end if;
  execute n;
end $$;

-- Regras do Manual de Operações SulAmérica nos contratos da operadora (ANS 006246)
update contratos c set regras = coalesce(c.regras, '{}'::jsonb) || jsonb_build_object(
  'prazo_entrega_dias', 90,
  'anexos_obrigatorios', jsonb_build_array('03 – Pedido médico / encaminhamento', '06 – Guia assinada (comprovante de comparecimento)'),
  'prazo_anexos_dias_uteis', 3,
  'cancelamento_dias_uteis', 5,
  'recurso_dias', 90,
  'fonte_regras', 'Manual de Operações Referenciado Saúde SulAmérica, atualizado em 25/08/2026')
from operadoras o where o.id = c.operadora_id and o.registro_ans = '006246';
