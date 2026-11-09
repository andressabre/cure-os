-- =====================================================================
-- CURE OS — Migração 022
-- (a) Gestora (09/11/2026): o profissional costuma pedir a própria autorização →
--     pode ABRIR os arquivos de encaminhamento dos pacientes que atende
--     (caminho <clinica>/pacientes/<paciente>/...). Não apaga nem envia.
-- (b) Dados da guia SP/SADT impressa para o paciente assinar (anexo 06).
--     Profissional só imprime guia de atendimento seu, sem valores.
-- =====================================================================
create or replace function arquivo_paciente_do_prof(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$' and split_part(p_nome, '/', 2) = 'pacientes'
              and split_part(p_nome, '/', 3) ~ '^[0-9a-f-]{36}$'
    then meu_perfil(split_part(p_nome, '/', 1)::uuid) = 'profissional'
      and exists (select 1 from atendimentos a where a.paciente_id = split_part(p_nome, '/', 3)::uuid
                  and a.profissional_id = meu_profissional(split_part(p_nome, '/', 1)::uuid))
    else false end;
$$;
drop policy if exists documentos_ler_prof on storage.objects;
create policy documentos_ler_prof on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and arquivo_paciente_do_prof(name));

create or replace function dados_guia_impressa(p_guia uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g guias; v_perfil text; v_valor boolean;
begin
  select * into g from guias where id = p_guia;
  v_perfil := meu_perfil(g.clinica_id)::text;
  if v_perfil is null then raise exception 'Sem permissão'; end if;
  if v_perfil = 'profissional' and not exists (select 1 from guia_itens i join atendimentos a on a.id = i.atendimento_id
       where i.guia_id = g.id and a.profissional_id = meu_profissional(g.clinica_id))
     and g.profissional_id is distinct from meu_profissional(g.clinica_id) then
    raise exception 'Sem permissão'; end if;
  v_valor := v_perfil in ('gestor','financeiro');
  return (select jsonb_build_object(
    'numero', g.numero_guia_prestador, 'tipo', g.tipo, 'mostra_valor', v_valor,
    'registro_ans', o.registro_ans, 'operadora', o.nome,
    'data_autorizacao', au.data_autorizacao, 'senha', coalesce(g.senha, au.senha), 'validade_senha', au.validade,
    'numero_operadora', coalesce(g.numero_guia_operadora, au.numero_guia_operadora),
    'carteirinha', pl.carteirinha, 'validade_carteira', pl.validade, 'paciente', coalesce(pa.nome_social, pa.nome), 'cns', pa.cns,
    'codigo_prestador', c.codigo_prestador_operadora, 'contratado', split_part(f.razao_social, ' – ', 1), 'cnes', f.cnes,
    'solicitante', (select jsonb_build_object('nome', s.nome, 'conselho', s.conselho, 'numero', s.numero_conselho, 'uf', s.uf_conselho, 'cbo', s.cbo)
                    from solicitantes s where s.id = coalesce(g.solicitante_id, au.solicitante_id)),
    'carater', coalesce(g.carater_atendimento, '1'), 'data_solicitacao', en.data_pedido,
    'indicacao_clinica', coalesce(g.indicacao_clinica, au.indicacao_clinica), 'cid', coalesce(g.cid, au.cid),
    'tipo_atendimento', coalesce(g.tipo_atendimento, '03'), 'regime', coalesce(g.regime_atendimento, '01'),
    'solicitado', (select jsonb_build_object('tabela', p.codigo_tabela, 'codigo', p.codigo, 'descricao', p.descricao,
                     'qtd_solicitada', coalesce(au.qtd_solicitada, au.qtd_autorizada), 'qtd_autorizada', au.qtd_autorizada)
                   from procedimentos p where p.id = au.procedimento_id),
    'series', case when coalesce((c.regras->>'guia_por_sessao')::boolean, false) then 1 else greatest(coalesce(au.qtd_autorizada, 1), 1) end,
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'data', i.data_realizacao, 'hora_inicio', to_char(at.inicio at time zone 'America/Sao_Paulo', 'HH24:MI'),
        'hora_fim', to_char(at.fim at time zone 'America/Sao_Paulo', 'HH24:MI'),
        'tabela', p.codigo_tabela, 'codigo', p.codigo, 'descricao', p.descricao, 'quantidade', i.quantidade,
        'valor_unitario', case when v_valor then round(i.valor_informado / nullif(i.quantidade, 0), 2) end,
        'valor', case when v_valor then i.valor_informado end,
        'profissional', (select jsonb_build_object('nome', pr.nome, 'cpf', pr.cpf, 'conselho', pr.conselho, 'numero', pr.numero_conselho,
            'uf', pr.uf_conselho, 'cbo', pr.cbo) from profissionais pr where pr.id = coalesce(at.profissional_id, g.profissional_id)))
        order by i.data_realizacao, i.sequencial)
      from guia_itens i join procedimentos p on p.id = i.procedimento_id left join atendimentos at on at.id = i.atendimento_id
      where i.guia_id = g.id), '[]'))
  from contratos c join operadoras o on o.id = c.operadora_id
  left join cnpjs_faturamento f on f.id = c.cnpj_faturamento_id
  join paciente_planos pl on pl.id = g.paciente_plano_id join pacientes pa on pa.id = pl.paciente_id
  left join autorizacoes au on au.id = g.autorizacao_id
  left join encaminhamentos en on en.id = au.encaminhamento_id
  where c.id = g.contrato_id);
end $$;
revoke execute on function dados_guia_impressa(uuid) from public, anon;
grant execute on function dados_guia_impressa(uuid) to authenticated;
