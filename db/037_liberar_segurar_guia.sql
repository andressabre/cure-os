-- 037 — Liberação da guia para faturamento: automática (como antes) + manual (liberar antes / segurar),
-- e aviso no Painel. Sem mudar os estados existentes:
--   guia sem lote: "Em aberto" (aguardando) | "Liberada p/ faturamento" (cheia, senha vencida, prazo, sem exigência ou liberada à mão)
--   guia em lote fechado: "No lote" | lote enviado: guia "enviada" = "Faturada" | depois paga / glosa.
-- Segurar tem precedência sobre tudo; "sem senha" continua impedindo o faturamento mesmo com liberação manual.

alter table guias add column if not exists liberada_em timestamptz,
                  add column if not exists liberada_por uuid,
                  add column if not exists segurada boolean not null default false,
                  add column if not exists segurada_motivo text;

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
    'liberada_em', g.liberada_em,
    'segurada_motivo', g.segurada_motivo,
    'motivo', case
      when g.segurada then 'segurada'
      when not contrato_exige_senha(g.contrato_id) then 'sem_exigencia'
      when coalesce(g.senha, au.senha) is null or au.status is distinct from 'autorizada' then 'sem_senha'
      when au.qtd_autorizada is null or r.realizadas >= au.qtd_autorizada
           or coalesce((c.regras->>'guia_por_sessao')::boolean, false) then 'cheia'
      when au.validade is not null and au.validade < current_date then 'senha_vencida'
      when (c.regras->>'prazo_entrega_dias') is not null
           and current_date - r.primeira >= (c.regras->>'prazo_entrega_dias')::int - 10 then 'prazo_entrega'
      when g.liberada_em is not null then 'liberada_manual'
      else 'aguardando' end)
  from guias g
  join contratos c on c.id = g.contrato_id
  left join autorizacoes au on au.id = g.autorizacao_id
  cross join lateral (select count(distinct coalesce(i.atendimento_id, i.id))::int realizadas, min(i.data_realizacao) primeira
                      from guia_itens i where i.guia_id = g.id) r
  where g.id = p_guia;
$$;
revoke execute on function situacao_guia_lote(uuid) from public, anon, authenticated;

-- criar_lote passa a aceitar a guia liberada à mão
do $$
declare v text;
begin
  select pg_get_functiondef('criar_lote(uuid,date,uuid[])'::regprocedure) into v;
  if position('''liberada_manual''' in v) = 0 then
    v := replace(v, '''sem_exigencia'',''prazo_entrega'')', '''sem_exigencia'',''prazo_entrega'',''liberada_manual'')');
    v := replace(v, 'case r.motivo when ''sem_senha'' then ''sem senha'' else ''sessões em aberto'' end',
                    'case r.motivo when ''sem_senha'' then ''sem senha'' when ''segurada'' then ''segurada'' else ''sessões em aberto'' end');
    execute v;
  end if;
end $$;

-- Ação da gestão/financeiro: liberar antes, desfazer liberação, segurar, soltar
create or replace function liberar_guia(p_guia uuid, p_acao text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g guias;
begin
  select * into g from guias where id = p_guia;
  if g.id is null then raise exception 'Guia não encontrada.'; end if;
  if coalesce(meu_perfil(g.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if g.lote_id is not null or g.status not in ('rascunho','pronta') then raise exception 'A guia já está em lote.'; end if;
  if p_acao = 'liberar' then
    update guias set liberada_em = now(), liberada_por = auth.uid(), segurada = false, segurada_motivo = null where id = p_guia;
  elsif p_acao = 'desfazer' then
    update guias set liberada_em = null, liberada_por = null where id = p_guia;
  elsif p_acao = 'segurar' then
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para segurar a guia.'; end if;
    update guias set segurada = true, segurada_motivo = trim(p_motivo) where id = p_guia;
  elsif p_acao = 'soltar' then
    update guias set segurada = false, segurada_motivo = null where id = p_guia;
  else raise exception 'Ação inválida.'; end if;
  return situacao_guia_lote(p_guia);
end $$;
revoke execute on function liberar_guia(uuid, text, text) from public, anon;
grant execute on function liberar_guia(uuid, text, text) to authenticated;

-- Resumo para o Painel: por contrato, quantas guias liberadas e quantas seguradas (só gestão/financeiro; outros = vazio)
create or replace function guias_liberadas_resumo(p_clinica uuid)
returns table (contrato text, liberadas int, seguradas int, valor numeric)
language sql stable security definer set search_path = public as $$
  select c.nome,
         count(*) filter (where s.m in ('cheia','senha_vencida','sem_exigencia','prazo_entrega','liberada_manual'))::int,
         count(*) filter (where s.m = 'segurada')::int,
         coalesce(sum(v.valor) filter (where s.m in ('cheia','senha_vencida','sem_exigencia','prazo_entrega','liberada_manual')), 0)
  from guias g
  join contratos c on c.id = g.contrato_id
  cross join lateral (select situacao_guia_lote(g.id)->>'motivo' m) s
  cross join lateral (select coalesce(sum(i.valor_informado), 0) valor from guia_itens i where i.guia_id = g.id) v
  where g.clinica_id = p_clinica and g.lote_id is null and g.status in ('rascunho','pronta')
    and coalesce(meu_perfil(p_clinica)::text, '') in ('gestor','financeiro')
    and not coalesce((c.regras->>'sem_tiss')::boolean, false)
    and exists (select 1 from guia_itens i where i.guia_id = g.id)
  group by c.nome
  having count(*) filter (where s.m in ('cheia','senha_vencida','sem_exigencia','prazo_entrega','liberada_manual','segurada')) > 0;
$$;
revoke execute on function guias_liberadas_resumo(uuid) from public, anon;
grant execute on function guias_liberadas_resumo(uuid) to authenticated;

-- Aviso no Painel (acrescenta ao fim da função pendencias existente)
do $$
declare v text;
begin
  select pg_get_functiondef('pendencias(uuid)'::regprocedure) into v;
  if position('guias_liberadas_resumo' in v) = 0 then
    v := regexp_replace(v, '\s*\$function\$\s*$', '');
    v := v || E'\n  union all\n  select ''alta'', ''Faturamento'', r.contrato || '': '' || r.liberadas || '' guia(s) liberada(s) para faturamento ('' ||'
           || E' to_char(r.valor, ''FM999G999G990D00'') || '')'', ''lotes''\n'
           || E'  from guias_liberadas_resumo(p_clinica) r where r.liberadas > 0\n'
           || E'  union all\n  select ''media'', ''Faturamento'', r.contrato || '': '' || r.seguradas || '' guia(s) segurada(s) pela gestão'', ''lotes''\n'
           || E'  from guias_liberadas_resumo(p_clinica) r where r.seguradas > 0\n$function$';
    execute v;
  end if;
end $$;
