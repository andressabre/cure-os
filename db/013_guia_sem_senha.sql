-- =====================================================================
-- CURE OS — Migração 013: guia sem senha de autorização
-- Decisão da gestora (08/11/2026): quase todos os convênios exigem senha.
-- Guia sem senha NÃO bloqueia o fechamento: fica "pendente de senha",
-- gera alerta ao profissional e à gestão, e a senha é informada depois
-- (data da autorização ≤ data realizada; validade ≥ data realizada).
-- Contrato que não exige senha: regras.exige_autorizacao = false.
-- =====================================================================

-- 1) Aviso no fechamento (envolve a função da 009 sem reescrevê-la)
alter function guia_atendimento(uuid, uuid, uuid, jsonb, boolean, jsonb) rename to guia_atendimento_base;

create or replace function guia_atendimento(p_atendimento uuid, p_plano uuid, p_autorizacao uuid,
  p_itens jsonb, p_gravar boolean default false, p_dados jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; c contratos;
begin
  r := guia_atendimento_base(p_atendimento, p_plano, p_autorizacao, p_itens, p_gravar, p_dados);
  select ct.* into c from paciente_planos pl join contratos ct on ct.id = pl.contrato_id where pl.id = p_plano;
  if p_autorizacao is null and c.id is not null
     and not coalesce((c.regras->>'sem_tiss')::boolean, false)
     and coalesce((c.regras->>'exige_autorizacao')::boolean, true)
     and exists (select 1 from contrato_tabela t where t.contrato_id = c.id and t.tipo_guia <> 'PARTICULAR') then
    r := jsonb_set(r, '{avisos}', coalesce(r->'avisos', '[]') ||
      to_jsonb('Sem senha de autorização: a guia fica PENDENTE DE SENHA e não entra no lote até a senha ser informada.'::text));
    r := r || jsonb_build_object('sem_senha', true);
  end if;
  return r;
end $$;
revoke execute on function guia_atendimento_base(uuid, uuid, uuid, jsonb, boolean, jsonb) from public, anon, authenticated;
revoke all on function guia_atendimento(uuid, uuid, uuid, jsonb, boolean, jsonb) from public, anon;
grant execute on function guia_atendimento(uuid, uuid, uuid, jsonb, boolean, jsonb) to authenticated;

-- 2) Lista de guias pendentes de senha (profissional vê só as próprias, sem valores)
create or replace function guias_sem_senha(p_clinica uuid) returns table (
  guia_id uuid, numero text, data_atendimento date, paciente text, carteirinha text, contrato text,
  profissional text, procedimentos text, qtd numeric, dias int)
language sql stable security definer set search_path = public as $$
  select g.id, g.numero_guia_prestador, g.data_atendimento, pa.nome, pl.carteirinha, c.nome, pr.nome,
    (select string_agg(p.codigo, ', ' order by i.sequencial) from guia_itens i join procedimentos p on p.id = i.procedimento_id where i.guia_id = g.id),
    (select sum(i.quantidade) from guia_itens i where i.guia_id = g.id),
    (current_date - g.data_atendimento)
  from guias g
  join paciente_planos pl on pl.id = g.paciente_plano_id join pacientes pa on pa.id = pl.paciente_id
  join contratos c on c.id = g.contrato_id join profissionais pr on pr.id = g.profissional_id
  where g.clinica_id = p_clinica and g.status in ('rascunho','pronta')
    and g.autorizacao_id is null and nullif(trim(g.senha), '') is null
    and not coalesce((c.regras->>'sem_tiss')::boolean, false)
    and coalesce((c.regras->>'exige_autorizacao')::boolean, true)
    and g.tipo <> 'PARTICULAR'
    and meu_perfil(p_clinica) is not null
    and (meu_perfil(p_clinica) <> 'profissional' or g.profissional_id = meu_profissional(p_clinica))
  order by g.data_atendimento;
$$;

-- 3) Informar a senha depois: cria a autorização e vincula à guia
create or replace function informar_senha_guia(p_guia uuid, p_senha text, p_data date, p_validade date, p_qtd int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g guias; v_perfil perfil_usuario; v_proc uuid; v_qtd numeric; v_aut uuid;
begin
  select * into g from guias where id = p_guia;
  if g.id is null then raise exception 'Guia não encontrada'; end if;
  v_perfil := meu_perfil(g.clinica_id);
  if v_perfil is null or (v_perfil = 'profissional' and g.profissional_id is distinct from meu_profissional(g.clinica_id)) then
    raise exception 'Sem permissão para esta guia';
  end if;
  if g.status not in ('rascunho','pronta') then raise exception 'Guia já enviada: senha não pode mais ser alterada aqui.'; end if;
  if nullif(trim(p_senha), '') is null then raise exception 'Informe a senha.'; end if;
  if p_data is null then raise exception 'Informe a data da autorização.'; end if;
  if p_data > g.data_atendimento then
    raise exception 'Autorização de % é posterior ao atendimento de % (glosa 1814). Confira a data.', to_char(p_data, 'DD/MM/YYYY'), to_char(g.data_atendimento, 'DD/MM/YYYY');
  end if;
  if p_validade is not null and p_validade < g.data_atendimento then
    raise exception 'Senha válida até %, antes do atendimento de %.', to_char(p_validade, 'DD/MM/YYYY'), to_char(g.data_atendimento, 'DD/MM/YYYY');
  end if;
  select i.procedimento_id, sum(i.quantidade) into v_proc, v_qtd from guia_itens i where i.guia_id = g.id
    group by i.procedimento_id order by sum(i.quantidade) desc limit 1;
  insert into autorizacoes (clinica_id, paciente_plano_id, profissional_id, procedimento_id, senha, qtd_autorizada,
    data_autorizacao, validade, solicitante_id, cid, indicacao_clinica)
  values (g.clinica_id, g.paciente_plano_id, g.profissional_id, v_proc, trim(p_senha), coalesce(p_qtd, ceil(v_qtd)::int),
    p_data, p_validade, g.solicitante_id, g.cid, g.indicacao_clinica)
  returning id into v_aut;
  update guias set autorizacao_id = v_aut, senha = trim(p_senha) where id = g.id;
  update atendimentos set autorizacao_id = v_aut where id = g.atendimento_id;
  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
    values (g.clinica_id, auth.uid(), 'guias', g.id, 'informar_senha', jsonb_build_object('autorizacao', v_aut, 'data', p_data, 'validade', p_validade));
  return jsonb_build_object('autorizacao_id', v_aut);
end $$;

revoke all on function guias_sem_senha(uuid), informar_senha_guia(uuid, text, date, date, int) from public, anon;
grant execute on function guias_sem_senha(uuid), informar_senha_guia(uuid, text, date, date, int) to authenticated;
