-- 067 — Meu extrato do profissional: situação de cada atendimento (pago / glosado / aguardando) e etapa do faturamento.
-- Glosa só aparece depois de confirmada pela gestão (confirmada_em). Nenhum valor recebido pela clínica é devolvido, só o repasse do próprio profissional.
-- Glosa recuperada no recurso volta a contar como paga. Guia cancelada fica fora.
drop function if exists meu_extrato(uuid, date, date);
create function meu_extrato(p_clinica uuid, p_de date, p_ate date)
returns table(data date, paciente text, procedimento text, numero_guia text, repasse_previsto numeric, desconto_glosa numeric,
              repasse_final numeric, glosa_codigo text, glosa_motivo text, glosa_status status_glosa, orientacao text,
              situacao text, etapa text)
language sql stable security definer set search_path = public as $$
  select i.data_realizacao, p.nome, pr.descricao, g.numero_guia_prestador,
         i.repasse_previsto, i.repasse_desconto, i.repasse_final,
         gl.codigo_glosa, mg.descricao, gl.status, gl.orientacao,
         case when gl.id is not null and gl.status <> 'recuperada' then 'glosado'
              when g.status = 'paga' or gl.status = 'recuperada' then 'pago'
              else 'aguardando' end,
         case when g.status in ('rascunho', 'pronta') then 'Ainda não enviado à operadora'
              when g.status = 'enviada' then 'Enviado, aguardando pagamento'
              else null end
  from guia_itens i
  join guias g on g.id = i.guia_id
  join paciente_planos pp on pp.id = g.paciente_plano_id
  join pacientes p on p.id = pp.paciente_id
  join procedimentos pr on pr.id = i.procedimento_id
  left join glosas gl on gl.guia_item_id = i.id and gl.confirmada_em is not null
  left join motivos_glosa mg on mg.codigo = gl.codigo_glosa
  where g.clinica_id = p_clinica and g.profissional_id = meu_profissional(p_clinica)
    and g.status <> 'cancelada' and i.data_realizacao between p_de and p_ate
  order by i.data_realizacao;
$$;
revoke execute on function meu_extrato(uuid, date, date) from public, anon;
grant execute on function meu_extrato(uuid, date, date) to authenticated;
