-- =====================================================================
-- CURE OS — Migração 016: lote de faturamento + dados para o XML TISS 4.03.00
-- Regra da gestora (08/11/2026): a guia só entra no lote CHEIA (sessões
-- realizadas = quantidade autorizada) ou com a SENHA VENCIDA (vai com as
-- sessões feitas). Nunca parcial no fechamento do mês. Só guias com senha
-- (exceto contratos que não exigem autorização).
-- Schema ANS: 1 tipo de guia por lote, no máximo 100 guias por lote.
-- O XML é montado no navegador (js/modulos/tiss-xml.js) a partir de
-- dados_xml_lote(); o arquivo e o hash ficam gravados no lote.
-- Ao registrar o envio, nasce o "a receber" do convênio no financeiro.
-- =====================================================================

alter table lotes
  add column if not exists tipo_guia text not null default 'SP_SADT',
  add column if not exists qtd_guias int,
  add column if not exists valor_total numeric(14,2),
  add column if not exists hash_md5 text,
  add column if not exists gerado_em timestamptz,
  add column if not exists criado_em timestamptz not null default now(),
  add column if not exists previsto_pagamento date;

-- Situação de uma guia aberta frente à regra do lote
create or replace function situacao_guia_lote(p_guia uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'realizadas', r.realizadas,
    'autorizadas', au.qtd_autorizada,
    'validade', au.validade,
    'dias_para_vencer', case when au.validade is not null then au.validade - current_date end,
    'exige_senha', contrato_exige_senha(g.contrato_id),
    'motivo', case
      when not contrato_exige_senha(g.contrato_id) then 'sem_exigencia'
      when coalesce(g.senha, au.senha) is null or au.status is distinct from 'autorizada' then 'sem_senha'
      when au.qtd_autorizada is null or r.realizadas >= au.qtd_autorizada then 'cheia'
      when au.validade is not null and au.validade < current_date then 'senha_vencida'
      else 'aguardando' end)
  from guias g
  left join autorizacoes au on au.id = g.autorizacao_id
  cross join lateral (select count(distinct coalesce(i.atendimento_id, i.id))::int realizadas
                      from guia_itens i where i.guia_id = g.id) r
  where g.id = p_guia;
$$;
revoke execute on function situacao_guia_lote(uuid) from public, anon;

-- Guias abertas (fora de lote) por contrato, com elegibilidade e alertas
create or replace function lote_candidatas(p_clinica uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(meu_perfil(p_clinica)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(x order by x->>'contrato') from (
    select jsonb_build_object(
      'contrato_id', c.id, 'contrato', c.nome, 'versao', c.versao_tiss,
      'guias', jsonb_agg(jsonb_build_object(
        'id', g.id, 'numero', g.numero_guia_prestador, 'tipo', g.tipo, 'senha', coalesce(g.senha, au.senha),
        'paciente', pa.nome, 'carteirinha', pl.carteirinha, 'profissional', pr.nome,
        'primeira', (select min(i.data_realizacao) from guia_itens i where i.guia_id = g.id),
        'ultima', (select max(i.data_realizacao) from guia_itens i where i.guia_id = g.id),
        'valor', (select coalesce(sum(i.valor_informado), 0) from guia_itens i where i.guia_id = g.id),
        'situacao', situacao_guia_lote(g.id)) order by g.numero_guia_prestador)) x
    from guias g
    join contratos c on c.id = g.contrato_id
    join paciente_planos pl on pl.id = g.paciente_plano_id
    join pacientes pa on pa.id = pl.paciente_id
    join profissionais pr on pr.id = g.profissional_id
    left join autorizacoes au on au.id = g.autorizacao_id
    where g.clinica_id = p_clinica and g.lote_id is null and g.status in ('rascunho','pronta')
      and not coalesce((c.regras->>'sem_tiss')::boolean, false)
      and exists (select 1 from guia_itens i where i.guia_id = g.id)
    group by c.id, c.nome, c.versao_tiss) s(x)), '[]');
end $$;

-- Cria o lote com as guias escolhidas (revalida a regra)
create or replace function criar_lote(p_contrato uuid, p_competencia date, p_guias uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cli uuid; v_lote uuid; v_tipo text; v_num text; v_seq int; r record;
begin
  select clinica_id into v_cli from contratos where id = p_contrato;
  if coalesce(meu_perfil(v_cli)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if coalesce(array_length(p_guias, 1), 0) = 0 then raise exception 'Escolha ao menos uma guia.'; end if;
  if array_length(p_guias, 1) > 100 then raise exception 'O padrão TISS aceita no máximo 100 guias por lote.'; end if;

  for r in select g.*, situacao_guia_lote(g.id)->>'motivo' motivo from guias g where g.id = any(p_guias) loop
    if r.contrato_id <> p_contrato then raise exception 'A guia % é de outro contrato.', r.numero_guia_prestador; end if;
    if r.lote_id is not null or r.status not in ('rascunho','pronta') then
      raise exception 'A guia % já está em lote ou não está aberta.', r.numero_guia_prestador; end if;
    if r.motivo not in ('cheia','senha_vencida','sem_exigencia') then
      raise exception 'A guia % ainda não pode ir ao lote (%): só guia cheia ou com senha vencida.', r.numero_guia_prestador,
        case r.motivo when 'sem_senha' then 'sem senha' else 'sessões em aberto' end; end if;
    if v_tipo is null then v_tipo := r.tipo;
    elsif v_tipo <> r.tipo then raise exception 'Um lote só pode ter um tipo de guia (SP/SADT ou honorários).'; end if;
  end loop;
  if (select count(*) from guias where id = any(p_guias)) <> array_length(p_guias, 1) then raise exception 'Guia não encontrada.'; end if;

  -- Nº do lote: 9 + AAMM + sequência de 3 dígitos por contrato/mês (não colide com os números por data/hora do sistema da Motivar)
  select coalesce(max(substr(numero_lote, 6)::int), 0) + 1 into v_seq from lotes
   where contrato_id = p_contrato and numero_lote ~ ('^9' || to_char(p_competencia, 'YYMM') || '[0-9]{3}$');
  v_num := '9' || to_char(p_competencia, 'YYMM') || lpad(v_seq::text, 3, '0');

  insert into lotes (clinica_id, contrato_id, numero_lote, competencia, status, tipo_guia, qtd_guias, valor_total)
  values (v_cli, p_contrato, v_num, date_trunc('month', p_competencia)::date, 'fechado', v_tipo, array_length(p_guias, 1),
          (select coalesce(sum(valor_informado), 0) from guia_itens where guia_id = any(p_guias)))
  returning id into v_lote;
  update guias set lote_id = v_lote, status = 'pronta' where id = any(p_guias);
  return v_lote;
end $$;

-- Desfaz um lote ainda não enviado (guias voltam a ficar abertas)
create or replace function desfazer_lote(p_lote uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l lotes;
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if l.status <> 'fechado' then raise exception 'Lote já enviado não pode ser desfeito.'; end if;
  update guias set lote_id = null where lote_id = p_lote;
  delete from lotes where id = p_lote;
end $$;

-- Tudo o que o XML precisa, já com pendências que impedem o envio
create or replace function dados_xml_lote(p_lote uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l lotes; v jsonb;
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'lote', jsonb_build_object('id', l.id, 'numero', l.numero_lote, 'tipo', l.tipo_guia, 'status', l.status, 'competencia', l.competencia),
    'contrato', jsonb_build_object('nome', c.nome, 'versao', coalesce(c.versao_tiss, '4.03.00'),
       'codigo_prestador', c.codigo_prestador_operadora, 'registro_ans', o.registro_ans, 'operadora', o.nome,
       'cnpj', f.cnpj, 'cnes', f.cnes, 'razao_social', f.razao_social),
    'guias', coalesce((select jsonb_agg(jsonb_build_object(
       'numero', g.numero_guia_prestador, 'numero_operadora', coalesce(g.numero_guia_operadora, au.numero_guia_operadora),
       'senha', coalesce(g.senha, au.senha), 'data_autorizacao', au.data_autorizacao, 'validade_senha', au.validade,
       'carteirinha', pl.carteirinha, 'indicacao_clinica', coalesce(g.indicacao_clinica, au.indicacao_clinica),
       'tipo_atendimento', coalesce(g.tipo_atendimento, '03'), 'carater', coalesce(g.carater_atendimento, '1'),
       'regime', coalesce(g.regime_atendimento, '01'),
       'solicitante', (select jsonb_build_object('nome', s.nome, 'conselho', s.conselho, 'numero', s.numero_conselho,
                         'uf', s.uf_conselho, 'cbo', s.cbo) from solicitantes s where s.id = coalesce(g.solicitante_id, au.solicitante_id)),
       'itens', (select jsonb_agg(jsonb_build_object(
           'data', i.data_realizacao, 'quantidade', i.quantidade, 'valor', i.valor_informado,
           'tabela', p.codigo_tabela, 'codigo', p.codigo, 'descricao', p.descricao,
           'hora_inicio', to_char(at.inicio at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
           'hora_fim', to_char(at.fim at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
           'profissional', (select jsonb_build_object('nome', pr.nome, 'cpf', pr.cpf, 'conselho', pr.conselho,
               'numero', pr.numero_conselho, 'uf', pr.uf_conselho, 'cbo', pr.cbo)
             from profissionais pr where pr.id = coalesce(at.profissional_id, g.profissional_id)))
           order by i.data_realizacao, i.sequencial)
         from guia_itens i join procedimentos p on p.id = i.procedimento_id
         left join atendimentos at on at.id = i.atendimento_id
         where i.guia_id = g.id)) order by g.numero_guia_prestador)
       from guias g join paciente_planos pl on pl.id = g.paciente_plano_id
       left join autorizacoes au on au.id = g.autorizacao_id
       where g.lote_id = l.id), '[]'))
  into v
  from contratos c join operadoras o on o.id = c.operadora_id
  left join cnpjs_faturamento f on f.id = c.cnpj_faturamento_id
  where c.id = l.contrato_id;
  return v;
end $$;

-- Grava o XML gerado (só enquanto o lote não foi enviado)
create or replace function salvar_xml_lote(p_lote uuid, p_xml text, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare l lotes;
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if l.status <> 'fechado' then raise exception 'Lote já enviado: o XML não pode ser substituído.'; end if;
  update lotes set arquivo_xml = p_xml, hash_md5 = p_hash, gerado_em = now() where id = p_lote;
end $$;

-- Registra o envio: guias "enviada" + previsto a receber no financeiro
create or replace function registrar_envio_lote(p_lote uuid, p_data_envio date, p_protocolo text)
returns date language plpgsql security definer set search_path = public as $$
declare l lotes; c contratos; v_prazo int; v_venc date; v_cat uuid;
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if l.status <> 'fechado' then raise exception 'Este lote já foi enviado.'; end if;
  if l.arquivo_xml is null then raise exception 'Gere o XML antes de registrar o envio.'; end if;
  select * into c from contratos where id = l.contrato_id;
  v_prazo := coalesce((c.regras->>'prazo_pagamento_dias')::int, 30);   -- Amil: 30 dias corridos após a entrega
  v_venc := p_data_envio + v_prazo;

  update lotes set status = case when nullif(trim(p_protocolo), '') is null then 'enviado' else 'protocolado' end::status_lote,
    data_envio = p_data_envio, protocolo = nullif(trim(p_protocolo), ''), previsto_pagamento = v_venc where id = p_lote;
  update guias set status = 'enviada' where lote_id = p_lote;

  select id into v_cat from categorias_financeiras where clinica_id = l.clinica_id and nome = 'Convênios';
  delete from lancamentos where lote_id = p_lote and origem = 'lote' and status = 'previsto';
  insert into lancamentos (clinica_id, tipo, descricao, categoria_id, competencia, vencimento, valor_previsto,
    contrato_id, lote_id, fornecedor, origem, observacao)
  values (l.clinica_id, 'receber', 'Lote ' || l.numero_lote || ' – ' || c.nome, v_cat, l.competencia, v_venc, l.valor_total,
    c.id, l.id, c.nome, 'lote', l.qtd_guias || ' guias; previsto = valor informado (o retorno ajusta as glosas). Prazo ' || v_prazo || ' dias.');
  return v_venc;
end $$;

revoke execute on function lote_candidatas(uuid), criar_lote(uuid, date, uuid[]), desfazer_lote(uuid),
  dados_xml_lote(uuid), salvar_xml_lote(uuid, text, text), registrar_envio_lote(uuid, date, text) from public, anon;
grant execute on function lote_candidatas(uuid), criar_lote(uuid, date, uuid[]), desfazer_lote(uuid),
  dados_xml_lote(uuid), salvar_xml_lote(uuid, text, text), registrar_envio_lote(uuid, date, text) to authenticated;
