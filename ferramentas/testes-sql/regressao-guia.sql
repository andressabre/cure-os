-- =============================================================================
-- Testes de regressão das regras de guia, autorização e repasse (item 4 do backlog)
--
-- COMO FUNCIONA: um único bloco DO cria uma clínica de teste isolada, roda os casos e SEMPRE termina
-- com "raise exception 'RELATORIO …'". O erro final é proposital: ele desfaz tudo (nada fica no banco)
-- e a mensagem traz o resultado. Resultado bom = "RELATORIO: 0 falha(s)".
-- Rodar: Supabase SQL Editor ou MCP execute_sql (o arquivo inteiro, de uma vez). Não usa dado real:
-- só empresta o user_id de um usuário existente para simular o login dentro da transação.
-- Quando rodar: depois de qualquer migração que toque guia_atendimento*, calcular_repasse,
-- situacao_guia_lote, contrato_exige_senha ou a trava de autorização.
-- =============================================================================
do $teste$
declare
  v_user uuid; cl uuid; pr1 uuid; pr2 uuid; pa uuid; pa2 uuid; op uuid; cf uuid;
  ct uuid; ct2 uuid; ct3 uuid; pp uuid; ppv uuid; pp2 uuid; pp3 uuid; p1 uuid; p2 uuid; so uuid;
  au uuid; au2 uuid; au3 uuid; au4 uuid; a uuid; a2 uuid; g1 uuid; g2 uuid; g3 uuid;
  r jsonb; res text[] := '{}'; d date := current_date - 20; n numeric; v_txt text; v_falhas int;
  item1 jsonb; item2 jsonb;
begin
  select user_id into v_user from usuarios_clinica where ativo order by perfil limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- ---------- cenário ----------
  insert into clinicas (nome) values ('__TESTE DE REGRESSAO__') returning id into cl;
  insert into usuarios_clinica (user_id, clinica_id, perfil, ativo) values (v_user, cl, 'gestor', true);
  insert into profissionais (clinica_id, nome, conselho, numero_conselho, uf_conselho, cbo, especialidade) values (cl, 'Prof Teste 1', 'CREFITO', '1', 'SC', '223605', 'Fisioterapia') returning id into pr1;
  insert into profissionais (clinica_id, nome, conselho, numero_conselho, uf_conselho, cbo, especialidade) values (cl, 'Prof Teste 2', 'CRN', '2', 'SC', '223710', 'Nutrição') returning id into pr2;
  insert into pacientes (clinica_id, nome, cpf, data_nascimento) values (cl, 'Paciente Teste', '00000000000', '1990-01-01') returning id into pa;
  insert into pacientes (clinica_id, nome, cpf, data_nascimento) values (cl, 'Paciente Teste 2', '00000000001', '1991-01-01') returning id into pa2;
  insert into operadoras (clinica_id, nome, registro_ans) values (cl, 'Operadora Teste', '000000') returning id into op;
  insert into cnpjs_faturamento (clinica_id, razao_social, cnpj, cnes) values (cl, 'Empresa Teste', '00000000000000', '0000000') returning id into cf;
  insert into procedimentos (codigo, descricao) values ('TST-0001', 'Procedimento de teste 1') returning id into p1;
  insert into procedimentos (codigo, descricao) values ('TST-0002', 'Procedimento de teste 2 (sem valor)') returning id into p2;
  insert into solicitantes (clinica_id, nome, conselho, numero_conselho, uf_conselho) values (cl, 'Solicitante Teste', 'CRM', '9', 'SC') returning id into so;
  insert into contratos (clinica_id, operadora_id, cnpj_faturamento_id, nome, codigo_prestador_operadora, regras) values (cl, op, cf, 'Contrato Teste', '1', '{}') returning id into ct;
  insert into contratos (clinica_id, operadora_id, cnpj_faturamento_id, nome, codigo_prestador_operadora, regras) values (cl, op, cf, 'Contrato Guia por Sessão', '1', '{"guia_por_sessao": true}') returning id into ct2;
  insert into contratos (clinica_id, operadora_id, cnpj_faturamento_id, nome, regras) values (cl, op, cf, 'Acordo sem TISS', '{"sem_tiss": true}') returning id into ct3;
  insert into contrato_tabela (clinica_id, contrato_id, procedimento_id, valor, vigencia_inicio, tipo_guia) values
    (cl, ct, p1, 100, d - 100, 'SP_SADT'), (cl, ct2, p1, 80, d - 100, 'SP_SADT'), (cl, ct3, p1, 50, d - 100, 'SP_SADT');
  insert into regras_repasse (clinica_id, profissional_id, tipo, valor, vigencia_inicio) values (cl, pr1, 'percentual', 10, d - 100);
  insert into paciente_planos (clinica_id, paciente_id, contrato_id, carteirinha) values (cl, pa, ct, '111') returning id into pp;
  insert into paciente_planos (clinica_id, paciente_id, contrato_id, carteirinha, validade) values (cl, pa2, ct, '222', d - 5) returning id into ppv;
  insert into paciente_planos (clinica_id, paciente_id, contrato_id, carteirinha) values (cl, pa, ct2, '333') returning id into pp2;
  insert into paciente_planos (clinica_id, paciente_id, contrato_id, carteirinha) values (cl, pa, ct3, '444') returning id into pp3;
  insert into autorizacoes (clinica_id, paciente_plano_id, profissional_id, procedimento_id, senha, qtd_autorizada, data_autorizacao, validade, solicitante_id, cid, status)
    values (cl, pp, pr1, p1, 'S1', 2, d - 1, d + 60, so, 'M54.5', 'autorizada') returning id into au;
  item1 := jsonb_build_array(jsonb_build_object('procedimento_id', p1, 'quantidade', 1));
  item2 := jsonb_build_array(jsonb_build_object('procedimento_id', p2, 'quantidade', 1));

  -- T01 prévia limpa: sem bloqueio, valor 100, repasse 10 %
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id, autorizacao_id)
    values (cl, pa, pr1, (d + time '10:00') at time zone 'America/Sao_Paulo', (d + time '10:45') at time zone 'America/Sao_Paulo', pp, au) returning id into a;
  r := guia_atendimento(a, pp, au, item1, false);
  res := res || case when jsonb_array_length(r->'bloqueios') = 0 and (r->'itens'->0->>'valor')::numeric = 100 and (r->'itens'->0->>'repasse')::numeric = 10
    then 'ok    T01 prévia sem bloqueio, valor e repasse' else 'FALHA T01 prévia: ' || r::text end;

  -- T02 gravação abre 1 guia e marca atendido
  r := guia_atendimento(a, pp, au, item1, true); g1 := (r->'guias'->0->>'id')::uuid;
  res := res || case when (r->>'gravado')::boolean and (r->'guias'->0->>'nova')::boolean and (select status from atendimentos where id = a) = 'atendido'
    then 'ok    T02 gravação cria guia e marca atendido' else 'FALHA T02 gravação: ' || r::text end;

  -- T03 glosa 3209: mesmo procedimento, mesmo paciente, mesmo dia
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id, autorizacao_id)
    values (cl, pa, pr1, (d + time '15:00') at time zone 'America/Sao_Paulo', (d + time '15:45') at time zone 'America/Sao_Paulo', pp, au) returning id into a2;
  r := guia_atendimento(a2, pp, au, item1, false);
  res := res || case when r->'bloqueios' @? '$[*] ? (@ like_regex "3209")' then 'ok    T03 bloqueia duplicidade (3209)' else 'FALHA T03 3209: ' || (r->'bloqueios')::text end;

  -- T04 uma guia por senha: 2ª sessão em outro dia entra na MESMA guia
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id, autorizacao_id)
    values (cl, pa, pr1, (d + 1 + time '10:00') at time zone 'America/Sao_Paulo', (d + 1 + time '10:45') at time zone 'America/Sao_Paulo', pp, au) returning id into a;
  r := guia_atendimento(a, pp, au, item1, true);
  res := res || case when (r->'guias'->0->>'id')::uuid = g1 and not (r->'guias'->0->>'nova')::boolean and (select count(*) from guia_itens where guia_id = g1) = 2
    then 'ok    T04 segunda sessão entra na mesma guia (1 guia por senha)' else 'FALHA T04 guia por senha: ' || r::text end;

  -- T05 glosa 3292: 3ª sessão numa senha de 2
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id, autorizacao_id)
    values (cl, pa, pr1, (d + 2 + time '10:00') at time zone 'America/Sao_Paulo', (d + 2 + time '10:45') at time zone 'America/Sao_Paulo', pp, au) returning id into a;
  r := guia_atendimento(a, pp, au, item1, false);
  res := res || case when r->'bloqueios' @? '$[*] ? (@ like_regex "3292")' then 'ok    T05 bloqueia sessão além da autorizada (3292)' else 'FALHA T05 3292: ' || (r->'bloqueios')::text end;

  -- T06 guia cheia é liberada para o lote
  v_txt := situacao_guia_lote(g1)->>'motivo';
  res := res || case when v_txt = 'cheia' then 'ok    T06 guia com todas as sessões = cheia' else 'FALHA T06 situação da guia: ' || coalesce(v_txt, 'nulo') end;

  -- T07 glosa 1814: autorização com data posterior ao atendimento
  insert into autorizacoes (clinica_id, paciente_plano_id, profissional_id, procedimento_id, senha, qtd_autorizada, data_autorizacao, validade, solicitante_id, status)
    values (cl, pp, pr1, p1, 'S2', 5, d + 5, d + 60, so, 'autorizada') returning id into au2;
  r := guia_atendimento(a, pp, au2, item1, false);
  res := res || case when r->'bloqueios' @? '$[*] ? (@ like_regex "1814")' then 'ok    T07 bloqueia autorização posterior ao atendimento (1814)' else 'FALHA T07 1814: ' || (r->'bloqueios')::text end;

  -- T08 senha vencida na data do atendimento
  insert into autorizacoes (clinica_id, paciente_plano_id, profissional_id, procedimento_id, senha, qtd_autorizada, data_autorizacao, validade, solicitante_id, status)
    values (cl, pp, pr1, p1, 'S3', 5, d - 30, d - 1, so, 'autorizada') returning id into au3;
  r := guia_atendimento(a, pp, au3, item1, false);
  res := res || case when r->'bloqueios' @? '$[*] ? (@ like_regex "Autoriza..o vencida")' then 'ok    T08 bloqueia senha vencida' else 'FALHA T08 senha vencida: ' || (r->'bloqueios')::text end;

  -- T09 procedimento sem valor na tabela do contrato
  r := guia_atendimento(a, pp, au2, item2, false);
  res := res || case when r->'bloqueios' @? '$[*] ? (@ like_regex "sem valor vigente")' then 'ok    T09 bloqueia procedimento sem valor' else 'FALHA T09 sem valor: ' || (r->'bloqueios')::text end;

  -- T10 carteirinha vencida
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id)
    values (cl, pa2, pr1, (d + 3 + time '10:00') at time zone 'America/Sao_Paulo', (d + 3 + time '10:45') at time zone 'America/Sao_Paulo', ppv) returning id into a2;
  r := guia_atendimento(a2, ppv, null, item1, false);
  res := res || case when r->'bloqueios' @? '$[*] ? (@ like_regex "Carteirinha vencida")' then 'ok    T10 bloqueia carteirinha vencida' else 'FALHA T10 carteirinha: ' || (r->'bloqueios')::text end;

  -- T11 trava: "autorizada" sem senha é recusada
  begin
    insert into autorizacoes (clinica_id, paciente_plano_id, procedimento_id, qtd_autorizada, status) values (cl, pp, p1, 1, 'autorizada');
    res := res || 'FALHA T11 aceitou autorizada sem senha'::text;
  exception when raise_exception then res := res || 'ok    T11 recusa autorizada sem senha'::text; end;

  -- T12 sem autorização em contrato que exige senha: grava, cria solicitação pendente e a guia fica "sem_senha"
  update atendimentos set autorizacao_id = null where id = a;
  r := guia_atendimento(a, pp, null, item1, true, jsonb_build_object('solicitante_id', so)); g2 := (r->'guias'->0->>'id')::uuid;
  res := res || case when (r->>'sem_senha')::boolean and (select status from autorizacoes where id = (r->>'autorizacao_id')::uuid) = 'pendente'
      and situacao_guia_lote(g2)->>'motivo' = 'sem_senha'
    then 'ok    T12 sem autorização vira solicitação pendente e guia fica fora do lote' else 'FALHA T12 sem senha: ' || r::text end;

  -- T13 precedência do repasse: contrato+procedimento > contrato > procedimento > geral
  insert into regras_repasse (clinica_id, profissional_id, procedimento_id, tipo, valor, vigencia_inicio) values (cl, pr1, p1, 'percentual', 20, d - 100);
  insert into regras_repasse (clinica_id, profissional_id, contrato_id, tipo, valor, vigencia_inicio) values (cl, pr1, ct, 'percentual', 30, d - 100);
  insert into regras_repasse (clinica_id, profissional_id, contrato_id, procedimento_id, tipo, valor, vigencia_inicio) values (cl, pr1, ct, p1, 'fixo', 40, d - 100);
  v_txt := calcular_repasse(pr1, ct, p1, d, 100)::text;
  delete from regras_repasse where profissional_id = pr1 and contrato_id = ct and procedimento_id = p1;
  v_txt := v_txt || '/' || calcular_repasse(pr1, ct, p1, d, 100)::text;
  delete from regras_repasse where profissional_id = pr1 and contrato_id = ct;
  v_txt := v_txt || '/' || calcular_repasse(pr1, ct, p1, d, 100)::text;
  delete from regras_repasse where profissional_id = pr1 and procedimento_id = p1;
  v_txt := v_txt || '/' || calcular_repasse(pr1, ct, p1, d, 100)::text;
  res := res || case when v_txt in ('40/30.00/20.00/10.00', '40.00/30.00/20.00/10.00') then 'ok    T13 precedência do repasse' else 'FALHA T13 precedência: ' || v_txt end;

  -- T14 vigência do repasse vale pela data do atendimento
  insert into regras_repasse (clinica_id, profissional_id, tipo, valor, vigencia_inicio) values (cl, pr1, 'percentual', 50, d + 1);
  res := res || case when calcular_repasse(pr1, ct, p1, d, 100) = 10 and calcular_repasse(pr1, ct, p1, d + 1, 100) = 50
    then 'ok    T14 vigência do repasse pela data' else 'FALHA T14 vigência: ' || calcular_repasse(pr1, ct, p1, d, 100)::text || ' / ' || calcular_repasse(pr1, ct, p1, d + 1, 100)::text end;

  -- T15 contrato com guia por sessão: cada atendimento abre uma guia
  insert into autorizacoes (clinica_id, paciente_plano_id, profissional_id, procedimento_id, senha, qtd_autorizada, data_autorizacao, validade, solicitante_id, status)
    values (cl, pp2, pr1, p1, 'S4', 3, d - 1, d + 60, so, 'autorizada') returning id into au4;
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id, autorizacao_id)
    values (cl, pa, pr1, (d + 7 + time '10:00') at time zone 'America/Sao_Paulo', (d + 7 + time '10:45') at time zone 'America/Sao_Paulo', pp2, au4) returning id into a;
  r := guia_atendimento(a, pp2, au4, item1, true); g2 := (r->'guias'->0->>'id')::uuid;
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id, autorizacao_id)
    values (cl, pa, pr1, (d + 8 + time '10:00') at time zone 'America/Sao_Paulo', (d + 8 + time '10:45') at time zone 'America/Sao_Paulo', pp2, au4) returning id into a;
  r := guia_atendimento(a, pp2, au4, item1, true); g3 := (r->'guias'->0->>'id')::uuid;
  res := res || case when g2 is not null and g3 is not null and g2 <> g3 and situacao_guia_lote(g3)->>'motivo' = 'cheia'
    then 'ok    T15 guia por sessão abre uma guia por atendimento' else 'FALHA T15 guia por sessão: ' || r::text end;

  -- T16 acordo sem TISS: registra o atendimento, sem guia
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id)
    values (cl, pa, pr1, (d + 9 + time '10:00') at time zone 'America/Sao_Paulo', (d + 9 + time '10:45') at time zone 'America/Sao_Paulo', pp3) returning id into a;
  r := guia_atendimento(a, pp3, null, item1, true);
  res := res || case when (r->>'gravado')::boolean and jsonb_array_length(r->'guias') = 0 and not exists (select 1 from guias where atendimento_id = a)
    then 'ok    T16 acordo sem TISS não gera guia' else 'FALHA T16 sem TISS: ' || r::text end;

  -- T17 profissional não vê o valor da clínica e não fecha atendimento de outro
  update usuarios_clinica set perfil = 'profissional', profissional_id = pr1 where user_id = v_user and clinica_id = cl;
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id)
    values (cl, pa, pr1, (d + 10 + time '10:00') at time zone 'America/Sao_Paulo', (d + 10 + time '10:45') at time zone 'America/Sao_Paulo', pp) returning id into a;
  r := guia_atendimento(a, pp, au2, item1, false);
  res := res || case when r->'itens'->0->'valor' = 'null'::jsonb and (r->'itens'->0->>'repasse') is not null
    then 'ok    T17 profissional vê o repasse, não o valor da clínica' else 'FALHA T17 valor exposto ao profissional: ' || (r->'itens')::text end;
  insert into atendimentos (clinica_id, paciente_id, profissional_id, inicio, fim, paciente_plano_id)
    values (cl, pa, pr2, (d + 11 + time '10:00') at time zone 'America/Sao_Paulo', (d + 11 + time '10:45') at time zone 'America/Sao_Paulo', pp) returning id into a2;
  begin
    r := guia_atendimento(a2, pp, null, item1, false);
    res := res || 'FALHA T18 profissional abriu a guia de atendimento de outro profissional'::text;
  exception when raise_exception then res := res || 'ok    T18 profissional não fecha atendimento de outro'::text; end;

  -- T19 quem não é da clínica não passa
  delete from usuarios_clinica where user_id = v_user and clinica_id = cl;
  begin
    r := guia_atendimento(a, pp, null, item1, false);
    res := res || 'FALHA T19 usuário sem vínculo com a clínica abriu a guia'::text;
  exception when raise_exception then res := res || 'ok    T19 usuário de fora da clínica é barrado'::text; end;

  select count(*) into v_falhas from unnest(res) x where x like 'FALHA%';
  raise exception E'RELATORIO: % falha(s) em % testes (nada foi gravado)\n%', v_falhas, array_length(res, 1), array_to_string(res, E'\n');
end $teste$;
