-- =====================================================================
-- CURE OS — Migração 014: autorização no agendamento + 1 guia por senha/mês
-- Decisões da gestora (08/11/2026):
--  • Agendar convênio exige vínculo com uma autorização (existente com saldo
--    ou solicitação nova "pendente"). Pendente vira tarefa "Autorizar guia"
--    para recepção, gestão e o profissional do atendimento.
--  • Uma senha (ex.: 10 sessões) = UMA guia SP/SADT por mês; cada atendimento
--    vira um item (data de realização) dessa guia. Lote mensal leva o que foi
--    realizado no mês; o saldo segue na guia do mês seguinte, mesma senha.
-- Substitui guias_sem_senha / informar_senha_guia (013).
-- =====================================================================

alter table autorizacoes alter column data_autorizacao drop not null,
  add column if not exists status text not null default 'autorizada'
    check (status in ('pendente','autorizada','negada','cancelada')),
  add column if not exists qtd_solicitada int,
  add column if not exists solicitada_em timestamptz not null default now(),
  add column if not exists observacao text;
alter table guia_itens add column if not exists atendimento_id uuid references atendimentos;
create index if not exists guia_itens_atendimento on guia_itens (atendimento_id);

drop function if exists guias_sem_senha(uuid);
drop function if exists informar_senha_guia(uuid, text, date, date, int);

create or replace function contrato_exige_senha(p_contrato uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((c.regras->>'sem_tiss')::boolean, false)
     and coalesce((c.regras->>'exige_autorizacao')::boolean, true)
     and exists (select 1 from contrato_tabela t where t.contrato_id = c.id and t.tipo_guia <> 'PARTICULAR')
  from contratos c where c.id = p_contrato;
$$;

-- Convênios do paciente com autorizações e saldo (para o agendamento)
create or replace function autorizacoes_paciente(p_paciente uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cli uuid;
begin
  select clinica_id into v_cli from pacientes where id = p_paciente;
  if meu_perfil(v_cli) is null then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', pl.id, 'contrato', c.nome, 'carteirinha', pl.carteirinha, 'validade', pl.validade, 'principal', pl.principal,
    'exige', contrato_exige_senha(c.id),
    'procedimentos', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'codigo', p.codigo, 'descricao', p.descricao))
       from contrato_tabela t join procedimentos p on p.id = t.procedimento_id
       where t.contrato_id = c.id and (t.vigencia_fim is null or t.vigencia_fim >= current_date)), '[]'),
    'autorizacoes', coalesce((select jsonb_agg(jsonb_build_object('id', au.id, 'status', au.status, 'senha', au.senha,
         'codigo', p.codigo, 'qtd', au.qtd_autorizada, 'data', au.data_autorizacao, 'validade', au.validade,
         'usadas', (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status = 'atendido'),
         'agendadas', (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente')))
       order by au.solicitada_em desc)
       from autorizacoes au join procedimentos p on p.id = au.procedimento_id
       where au.paciente_plano_id = pl.id and au.status in ('pendente','autorizada')), '[]')
  ) order by pl.principal desc)
  from paciente_planos pl join contratos c on c.id = pl.contrato_id where pl.paciente_id = p_paciente), '[]');
end $$;

-- Fechamento: valida pela função da 009 (prévia) e grava agrupando por senha/mês
create or replace function guia_atendimento(p_atendimento uuid, p_plano uuid, p_autorizacao uuid,
  p_itens jsonb, p_gravar boolean default false, p_dados jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; a atendimentos; pl paciente_planos; c contratos; au autorizacoes; v_aut uuid := p_autorizacao;
  v_exige boolean; v_data date; v_tipo text; v_guia uuid; v_num bigint; v_seq int; it jsonb; v_tab contrato_tabela;
  v_guias jsonb := '[]'; v_bloq jsonb; v_avis jsonb; v_sol uuid; v_cid text; v_ind text; v_tipo_at text; v_novo boolean;
begin
  select * into a from atendimentos where id = p_atendimento;
  if a.id is null then raise exception 'Atendimento não encontrado'; end if;
  select * into pl from paciente_planos where id = p_plano and paciente_id = a.paciente_id;
  if pl.id is null then raise exception 'Convênio do paciente não encontrado'; end if;
  select * into c from contratos where id = pl.contrato_id;
  v_exige := coalesce(contrato_exige_senha(c.id), false);
  if v_aut is null and a.autorizacao_id is not null
     and exists (select 1 from autorizacoes where id = a.autorizacao_id and paciente_plano_id = pl.id) then
    v_aut := a.autorizacao_id;
  end if;
  select * into au from autorizacoes where id = v_aut;

  r := guia_atendimento_base(p_atendimento, p_plano, v_aut, p_itens, false, p_dados);  -- permissões + bloqueios + valores
  v_bloq := coalesce(r->'bloqueios', '[]'); v_avis := coalesce(r->'avisos', '[]');
  if exists (select 1 from guia_itens i join guias g on g.id = i.guia_id where i.atendimento_id = a.id and g.status <> 'cancelada') then
    v_bloq := v_bloq || to_jsonb('Este atendimento já está em uma guia.'::text);
  end if;
  if au.status in ('negada','cancelada') then
    v_bloq := v_bloq || to_jsonb(('Autorização ' || au.status || ': escolha outra ou atenda como particular.')::text);
  elsif v_exige and (au.id is null or au.status = 'pendente' or nullif(trim(au.senha), '') is null) then
    v_avis := v_avis || to_jsonb((case when au.id is null
      then 'Sem autorização: será criada uma solicitação PENDENTE (tarefa "Autorizar guia"). A guia não entra no lote sem senha.'
      else 'Autorização ainda PENDENTE (sem senha): a guia não entra no lote até a senha ser informada.' end)::text);
  end if;
  r := r || jsonb_build_object('bloqueios', v_bloq, 'avisos', v_avis, 'autorizacao_id', v_aut,
    'sem_senha', v_exige and (au.id is null or nullif(trim(au.senha), '') is null));
  if not p_gravar or jsonb_array_length(v_bloq) > 0 then return r; end if;

  -- ---------- Gravação ----------
  v_data := (a.inicio at time zone 'America/Sao_Paulo')::date;
  v_sol := coalesce(nullif(p_dados->>'solicitante_id', '')::uuid, au.solicitante_id);
  v_cid := upper(nullif(trim(coalesce(p_dados->>'cid', au.cid, '')), ''));
  v_ind := nullif(trim(coalesce(p_dados->>'indicacao_clinica', au.indicacao_clinica, '')), '');
  v_tipo_at := coalesce(nullif(p_dados->>'tipo_atendimento', ''), '03');

  if v_exige and au.id is null then
    insert into autorizacoes (clinica_id, paciente_plano_id, profissional_id, procedimento_id, qtd_autorizada, qtd_solicitada,
      status, solicitante_id, cid, indicacao_clinica, observacao)
    values (a.clinica_id, pl.id, a.profissional_id, (r->'itens'->0->>'procedimento_id')::uuid, 1, 1,
      'pendente', v_sol, v_cid, v_ind, 'Criada no fechamento do atendimento sem autorização')
    returning * into au;
    v_aut := au.id;
  end if;

  update atendimentos set status = 'atendido', paciente_plano_id = pl.id, autorizacao_id = v_aut, atualizado_em = now() where id = a.id;

  if not coalesce((c.regras->>'sem_tiss')::boolean, false) then
    perform pg_advisory_xact_lock(hashtext(c.id::text));
    for v_tipo in select distinct x->>'tipo_guia' from jsonb_array_elements(r->'itens') x loop
      v_guia := null; v_novo := false;
      if v_aut is not null then  -- mesma senha, mesmo mês, mesmo profissional, ainda fora de lote → acrescenta
        select g.id into v_guia from guias g
        where g.autorizacao_id = v_aut and g.tipo = v_tipo and g.profissional_id = a.profissional_id
          and g.status in ('rascunho','pronta') and g.lote_id is null
          and date_trunc('month', g.data_atendimento) = date_trunc('month', v_data)
        order by g.data_atendimento limit 1;
      end if;
      if v_guia is null then
        v_novo := true;
        select coalesce(max(numero_guia_prestador::bigint), 0) + 1 into v_num
          from guias where contrato_id = c.id and numero_guia_prestador ~ '^\d+$';
        insert into guias (clinica_id, contrato_id, paciente_plano_id, profissional_id, autorizacao_id, atendimento_id,
                           tipo, numero_guia_prestador, numero_guia_operadora, senha, data_atendimento, status,
                           solicitante_id, cid, indicacao_clinica, tipo_atendimento, carater_atendimento, regime_atendimento, hora_inicio, hora_fim)
        values (a.clinica_id, c.id, pl.id, a.profissional_id, v_aut, a.id, v_tipo, v_num::text,
                au.numero_guia_operadora, au.senha, v_data, 'pronta', v_sol, v_cid, v_ind, v_tipo_at, '1', '01',
                (a.inicio at time zone 'America/Sao_Paulo')::time, (a.fim at time zone 'America/Sao_Paulo')::time)
        returning id into v_guia;
      end if;
      select coalesce(max(sequencial), 0) into v_seq from guia_itens where guia_id = v_guia;
      for it in select x from jsonb_array_elements(r->'itens') x where x->>'tipo_guia' = v_tipo loop
        v_seq := v_seq + 1;
        select * into v_tab from contrato_tabela t where t.contrato_id = c.id and t.procedimento_id = (it->>'procedimento_id')::uuid
          and t.vigencia_inicio <= v_data and (t.vigencia_fim is null or t.vigencia_fim >= v_data)
          order by t.vigencia_inicio desc limit 1;
        insert into guia_itens (clinica_id, guia_id, procedimento_id, sequencial, data_realizacao, quantidade, valor_informado,
                                repasse_previsto, atendimento_id)
        values (a.clinica_id, v_guia, (it->>'procedimento_id')::uuid, v_seq, v_data, (it->>'quantidade')::numeric,
                v_tab.valor * (it->>'quantidade')::numeric, (it->>'repasse')::numeric, a.id);
      end loop;
      v_guias := v_guias || jsonb_build_object('id', v_guia,
        'numero', (select numero_guia_prestador from guias where id = v_guia), 'tipo', v_tipo, 'nova', v_novo);
    end loop;
  end if;
  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
    values (a.clinica_id, auth.uid(), 'guias', a.id, 'guia_atendimento', jsonb_build_object('guias', v_guias, 'autorizacao', v_aut, 'avisos', v_avis));
  return r || jsonb_build_object('guias', v_guias, 'gravado', true, 'autorizacao_id', v_aut);
end $$;

-- Tarefas "Autorizar guia": profissional vê só as ligadas a ele
create or replace function autorizacoes_pendentes(p_clinica uuid) returns table (
  autorizacao_id uuid, paciente text, carteirinha text, contrato text, procedimento text, qtd_solicitada int,
  agendados bigint, atendidos bigint, primeira_data date, profissionais text, dias int)
language sql stable security definer set search_path = public as $$
  select au.id, pa.nome, pl.carteirinha, c.nome, p.codigo || ' · ' || p.descricao, coalesce(au.qtd_solicitada, au.qtd_autorizada),
    (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente')),
    (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status = 'atendido'),
    (select min((x.inicio at time zone 'America/Sao_Paulo')::date) from atendimentos x where x.autorizacao_id = au.id and x.status <> 'cancelado'),
    (select string_agg(distinct pr.nome, ', ') from atendimentos x join profissionais pr on pr.id = x.profissional_id where x.autorizacao_id = au.id),
    (current_date - au.solicitada_em::date)
  from autorizacoes au
  join paciente_planos pl on pl.id = au.paciente_plano_id join pacientes pa on pa.id = pl.paciente_id
  join contratos c on c.id = pl.contrato_id join procedimentos p on p.id = au.procedimento_id
  where au.clinica_id = p_clinica and au.status = 'pendente'
    and meu_perfil(p_clinica) is not null
    and (meu_perfil(p_clinica) <> 'profissional'
         or au.profissional_id = meu_profissional(p_clinica)
         or exists (select 1 from atendimentos x where x.autorizacao_id = au.id and x.profissional_id = meu_profissional(p_clinica)))
  order by 9 nulls last, au.solicitada_em;
$$;

-- Informar o retorno da operadora: autorizada (senha) ou negada
create or replace function responder_autorizacao(p_aut uuid, p_status text, p_senha text default null,
  p_data date default null, p_validade date default null, p_qtd int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare au autorizacoes; v_perfil perfil_usuario; v_min date; v_max date; v_ag int; v_av text[] := '{}';
begin
  select * into au from autorizacoes where id = p_aut;
  if au.id is null then raise exception 'Autorização não encontrada'; end if;
  v_perfil := meu_perfil(au.clinica_id);
  if v_perfil is null or (v_perfil = 'profissional' and au.profissional_id is distinct from meu_profissional(au.clinica_id)
     and not exists (select 1 from atendimentos x where x.autorizacao_id = au.id and x.profissional_id = meu_profissional(au.clinica_id))) then
    raise exception 'Sem permissão para esta autorização';
  end if;
  select count(*) into v_ag from atendimentos where autorizacao_id = au.id and status in ('agendado','confirmado','presente');
  if p_status = 'negada' then
    update autorizacoes set status = 'negada', observacao = coalesce(observacao || ' · ', '') || 'Negada em ' || to_char(current_date, 'DD/MM/YYYY') where id = au.id;
    if v_ag > 0 then v_av := v_av || (v_ag || ' atendimento(s) agendado(s) estão ligados a esta autorização: remarque como particular ou peça nova autorização.'); end if;
    return jsonb_build_object('avisos', to_jsonb(v_av));
  end if;
  if p_status <> 'autorizada' then raise exception 'Situação inválida'; end if;
  if nullif(trim(p_senha), '') is null then raise exception 'Informe a senha.'; end if;
  if p_data is null then raise exception 'Informe a data da autorização.'; end if;
  select min(i.data_realizacao), max(i.data_realizacao) into v_min, v_max
    from guia_itens i join guias g on g.id = i.guia_id where g.autorizacao_id = au.id and g.status <> 'cancelada';
  if v_min is not null and p_data > v_min then
    raise exception 'Data da autorização (%) é posterior à 1ª sessão já realizada (%): glosa 1814. Confira a data.', to_char(p_data, 'DD/MM/YYYY'), to_char(v_min, 'DD/MM/YYYY');
  end if;
  if p_validade is not null and v_max is not null and p_validade < v_max then
    raise exception 'Senha válida até %, antes de sessão já realizada em %.', to_char(p_validade, 'DD/MM/YYYY'), to_char(v_max, 'DD/MM/YYYY');
  end if;
  update autorizacoes set status = 'autorizada', senha = trim(p_senha), data_autorizacao = p_data, validade = p_validade,
    qtd_autorizada = coalesce(p_qtd, qtd_autorizada) where id = au.id;
  update guias set senha = trim(p_senha) where autorizacao_id = au.id and status in ('rascunho','pronta');
  if exists (select 1 from atendimentos x where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente')
             and p_validade is not null and (x.inicio at time zone 'America/Sao_Paulo')::date > p_validade) then
    v_av := v_av || 'Há sessões agendadas depois da validade da senha: remarque ou peça prorrogação.'::text;
  end if;
  if coalesce(p_qtd, au.qtd_autorizada) < (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status <> 'cancelado' and x.status <> 'faltou') then
    v_av := v_av || 'Há mais sessões ligadas do que o autorizado: as excedentes serão bloqueadas no fechamento (glosa 3292).'::text;
  end if;
  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
    values (au.clinica_id, auth.uid(), 'autorizacoes', au.id, 'responder', jsonb_build_object('senha', p_senha, 'data', p_data, 'validade', p_validade, 'qtd', p_qtd));
  return jsonb_build_object('avisos', to_jsonb(v_av));
end $$;

revoke all on function contrato_exige_senha(uuid), autorizacoes_paciente(uuid), autorizacoes_pendentes(uuid),
  responder_autorizacao(uuid, text, text, date, date, int) from public, anon;
grant execute on function contrato_exige_senha(uuid), autorizacoes_paciente(uuid), autorizacoes_pendentes(uuid),
  responder_autorizacao(uuid, text, text, date, date, int) to authenticated;
