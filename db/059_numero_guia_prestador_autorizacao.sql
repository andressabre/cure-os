-- =====================================================================
-- CURE OS — Migração 059: nº da guia no prestador por autorização (campo 2 da SP/SADT impressa).
-- Sequencial por contrato (máximo + 1, olhando autorizações e guias do mesmo contrato); as linhas de uma mesma guia da
-- operadora (vários procedimentos) dividem o número. Idempotente.
-- =====================================================================
alter table autorizacoes add column if not exists numero_guia_prestador text;

create or replace function numero_guia_prestador_aut(p_aut uuid)
returns text language plpgsql security definer set search_path = public as $$
declare a autorizacoes%rowtype; v_contrato uuid; v_num text;
begin
  select * into a from autorizacoes where id = p_aut;
  if a.id is null then raise exception 'Autorização não encontrada.'; end if;
  if not coalesce(meu_perfil(a.clinica_id) = any (array['gestor','recepcao','financeiro']::perfil_usuario[]), false) then
    raise exception 'Sem permissão.';
  end if;
  if a.numero_guia_prestador is not null then return a.numero_guia_prestador; end if;
  select numero_guia_prestador into v_num from autorizacoes
   where paciente_plano_id = a.paciente_plano_id and numero_guia_operadora is not distinct from a.numero_guia_operadora
     and a.numero_guia_operadora is not null and numero_guia_prestador is not null limit 1;
  if v_num is null then
    select contrato_id into v_contrato from paciente_planos where id = a.paciente_plano_id;
    perform pg_advisory_xact_lock(hashtext('guia_prestador_' || v_contrato::text));
    select (coalesce(max(n), 0) + 1)::text into v_num from (
      select numero_guia_prestador::bigint n from autorizacoes x join paciente_planos pp on pp.id = x.paciente_plano_id
       where pp.contrato_id = v_contrato and x.numero_guia_prestador ~ '^\d{1,15}$'
      union all
      select numero_guia_prestador::bigint from guias where contrato_id = v_contrato and numero_guia_prestador ~ '^\d{1,15}$') t;
  end if;
  update autorizacoes set numero_guia_prestador = v_num
   where paciente_plano_id = a.paciente_plano_id
     and (id = p_aut or (a.numero_guia_operadora is not null and numero_guia_operadora = a.numero_guia_operadora));
  return v_num;
end $$;
revoke all on function numero_guia_prestador_aut(uuid) from public, anon;
grant execute on function numero_guia_prestador_aut(uuid) to authenticated;
