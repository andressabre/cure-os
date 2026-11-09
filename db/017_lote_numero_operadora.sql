-- =====================================================================
-- CURE OS — Migração 017: número do lote/GRD dado pela operadora
-- Visto no portal SulAmérica (09/11/2026): o "Fechamento de Lote" gera a GRD
-- (ex.: 261109010459, protocolo 6300000042) e é esse número que volta no
-- Demonstrativo de Análise de Conta. Ao registrar o envio, se a operadora
-- deu outro número, ele substitui o nosso para o retorno casar com o lote.
-- =====================================================================
drop function if exists registrar_envio_lote(uuid, date, text);
create or replace function registrar_envio_lote(p_lote uuid, p_data_envio date, p_protocolo text, p_numero_operadora text default null)
returns date language plpgsql security definer set search_path = public as $$
declare l lotes; c contratos; v_prazo int; v_venc date; v_cat uuid; v_num text := nullif(trim(p_numero_operadora), '');
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if l.status <> 'fechado' then raise exception 'Este lote já foi enviado.'; end if;
  if l.arquivo_xml is null and v_num is null then
    raise exception 'Gere o XML ou informe o número do lote/GRD que a operadora deu.'; end if;
  if v_num is not null and exists (select 1 from lotes where contrato_id = l.contrato_id and numero_lote = v_num and id <> l.id) then
    raise exception 'O lote % já existe neste contrato.', v_num; end if;
  select * into c from contratos where id = l.contrato_id;
  v_prazo := coalesce((c.regras->>'prazo_pagamento_dias')::int, 30);
  v_venc := p_data_envio + v_prazo;
  update lotes set numero_lote = coalesce(v_num, numero_lote),
    status = case when nullif(trim(p_protocolo), '') is null then 'enviado' else 'protocolado' end::status_lote,
    data_envio = p_data_envio, protocolo = nullif(trim(p_protocolo), ''), previsto_pagamento = v_venc where id = p_lote
    returning * into l;
  update guias set status = 'enviada' where lote_id = p_lote;
  select id into v_cat from categorias_financeiras where clinica_id = l.clinica_id and nome = 'Convênios';
  delete from lancamentos where lote_id = p_lote and origem = 'lote' and status = 'previsto';
  insert into lancamentos (clinica_id, tipo, descricao, categoria_id, competencia, vencimento, valor_previsto,
    contrato_id, lote_id, fornecedor, origem, observacao)
  values (l.clinica_id, 'receber', 'Lote ' || l.numero_lote || ' – ' || c.nome, v_cat, l.competencia, v_venc, l.valor_total,
    c.id, l.id, c.nome, 'lote', l.qtd_guias || ' guias; previsto = valor informado (o retorno ajusta as glosas). Prazo ' || v_prazo || ' dias.');
  return v_venc;
end $$;
revoke execute on function registrar_envio_lote(uuid, date, text, text) from public, anon;
grant execute on function registrar_envio_lote(uuid, date, text, text) to authenticated;
