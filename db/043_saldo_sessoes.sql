-- 043 — Saldo de sessões visível (item 31 do backlog).
-- 1) numeracao_sessoes(): "sessão N de X" para os atendimentos visíveis (uma chamada por tela).
-- 2) pendencias(): bloco novo "Senha acabando" (demais blocos copiados da produção sem mudança).
-- Contam: agendado, confirmado, presente, atendido. Não contam: cancelado, faltou.
-- Operadora com 1 senha por sessão (qtd_autorizada = 1) conta pelo encaminhamento.

create or replace function numeracao_sessoes(p_atendimentos uuid[])
returns table(atendimento_id uuid, n integer, total integer, restam integer, validade date, base text)
language sql stable security invoker set search_path = public as $$
  with alvo as (
    select a.id, a.autorizacao_id from atendimentos a
    where a.id = any(p_atendimentos) and a.autorizacao_id is not null
  ), aut as (
    select au.id, au.qtd_autorizada, au.validade, au.encaminhamento_id, en.qtd_sessoes,
           (au.qtd_autorizada = 1 and au.encaminhamento_id is not null) as por_enc
    from autorizacoes au left join encaminhamentos en on en.id = au.encaminhamento_id
    where au.id in (select autorizacao_id from alvo)
  ), pos_aut as (
    select x.id, x.autorizacao_id,
           row_number() over (partition by x.autorizacao_id order by x.inicio, x.id)::int as n,
           count(*) over (partition by x.autorizacao_id)::int as usados
    from atendimentos x
    where x.autorizacao_id in (select id from aut where not por_enc)
      and x.status in ('agendado','confirmado','presente','atendido')
  ), pos_enc as (
    select x.id, au.encaminhamento_id,
           row_number() over (partition by au.encaminhamento_id order by x.inicio, x.id)::int as n,
           count(*) over (partition by au.encaminhamento_id)::int as usados
    from atendimentos x join autorizacoes au on au.id = x.autorizacao_id
    where au.encaminhamento_id in (select encaminhamento_id from aut where por_enc)
      and x.status in ('agendado','confirmado','presente','atendido')
  )
  select alvo.id,
         case when aut.por_enc then pe.n else pa.n end,
         case when aut.por_enc then aut.qtd_sessoes else aut.qtd_autorizada end,
         case when aut.por_enc then aut.qtd_sessoes - pe.usados else aut.qtd_autorizada - pa.usados end,
         aut.validade,
         case when aut.por_enc then 'encaminhamento' else 'senha' end
  from alvo join aut on aut.id = alvo.autorizacao_id
  left join pos_aut pa on pa.id = alvo.id
  left join pos_enc pe on pe.id = alvo.id;
$$;
revoke execute on function numeracao_sessoes(uuid[]) from public, anon;
grant  execute on function numeracao_sessoes(uuid[]) to authenticated;

create or replace function public.pendencias(p_clinica uuid)
 returns table(gravidade text, area text, descricao text, link text)
 language sql stable set search_path to 'public'
as $function$
  select 'alta', 'Profissionais', p.nome || ': falta ' || concat_ws(', ',
      case when coalesce(p.conselho,'') = '' then 'conselho' end,
      case when coalesce(p.numero_conselho,'') = '' then 'nº do conselho' end,
      case when coalesce(p.uf_conselho,'') = '' then 'UF do conselho' end,
      case when coalesce(p.cbo,'') = '' then 'CBO' end) || ' (obrigatório na guia TISS)', 'profissionais'
  from profissionais p where p.clinica_id = p_clinica and p.ativo
    and (coalesce(p.conselho,'') = '' or coalesce(p.numero_conselho,'') = '' or coalesce(p.uf_conselho,'') = '' or coalesce(p.cbo,'') = '')
  union all
  select 'media', 'Repasse', p.nome || ': sem regra de repasse cadastrada', 'repasse'
  from profissionais p where p.clinica_id = p_clinica and p.ativo
    and not exists (select 1 from regras_repasse r where r.profissional_id = p.id)
  union all
  select 'alta', 'Contratos', k.nome || ': há repasse definido para ' || pr.codigo || ' (' || pr.descricao || '), mas o contrato não tem valor de recebimento para esse procedimento', 'contratos'
  from regras_repasse r join contratos k on k.id = r.contrato_id join procedimentos pr on pr.id = r.procedimento_id
  where r.clinica_id = p_clinica and (r.vigencia_fim is null or r.vigencia_fim >= current_date)
    and not exists (select 1 from contrato_tabela t where t.contrato_id = k.id and t.procedimento_id = pr.id and t.vigencia_fim is null)
  union all
  select 'alta', 'Contratos', 'CNPJ de faturamento "' || c.razao_social || '" está inválido ou incompleto', 'contratos'
  from cnpjs_faturamento c where c.clinica_id = p_clinica and c.ativo and length(regexp_replace(c.cnpj, '\D', '', 'g')) <> 14
  union all
  select 'alta', 'Contratos', k.nome || ': sem código do prestador na operadora', 'contratos'
  from contratos k join operadoras o on o.id = k.operadora_id
  where k.clinica_id = p_clinica and k.ativo and coalesce(k.codigo_prestador_operadora,'') = '' and o.registro_ans is not null
  union all
  select 'alta', 'Contratos', k.nome || ': sem tabela de valores vigente', 'contratos'
  from contratos k where k.clinica_id = p_clinica and k.ativo
    and not exists (select 1 from contrato_tabela t where t.contrato_id = k.id and t.vigencia_inicio <= current_date and (t.vigencia_fim is null or t.vigencia_fim >= current_date))
  union all
  select 'media', 'Contratos', k.nome || ': prazos de envio e recurso não informados', 'contratos'
  from contratos k join operadoras o on o.id = k.operadora_id
  where k.clinica_id = p_clinica and k.ativo and o.registro_ans is not null and (k.prazo_envio_dias is null or k.prazo_recurso_dias is null)
  union all
  select 'media', 'Contratos', k.nome || ': tabela de valores vigente desde ' || to_char(min(t.vigencia_inicio), 'DD/MM/YYYY') || ' — conferir reajuste anual', 'contratos'
  from contratos k join contrato_tabela t on t.contrato_id = k.id and t.vigencia_fim is null
  where k.clinica_id = p_clinica and k.ativo group by k.id, k.nome having min(t.vigencia_inicio) < current_date - interval '11 months'
  union all
  select 'media', 'Retornos', 'Retorno de ' || to_char(r.data_emissao, 'DD/MM/YYYY') || ' aguardando revisão das glosas', 'retornos-' || r.id
  from retornos r where r.clinica_id = p_clinica and r.status = 'em_revisao'
  union all
  select 'baixa', 'Acessos', p.nome || ': ainda sem acesso ao sistema (convite pendente)', 'acessos'
  from profissionais p where p.clinica_id = p_clinica and p.ativo
    and not exists (select 1 from usuarios_clinica u where u.profissional_id = p.id)
    and not exists (select 1 from convites v where v.profissional_id = p.id)
  union all
  select 'alta', 'Faturamento', r.contrato || ': ' || r.liberadas || ' guia(s) liberada(s) para faturamento (' || to_char(r.valor, 'FM999G999G990D00') || ')', 'lotes'
  from guias_liberadas_resumo(p_clinica) r where r.liberadas > 0
  union all
  select 'media', 'Faturamento', r.contrato || ': ' || r.seguradas || ' guia(s) segurada(s) pela gestão', 'lotes'
  from guias_liberadas_resumo(p_clinica) r where r.seguradas > 0
  union all
  -- 043: Senha acabando — senha vigente com ≤ 2 sessões livres ou vencendo em ≤ 7 dias, tratamento em curso,
  -- encaminhamento ainda com sessões previstas e sem nova autorização pedida/feita depois desta.
  select case when s.livres <= 0 or au.validade <= current_date + 2 then 'alta' else 'media' end,
         'Autorizações',
         pa.nome || ': senha ' || coalesce(au.senha, '—') || ' — '
           || case when s.livres <= 0 then 'sem sessões livres' else 'restam ' || s.livres || ' de ' || au.qtd_autorizada end
           || coalesce(' · vence ' || to_char(au.validade, 'DD/MM'), '') || '. Pedir nova autorização',
         'paciente-' || pa.id
  from autorizacoes au
  join paciente_planos pp on pp.id = au.paciente_plano_id
  join pacientes pa on pa.id = pp.paciente_id
  left join encaminhamentos en on en.id = au.encaminhamento_id
  cross join lateral (select au.qtd_autorizada - count(*)::int as livres from atendimentos x
                      where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente','atendido')) s
  where au.clinica_id = p_clinica and au.status = 'autorizada' and au.qtd_autorizada > 1
    and (au.validade is null or au.validade >= current_date)
    and (s.livres <= 2 or au.validade <= current_date + 7)
    and exists (select 1 from atendimentos x where x.autorizacao_id = au.id and x.inicio >= now() - interval '14 days')
    and (en.id is null or en.qtd_sessoes is null
         or en.qtd_sessoes > (select coalesce(sum(a2.qtd_autorizada), 0) from autorizacoes a2
                              where a2.encaminhamento_id = en.id and a2.status in ('autorizada','pendente')))
    and not exists (select 1 from autorizacoes a2 where a2.paciente_plano_id = au.paciente_plano_id
                    and a2.procedimento_id is not distinct from au.procedimento_id and a2.id <> au.id
                    and (a2.status = 'pendente'
                         or (a2.status = 'autorizada' and coalesce(a2.data_autorizacao, current_date) > coalesce(au.data_autorizacao, current_date))))
$function$;
revoke execute on function pendencias(uuid) from public, anon;
grant  execute on function pendencias(uuid) to authenticated;
