-- 048 — relacionamento() passa a devolver o e-mail do paciente (botão de e-mail de reavaliação/aniversário, além do WhatsApp).
-- Corpo igual ao de produção; só foi acrescentado 'email' nos dois jsonb_build_object.
create or replace function public.relacionamento(p_clinica uuid, p_dias integer default 7)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_cfg jsonb; v_out jsonb := '[]'::jsonb; g jsonb;
begin
  if coalesce(meu_perfil(p_clinica)::text, '') not in ('gestor','financeiro','recepcao') then raise exception 'Sem permissão'; end if;
  select config->'relacionamento' into v_cfg from clinicas where id = p_clinica;
  v_out := v_out || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'aniversario', 'paciente_id', p.id, 'nome', p.nome, 'telefone', coalesce(p.celular, p.telefone),
      'email', p.email, 'quando', d.dia, 'idade', extract(year from age(d.dia, p.data_nascimento))::int) order by d.dia)
    from pacientes p
    cross join lateral (select make_date(extract(year from current_date)::int + case when to_char(p.data_nascimento, 'MMDD') < to_char(current_date, 'MMDD') then 1 else 0 end,
      extract(month from p.data_nascimento)::int, 1) + (extract(day from p.data_nascimento)::int - 1) dia) d
    where p.clinica_id = p_clinica and p.ativo and p.consentimento_comunicacao and p.comunicacao_optout_em is null
      and p.data_nascimento is not null and d.dia between current_date and current_date + p_dias), '[]'::jsonb);
  for g in select * from jsonb_array_elements(coalesce(v_cfg->'reavaliacoes', '[]'::jsonb)) loop
    v_out := v_out || coalesce((
      with feitos as (
        select pl.paciente_id, gi.data_realizacao as dia from guia_itens gi join guias gu on gu.id = gi.guia_id
          join paciente_planos pl on pl.id = gu.paciente_plano_id join procedimentos pr on pr.id = gi.procedimento_id
          where gu.clinica_id = p_clinica and gu.status <> 'cancelada' and pr.codigo in (select jsonb_array_elements_text(g->'codigos'))
        union all
        select r.paciente_id, r.pago_em from recebimentos r join procedimentos pr on pr.id = r.procedimento_id
          where r.clinica_id = p_clinica and pr.codigo in (select jsonb_array_elements_text(g->'codigos'))),
      ult as (select paciente_id, max(dia) dia from feitos group by 1)
      select jsonb_agg(jsonb_build_object('tipo', 'reavaliacao', 'item', g->>'nome', 'paciente_id', p.id, 'nome', p.nome, 'telefone', coalesce(p.celular, p.telefone),
          'email', p.email, 'ultima', u.dia, 'quando', u.dia + (g->>'dias')::int) order by u.dia)
      from ult u join pacientes p on p.id = u.paciente_id
      where p.ativo and p.consentimento_comunicacao and p.comunicacao_optout_em is null
        and u.dia + (g->>'dias')::int between current_date - 30 and current_date + p_dias
        and not exists (select 1 from atendimentos a where a.paciente_id = p.id and a.inicio > now() and a.status in ('agendado','confirmado'))), '[]'::jsonb);
  end loop;
  return jsonb_build_object('itens', v_out, 'config', v_cfg);
end $function$;
