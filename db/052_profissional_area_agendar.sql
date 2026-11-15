-- =====================================================================
-- CURE OS — Migração 052: profissional vê todos os pacientes e encaminhamentos,
-- vê só as autorizações da sua área e pode agendar para si na sua área.
-- Área pela especialidade do profissional (fisio também cobre palmilha).
-- =====================================================================

create or replace function areas_da_especialidade(t text) returns text[]
language sql immutable set search_path = public as $$
  select case
    when t ~* '^fisio' then array['fisioterapia','palmilha']
    when t ~* '^nutri' then array['nutricao']
    when t ~* '^psic'  then array['psicologia']
    when t ~* '(palmilha|podo|baro)' then array['palmilha']
    else array[]::text[] end;
$$;

create or replace function minhas_areas(p_clinica uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select areas_da_especialidade(especialidade) from profissionais where id = meu_profissional(p_clinica)), array[]::text[]);
$$;
revoke execute on function areas_da_especialidade(text) from public, anon;
revoke execute on function minhas_areas(uuid) from public, anon;
grant execute on function areas_da_especialidade(text), minhas_areas(uuid) to authenticated;

-- Pacientes e encaminhamentos: profissional vê todos da clínica
drop policy if exists prof_pacientes on pacientes;
create policy prof_pacientes on pacientes for select to authenticated
  using (meu_perfil(clinica_id) = 'profissional');
drop policy if exists prof_encaminhamentos on encaminhamentos;
create policy prof_encaminhamentos on encaminhamentos for select to authenticated
  using (meu_perfil(clinica_id) = 'profissional');
drop policy if exists prof_paciente_planos on paciente_planos;
create policy prof_paciente_planos on paciente_planos for select to authenticated
  using (meu_perfil(clinica_id) = 'profissional');

-- Autorizações: profissional vê/solicita só as da sua área (ou as feitas em seu nome)
drop policy if exists prof_autorizacoes on autorizacoes;
create policy prof_autorizacoes on autorizacoes for select to authenticated
  using (meu_perfil(clinica_id) = 'profissional'
    and (area = any(minhas_areas(clinica_id)) or profissional_id = meu_profissional(clinica_id)));
drop policy if exists prof_cria_autorizacoes on autorizacoes;
create policy prof_cria_autorizacoes on autorizacoes for insert to authenticated
  with check (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id)
    and (area is null or area = any(minhas_areas(clinica_id))));

-- Agendamento: profissional cria só para si
drop policy if exists prof_cria_atendimentos on atendimentos;
create policy prof_cria_atendimentos on atendimentos for insert to authenticated
  with check (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id));

-- Ocupação de horários/salas para checar conflito (sem dados do paciente)
create or replace function ocupacao_agenda(p_clinica uuid, p_de timestamptz, p_ate timestamptz)
returns table (id uuid, inicio timestamptz, fim timestamptz, sala text, profissional_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.inicio, a.fim, a.sala, a.profissional_id from atendimentos a
  where a.clinica_id = p_clinica and meu_perfil(p_clinica) is not null and a.status <> 'cancelado'
    and a.inicio < p_ate and a.fim > p_de;
$$;
revoke execute on function ocupacao_agenda(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function ocupacao_agenda(uuid, timestamptz, timestamptz) to authenticated;

-- Convênios/senhas na agenda: profissional recebe só as autorizações da sua área
create or replace function public.autorizacoes_paciente(p_paciente uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_cli uuid; v_prof boolean; v_areas text[]; v_eu uuid;
begin
  select clinica_id into v_cli from pacientes where id = p_paciente;
  if meu_perfil(v_cli) is null then raise exception 'Sem permissão'; end if;
  v_prof := meu_perfil(v_cli) = 'profissional'; v_areas := minhas_areas(v_cli); v_eu := meu_profissional(v_cli);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', pl.id, 'contrato', c.nome, 'carteirinha', pl.carteirinha, 'validade', pl.validade, 'principal', pl.principal,
    'exige', contrato_exige_senha(c.id), 'senha_por_sessao', coalesce((c.regras->>'senha_por_sessao')::boolean, false),
    'procedimentos', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'codigo', p.codigo, 'descricao', p.descricao))
       from contrato_tabela t join procedimentos p on p.id = t.procedimento_id
       where t.contrato_id = c.id and (t.vigencia_fim is null or t.vigencia_fim >= current_date)), '[]'),
    'autorizacoes', coalesce((select jsonb_agg(jsonb_build_object('id', au.id, 'status', au.status, 'senha', au.senha, 'procedimento_id', au.procedimento_id, 'encaminhamento_id', au.encaminhamento_id, 'solicitante_id', au.solicitante_id, 'area', au.area,
         'codigo', p.codigo, 'qtd', au.qtd_autorizada, 'data', au.data_autorizacao, 'validade', au.validade,
         'usadas', (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status = 'atendido'),
         'agendadas', (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente')))
       order by au.solicitada_em desc)
       from autorizacoes au join procedimentos p on p.id = au.procedimento_id
       where au.paciente_plano_id = pl.id and au.status in ('pendente','autorizada')
         and (not v_prof or au.area = any(v_areas) or au.profissional_id = v_eu)), '[]')
  ) order by pl.principal desc)
  from paciente_planos pl join contratos c on c.id = pl.contrato_id where pl.paciente_id = p_paciente), '[]');
end $function$;
