-- 062 — editar_item_tabela_contrato(clinica, item, codigo, descricao, valor, desde): edita cada campo da tabela de valores do contrato.
-- Só gestor/financeiro. Código e descrição só mudam em procedimentos próprios (código CURE-*); TUSS oficial fica travado (é compartilhado).
-- Trocar o código atualiza também config.relacionamento.reavaliacoes. "Desde" corrige o início da vigência atual;
-- valor novo = nova vigência a partir de hoje (histórico preservado), ou correção direta se a vigência começa hoje/no futuro.
create or replace function editar_item_tabela_contrato(p_clinica uuid, p_item uuid, p_codigo text, p_descricao text, p_valor numeric, p_desde date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t contrato_tabela; v_cod text; v_desc text; v_novo text; v_ini date; v_outros text;
begin
  if coalesce(meu_perfil(p_clinica)::text, '') not in ('gestor', 'financeiro') then raise exception 'Sem permissão'; end if;
  select t.* into v_t from contrato_tabela t where t.id = p_item and t.clinica_id = p_clinica and t.vigencia_fim is null;
  if v_t.id is null then raise exception 'Item não encontrado ou já encerrado.'; end if;
  select codigo, descricao into v_cod, v_desc from procedimentos where id = v_t.procedimento_id;
  select string_agg(distinct c.nome, ', ') into v_outros from contrato_tabela t2 join contratos c on c.id = t2.contrato_id
    where t2.procedimento_id = v_t.procedimento_id and t2.contrato_id <> v_t.contrato_id and t2.vigencia_fim is null;

  if v_cod like 'CURE-%' then
    v_novo := upper(btrim(coalesce(p_codigo, v_cod)));
    if v_outros is not null and (v_novo <> v_cod or coalesce(btrim(p_descricao), v_desc) <> v_desc) then
      raise exception 'Este procedimento também é usado em: %. Mudar código/descrição alteraria esses contratos; ajuste só valor e data aqui.', v_outros;
    end if;
    if v_novo <> v_cod then
      if v_novo !~ '^CURE-[A-Z0-9-]{1,30}$' then raise exception 'Código próprio deve começar com CURE- (letras, números e hífen).'; end if;
      if exists (select 1 from procedimentos where codigo = v_novo) then raise exception 'O código % já existe em outro procedimento (o código não pode se repetir no contrato).', v_novo; end if;
      update procedimentos set codigo = v_novo where id = v_t.procedimento_id;
      update clinicas set config = jsonb_set(config, '{relacionamento,reavaliacoes}',
        (select coalesce(jsonb_agg(jsonb_set(r, '{codigos}', (select coalesce(jsonb_agg(case when c #>> '{}' = v_cod then to_jsonb(v_novo) else c end), '[]'::jsonb)
          from jsonb_array_elements(r->'codigos') c))), '[]'::jsonb) from jsonb_array_elements(config->'relacionamento'->'reavaliacoes') r))
        where id = p_clinica and config #> '{relacionamento,reavaliacoes}' is not null;
    end if;
    if p_descricao is not null and btrim(p_descricao) <> '' then update procedimentos set descricao = btrim(p_descricao) where id = v_t.procedimento_id; end if;
  end if;

  v_ini := v_t.vigencia_inicio;
  if p_desde is not null and p_desde <> v_t.vigencia_inicio then
    update contrato_tabela set vigencia_inicio = p_desde where id = v_t.id; v_ini := p_desde;
  end if;
  if p_valor is not null and p_valor >= 0 and round(p_valor, 2) <> v_t.valor then
    if v_ini >= current_date then update contrato_tabela set valor = round(p_valor, 2) where id = v_t.id;
    else
      update contrato_tabela set vigencia_fim = current_date - 1 where id = v_t.id;
      insert into contrato_tabela (clinica_id, contrato_id, procedimento_id, valor, vigencia_inicio, tipo_guia)
        values (v_t.clinica_id, v_t.contrato_id, v_t.procedimento_id, round(p_valor, 2), current_date, v_t.tipo_guia);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function editar_item_tabela_contrato(uuid, uuid, text, text, numeric, date) from public, anon;
grant execute on function editar_item_tabela_contrato(uuid, uuid, text, text, numeric, date) to authenticated;
