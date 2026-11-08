-- 011 — Estatísticas: profissional vê só os próprios números; gestão vê a clínica toda (com filtro por profissional).
-- Aplicada direto no Supabase em 08/11/2026.
create or replace function estatisticas(p_clinica uuid, p_ano int, p_prof uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_perfil perfil_usuario; v_gestao boolean; v_ini date := make_date(p_ano, 1, 1); v_fim date := make_date(p_ano + 1, 1, 1);
begin
  v_perfil := meu_perfil(p_clinica);
  if v_perfil is null then raise exception 'Sem acesso a esta clínica'; end if;
  v_gestao := v_perfil in ('gestor', 'financeiro');
  if v_perfil = 'profissional' then p_prof := meu_profissional(p_clinica); end if;
  if v_perfil = 'recepcao' then v_gestao := false; end if;

  return (
  with at as (
    select a.*, (a.inicio at time zone 'America/Sao_Paulo')::date as dia,
           extract(month from a.inicio at time zone 'America/Sao_Paulo')::int as mes
    from atendimentos a
    where a.clinica_id = p_clinica and (p_prof is null or a.profissional_id = p_prof)
      and a.inicio >= v_ini and a.inicio < v_fim
  ),
  feitos as (select * from at where status = 'atendido'),
  ultimo as (   -- última vez que cada paciente foi atendido (com este profissional, se filtrado)
    select paciente_id, max(inicio) as ult, min(inicio) as primeiro from atendimentos
    where clinica_id = p_clinica and status = 'atendido' and (p_prof is null or profissional_id = p_prof)
    group by paciente_id
  ),
  itens as (
    select i.*, g.profissional_id, extract(month from i.data_realizacao)::int as mes
    from guia_itens i join guias g on g.id = i.guia_id
    where g.clinica_id = p_clinica and g.status <> 'cancelada' and (p_prof is null or g.profissional_id = p_prof)
      and i.data_realizacao >= v_ini and i.data_realizacao < v_fim
  )
  select jsonb_build_object(
    'escopo', case when p_prof is null then 'clinica' else 'profissional' end,
    'gestao', v_gestao,
    'mensal', (select jsonb_agg(jsonb_build_object('mes', m,
        'atendidos', (select count(*) from feitos where mes = m),
        'faltas', (select count(*) from at where mes = m and status = 'faltou'),
        'cancelados', (select count(*) from at where mes = m and status = 'cancelado'),
        'novos', (select count(*) from ultimo u where extract(month from u.primeiro at time zone 'America/Sao_Paulo') = m
                    and u.primeiro >= v_ini and u.primeiro < v_fim),
        'repasse', case when v_gestao or v_perfil = 'profissional' then (select coalesce(sum(repasse_final), 0) from itens where mes = m) end,
        'faturado', case when v_gestao then (select coalesce(sum(valor_informado), 0) from itens where mes = m) end,
        'glosado', case when v_gestao then (select coalesce(sum(valor_glosa), 0) from itens where mes = m) end
      ) order by m) from generate_series(1, 12) m),
    'totais', jsonb_build_object(
      'atendidos', (select count(*) from feitos),
      'faltas', (select count(*) from at where status = 'faltou'),
      'cancelados', (select count(*) from at where status = 'cancelado'),
      'futuros', (select count(*) from at where status in ('agendado', 'confirmado') and inicio > now()),
      'pacientes', (select count(distinct paciente_id) from feitos),
      'novos', (select count(*) from ultimo where primeiro >= v_ini and primeiro < v_fim),
      'sem_retorno_60', (select count(*) from ultimo u where u.ult < now() - interval '60 days' and u.ult >= now() - interval '1 year'
                           and not exists (select 1 from atendimentos f where f.paciente_id = u.paciente_id and f.inicio > now()
                                           and f.status in ('agendado','confirmado') and (p_prof is null or f.profissional_id = p_prof)))),
    'sexo', (select coalesce(jsonb_object_agg(coalesce(nullif(sx, ''), 'não informado'), n), '{}') from
              (select upper(left(p.sexo, 1)) sx, count(*) n from pacientes p where p.id in (select paciente_id from feitos) group by 1) s),
    'servicos', (select coalesce(jsonb_agg(jsonb_build_object('nome', coalesce(servico, 'Sem serviço'), 'n', n) order by n desc), '[]')
                 from (select servico, count(*) n from feitos group by 1) s),
    'convenios', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'n', n) order by n desc), '[]') from
                  (select coalesce(c.nome, 'Particular / sem convênio') nome, count(*) n from feitos f
                   left join paciente_planos pl on pl.id = f.paciente_plano_id left join contratos c on c.id = pl.contrato_id group by 1) s),
    'profissionais', case when v_gestao and p_prof is null then (select coalesce(jsonb_agg(jsonb_build_object('nome', pr.nome,
          'atendidos', (select count(*) from feitos f where f.profissional_id = pr.id),
          'faltas', (select count(*) from at where at.profissional_id = pr.id and status = 'faltou'),
          'faturado', (select coalesce(sum(valor_informado), 0) from itens i where i.profissional_id = pr.id),
          'repasse', (select coalesce(sum(repasse_final), 0) from itens i where i.profissional_id = pr.id)) order by pr.nome), '[]')
        from profissionais pr where pr.clinica_id = p_clinica and pr.ativo) end
  ));
end $$;
revoke all on function estatisticas(uuid, int, uuid) from public, anon;
grant execute on function estatisticas(uuid, int, uuid) to authenticated;
