-- 025 — Blindagem (laudo de 10/11/2026, itens 2 e 8) + salas, agendamento em série e lembretes na agenda.

-- ---------------------------------------------------------------- 2a. funções sem login
-- Por padrão o Postgres dá EXECUTE a PUBLIC; revogar só de anon não basta.
do $$
declare f text;
begin
  foreach f in array array[
    'gerar_repasse_mes(uuid, date, date)', 'arquivo_paciente_do_prof(text)', 'pasta_clinica_ok(text, text[])',
    'pasta_prontuario_ok(text)', 'prontuario_trava()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- Funções internas, sem checagem de quem chama: só outras funções (donas = postgres) as usam.
  foreach f in array array[
    'calcular_repasse(uuid, uuid, uuid, date, numeric)', 'situacao_guia_lote(uuid)', 'contrato_exige_senha(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2b. políticas declaradas para "public"
alter policy edita_encaminhamentos on encaminhamentos to authenticated;
alter policy prof_encaminhamentos on encaminhamentos to authenticated;
alter policy edita_guia_anexos on guia_anexos to authenticated;

-- ---------------------------------------------------------------- 2c. conta nova só com convite
create or replace function exigir_convite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from convites c where lower(c.email) = lower(new.email) and c.usado_em is null) then
    raise exception 'CONVITE_OBRIGATORIO: este e-mail não tem convite da clínica.';
  end if;
  return new;
end $$;
revoke execute on function exigir_convite() from public, anon, authenticated;
drop trigger if exists antes_criar_usuario on auth.users;
create trigger antes_criar_usuario before insert on auth.users for each row execute function exigir_convite();

-- ---------------------------------------------------------------- 8. prontuário assinado volta a ser imutável
-- Correção = adendo datado. prontuario_versoes fica para o histórico das edições feitas entre 09 e 10/11/2026.
create or replace function prontuario_trava() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'assinado' then raise exception 'Registro assinado não pode ser apagado (guarda legal de 20 anos).'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.clinica_id <> old.clinica_id or new.paciente_id <> old.paciente_id or new.profissional_id <> old.profissional_id then
      raise exception 'Não é permitido trocar paciente, profissional ou clínica do registro.'; end if;
    if old.status = 'assinado' then
      raise exception 'Registro assinado não pode ser alterado. Para corrigir ou complementar, use um adendo.';
    end if;
  end if;
  new.atualizado_em := now();
  if new.status = 'assinado' then
    new.assinado_em := now();
    new.hash_assinatura := encode(sha256(convert_to(
      new.paciente_id::text || '|' || new.profissional_id::text || '|' || new.data_registro::text || '|' || new.modelo || '|' || new.conteudo::text, 'UTF8')), 'hex');
  end if;
  return new;
end $$;
revoke execute on function prontuario_trava() from public, anon;

-- ---------------------------------------------------------------- agenda: série e lembrete
alter table atendimentos add column if not exists serie_id uuid;
alter table atendimentos add column if not exists lembrete_enviado_em timestamptz;
create index if not exists atendimentos_serie on atendimentos (serie_id) where serie_id is not null;
create index if not exists atendimentos_sala_inicio on atendimentos (clinica_id, sala, inicio) where sala is not null;

-- ---------------------------------------------------------------- salas (2 hoje) e sala padrão por profissional
-- Padrão no agendamento = última sala usada pelo profissional; se nunca usou, a sala_padrao abaixo.
update clinicas set config = coalesce(config, '{}'::jsonb)
  || jsonb_build_object('salas', jsonb_build_array('Sala de fisioterapia', 'Consultório'))
  || jsonb_build_object('sala_padrao', (
       select coalesce(jsonb_object_agg(p.id, case when p.especialidade ilike 'fisio%' then 'Sala de fisioterapia' else 'Consultório' end), '{}'::jsonb)
       from profissionais p where p.clinica_id = clinicas.id))
where not (coalesce(config, '{}'::jsonb) ? 'salas');
