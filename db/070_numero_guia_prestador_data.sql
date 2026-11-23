-- 070 — Nº da guia no prestador no padrão DDMMAAAA + sequência do dia (ex.: 2311202601), igual ao que já vinha sendo usado.
-- Antes: "máximo + 1" do contrato, o que herdava a data de uma guia antiga (ex.: 1711202601 → 1711202602 numa guia de outro dia).
-- A data é a da autorização; a sequência é por contrato e por dia. Linhas da mesma guia da operadora seguem dividindo o número.
create or replace function numero_guia_prestador_aut(p_aut uuid)
returns text language plpgsql security definer set search_path = public as $$
declare a autorizacoes%rowtype; v_contrato uuid; v_num text; v_pref text;
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
    v_pref := to_char(coalesce(a.data_autorizacao, (now() at time zone 'America/Sao_Paulo')::date), 'DDMMYYYY');
    select v_pref || lpad((coalesce(max(substr(n, 9)::int), 0) + 1)::text, 2, '0') into v_num from (
      select x.numero_guia_prestador n from autorizacoes x join paciente_planos pp on pp.id = x.paciente_plano_id
       where pp.contrato_id = v_contrato and x.numero_guia_prestador ~ ('^' || v_pref || '\d{2}$')
      union all
      select numero_guia_prestador from guias where contrato_id = v_contrato and numero_guia_prestador ~ ('^' || v_pref || '\d{2}$')) t;
  end if;
  update autorizacoes set numero_guia_prestador = v_num
   where paciente_plano_id = a.paciente_plano_id
     and (id = p_aut or (a.numero_guia_operadora is not null and numero_guia_operadora = a.numero_guia_operadora));
  return v_num;
end $$;
revoke all on function numero_guia_prestador_aut(uuid) from public, anon;
grant execute on function numero_guia_prestador_aut(uuid) to authenticated;

-- Corrige a única guia que herdou a data errada (autorizada em 23/11, número com 17/11); só mexe se ainda não virou guia faturada.
update autorizacoes set numero_guia_prestador = '2311202601'
 where numero_guia_prestador = '1711202602' and data_autorizacao = date '2026-11-23'
   and not exists (select 1 from guias g where g.numero_guia_prestador = '1711202602');
