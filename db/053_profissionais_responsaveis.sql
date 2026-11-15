-- =====================================================================
-- CURE OS — Migração 053: profissionais responsáveis pelo paciente (vários: ex. fisio + psico).
-- Preenchido sozinho a cada agendamento e editável no cadastro (gestão/recepção).
-- Hoje só serve de filtro ("Meus pacientes"); restringir a visão por ele fica para depois.
-- =====================================================================

alter table pacientes add column if not exists profissionais_resp uuid[] not null default '{}';
create index if not exists pacientes_resp on pacientes using gin (profissionais_resp);

create or replace function incluir_responsavel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.profissional_id is not null and new.status <> 'cancelado' then
    update pacientes set profissionais_resp = array_append(profissionais_resp, new.profissional_id)
    where id = new.paciente_id and not (new.profissional_id = any(profissionais_resp));
  end if;
  return new;
end $$;
revoke execute on function incluir_responsavel() from public, anon, authenticated;
drop trigger if exists atend_incluir_responsavel on atendimentos;
create trigger atend_incluir_responsavel after insert or update of profissional_id on atendimentos
  for each row execute function incluir_responsavel();

-- Histórico: quem já atendeu/agendou ou escreveu prontuário
update pacientes p set profissionais_resp = x.ids from (
  select paciente_id, array_agg(distinct profissional_id) ids from (
    select paciente_id, profissional_id from atendimentos where profissional_id is not null and status <> 'cancelado'
    union select paciente_id, profissional_id from prontuario_registros where profissional_id is not null) t
  group by paciente_id) x
where x.paciente_id = p.id and p.profissionais_resp = '{}';
