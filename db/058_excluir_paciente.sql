-- =====================================================================
-- CURE OS — Migração 058: excluir cadastro de paciente com segurança.
-- O DELETE direto em pacientes apagaria em cascata planos, autorizações (via plano) e encaminhamentos.
-- Estas funções só deixam excluir paciente SEM histórico: sem atendimentos, prontuário, documentos emitidos,
-- recebimentos, encaminhamentos nem autorizações. Planos vazios e lista de espera saem junto (cascata).
-- Quem pode: gestor, recepção e financeiro (igual à política edita_pacientes). Idempotente.
-- =====================================================================

create or replace function paciente_vinculos(p_paciente uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_clinica uuid;
begin
  select clinica_id into v_clinica from pacientes where id = p_paciente;
  if v_clinica is null then raise exception 'Paciente não encontrado.'; end if;
  if not coalesce(meu_perfil(v_clinica) = any (array['gestor','recepcao','financeiro']::perfil_usuario[]), false) then
    raise exception 'Sem permissão para excluir cadastro.';
  end if;
  return jsonb_build_object(
    'atendimentos',  (select count(*) from atendimentos where paciente_id = p_paciente),
    'prontuario',    (select count(*) from prontuario_registros where paciente_id = p_paciente),
    'documentos',    (select count(*) from documentos_emitidos where paciente_id = p_paciente),
    'recebimentos',  (select count(*) from recebimentos where paciente_id = p_paciente),
    'encaminhamentos',(select count(*) from encaminhamentos where paciente_id = p_paciente),
    'autorizacoes',  (select count(*) from autorizacoes a join paciente_planos pp on pp.id = a.paciente_plano_id where pp.paciente_id = p_paciente),
    'planos',        (select count(*) from paciente_planos where paciente_id = p_paciente)
  );
end $$;

create or replace function excluir_paciente(p_paciente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  v := paciente_vinculos(p_paciente);  -- já valida permissão e existência
  if (v->>'atendimentos')::int + (v->>'prontuario')::int + (v->>'documentos')::int
     + (v->>'recebimentos')::int + (v->>'encaminhamentos')::int + (v->>'autorizacoes')::int > 0 then
    raise exception 'Paciente com histórico não pode ser excluído. Marque como inativo.';
  end if;
  delete from pacientes where id = p_paciente;
end $$;

revoke all on function paciente_vinculos(uuid) from public, anon;
revoke all on function excluir_paciente(uuid) from public, anon;
grant execute on function paciente_vinculos(uuid) to authenticated;
grant execute on function excluir_paciente(uuid) to authenticated;
