-- 045 — Nome do convênio na agenda para recepção e profissional (que não leem a tabela contratos pela RLS).
-- Devolve só o NOME do contrato dos atendimentos pedidos; recepção/gestão/financeiro veem todos da clínica,
-- profissional só os próprios. Nada de valores, códigos de prestador ou regras.
create or replace function convenio_atendimentos(p_atendimentos uuid[])
returns table(atendimento_id uuid, convenio text)
language sql stable security definer set search_path = public as $$
  select a.id, c.nome
  from atendimentos a
  join paciente_planos pp on pp.id = a.paciente_plano_id
  join contratos c on c.id = pp.contrato_id
  where a.id = any(p_atendimentos)
    and (coalesce(meu_perfil(a.clinica_id)::text, '') in ('gestor', 'recepcao', 'financeiro')
         or a.profissional_id = meu_profissional(a.clinica_id))
$$;
revoke execute on function convenio_atendimentos(uuid[]) from public, anon;
grant execute on function convenio_atendimentos(uuid[]) to authenticated;
