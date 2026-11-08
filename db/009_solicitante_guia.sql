-- 009 — Solicitante (pedido médico), CID, indicação clínica e dados de atendimento TISS na guia
-- Aplicada direto no Supabase em 08/11/2026.
create table if not exists solicitantes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  nome text not null,
  conselho text not null default 'CRM',
  numero_conselho text not null,
  uf_conselho char(2) not null default 'SC',
  cbo text not null default '225125',       -- médico clínico; ajustar à especialidade
  ativo boolean not null default true,
  unique (clinica_id, conselho, numero_conselho, uf_conselho)
);
alter table solicitantes enable row level security;
create policy ler_solicitantes on solicitantes for select to authenticated using (meu_perfil(clinica_id) is not null);
create policy edita_solicitantes on solicitantes for all to authenticated
  using (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro')) with check (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'));

alter table autorizacoes add column if not exists solicitante_id uuid references solicitantes,
  add column if not exists cid text, add column if not exists indicacao_clinica text;
alter table guias add column if not exists solicitante_id uuid references solicitantes,
  add column if not exists cid text, add column if not exists indicacao_clinica text,
  add column if not exists tipo_atendimento text not null default '03',   -- TISS tab. 50: 03 outras terapias, 04 consulta
  add column if not exists carater_atendimento text not null default '1', -- 1 eletivo
  add column if not exists regime_atendimento text not null default '01', -- 01 ambulatorial
  add column if not exists hora_inicio time, add column if not exists hora_fim time;

drop function if exists guia_atendimento(uuid, uuid, uuid, jsonb, boolean);

create or replace function guia_atendimento(p_atendimento uuid, p_plano uuid, p_autorizacao uuid,
  p_itens jsonb, p_gravar boolean default false, p_dados jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a atendimentos; pl paciente_planos; c contratos; au autorizacoes; pa pacientes; pr profissionais;
  v_perfil perfil_usuario; v_data date; v_bloq text[] := '{}'; v_avis text[] := '{}';
  v_itens jsonb := '[]'; v_guias jsonb := '[]'; it jsonb; v_proc procedimentos;
  v_tab contrato_tabela; v_qtd numeric; v_usadas numeric; v_rep numeric; v_tipo text; v_guia uuid; v_num bigint; v_seq int;
  so solicitantes; v_cid text; v_ind text; v_tipo_at text; op operadoras; cf cnpjs_faturamento;
begin
  select * into a from atendimentos where id = p_atendimento;
  if a.id is null then raise exception 'Atendimento não encontrado'; end if;
  v_perfil := meu_perfil(a.clinica_id);
  if v_perfil is null or (v_perfil = 'profissional' and a.profissional_id is distinct from meu_profissional(a.clinica_id)) then
    raise exception 'Sem permissão para este atendimento';
  end if;
  v_data := (a.inicio at time zone 'America/Sao_Paulo')::date;

  select * into pl from paciente_planos where id = p_plano and paciente_id = a.paciente_id;
  if pl.id is null then raise exception 'Convênio do paciente não encontrado'; end if;
  select * into c from contratos where id = pl.contrato_id;
  select * into pa from pacientes where id = a.paciente_id;
  select * into pr from profissionais where id = a.profissional_id;

  if coalesce((c.regras->>'sem_tiss')::boolean, false) then
    v_avis := v_avis || ('"' || c.nome || '" é acordo sem guia TISS: o atendimento fica registrado, sem guia.');
  end if;
  if exists (select 1 from guias where atendimento_id = a.id and status <> 'cancelada') then
    v_bloq := v_bloq || 'Este atendimento já tem guia gerada.'::text;
  end if;

  -- Carteirinha e cadastro
  if pl.validade is not null and pl.validade < v_data then
    v_bloq := v_bloq || ('Carteirinha vencida em ' || to_char(pl.validade, 'DD/MM/YYYY') || '.');
  end if;
  if nullif(trim(pl.carteirinha), '') is null then v_bloq := v_bloq || 'Paciente sem número de carteirinha.'::text; end if;
  if pa.data_nascimento is null then v_avis := v_avis || 'Paciente sem data de nascimento.'::text; end if;
  if nullif(pa.cpf, '') is null then v_avis := v_avis || 'Paciente sem CPF.'::text; end if;
  if pr.conselho is null or pr.numero_conselho is null or pr.uf_conselho is null or pr.cbo is null then
    v_avis := v_avis || ('Cadastro de ' || pr.nome || ' sem conselho/número/UF/CBO: o XML TISS vai exigir.');
  end if;

  -- Autorização
  if p_autorizacao is not null then
    select * into au from autorizacoes where id = p_autorizacao and paciente_plano_id = pl.id;
    if au.id is null then raise exception 'Autorização não pertence a este convênio'; end if;
    if au.data_autorizacao > v_data then
      v_bloq := v_bloq || ('Autorização de ' || to_char(au.data_autorizacao, 'DD/MM/YYYY') || ' é posterior ao atendimento (glosa 1814).');
    end if;
    if au.validade is not null and au.validade < v_data then
      v_bloq := v_bloq || ('Autorização vencida em ' || to_char(au.validade, 'DD/MM/YYYY') || '.');
    end if;
  end if;

  -- Solicitante (pedido médico), CID e indicação: do formulário ou herdados da autorização
  select * into so from solicitantes where id = coalesce(nullif(p_dados->>'solicitante_id', '')::uuid, au.solicitante_id);
  v_cid := upper(nullif(trim(coalesce(p_dados->>'cid', au.cid, '')), ''));
  v_ind := nullif(trim(coalesce(p_dados->>'indicacao_clinica', au.indicacao_clinica, '')), '');
  v_tipo_at := coalesce(nullif(p_dados->>'tipo_atendimento', ''), '03');
  if v_cid is not null and v_cid !~ '^[A-Z][0-9]{2}(\.?[0-9X])?$' then v_bloq := v_bloq || ('CID "' || v_cid || '" em formato inválido (ex.: M54.5).'); end if;
  select * into op from operadoras where id = c.operadora_id;
  select * into cf from cnpjs_faturamento where id = c.cnpj_faturamento_id;
  if not coalesce((c.regras->>'sem_tiss')::boolean, false) then
    if nullif(op.registro_ans, '') is null or length(op.registro_ans) <> 6 then v_avis := v_avis || ('Operadora ' || op.nome || ' sem registro ANS de 6 dígitos: o XML vai exigir.'); end if;
    if nullif(cf.cnes, '') is null then v_avis := v_avis || ('CNPJ de faturamento ' || cf.razao_social || ' sem CNES cadastrado.'); end if;
    if nullif(c.codigo_prestador_operadora, '') is null then v_avis := v_avis || ('Contrato sem código do prestador na operadora.'::text); end if;
    if length(coalesce(pr.cbo, '')) <> 6 then v_avis := v_avis || ('CBO de ' || pr.nome || ' deve ter 6 dígitos (hoje: "' || coalesce(pr.cbo, '') || '").'); end if;
    if v_cid is null then v_avis := v_avis || 'Sem CID: várias operadoras exigem em terapias.'::text; end if;
  end if;

  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then v_bloq := v_bloq || 'Escolha ao menos um procedimento.'::text; end if;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into v_proc from procedimentos where id = (it->>'procedimento_id')::uuid;
    v_qtd := greatest(coalesce((it->>'quantidade')::numeric, 1), 1);
    v_tab := null;
    select * into v_tab from contrato_tabela t where t.contrato_id = c.id and t.procedimento_id = v_proc.id
      and t.vigencia_inicio <= v_data and (t.vigencia_fim is null or t.vigencia_fim >= v_data)
      order by t.vigencia_inicio desc limit 1;
    if v_tab.id is null then
      v_bloq := v_bloq || (v_proc.codigo || ' sem valor vigente na tabela de ' || c.nome || ' em ' || to_char(v_data, 'DD/MM/YYYY') || '.');
    end if;
    -- Duplicidade (glosa 3209): mesmo convênio/carteirinha + procedimento + data
    if exists (select 1 from guia_itens i join guias g on g.id = i.guia_id join paciente_planos pp on pp.id = g.paciente_plano_id
               where i.procedimento_id = v_proc.id and i.data_realizacao = v_data and g.status <> 'cancelada'
                 and g.contrato_id = c.id and (pp.id = pl.id or pp.carteirinha = pl.carteirinha)) then
      v_bloq := v_bloq || (v_proc.codigo || ' já cobrado para este paciente em ' || to_char(v_data, 'DD/MM/YYYY') || ' (glosa 3209 — duplicidade).');
    end if;
    -- Sessões autorizadas (glosa 3292)
    if au.id is not null and au.procedimento_id = v_proc.id then
      select coalesce(sum(i.quantidade), 0) into v_usadas from guia_itens i join guias g on g.id = i.guia_id
        where g.autorizacao_id = au.id and i.procedimento_id = au.procedimento_id and g.status <> 'cancelada';
      if v_usadas + v_qtd > au.qtd_autorizada then
        v_bloq := v_bloq || (v_proc.codigo || ': ' || trim_scale(v_usadas) || ' de ' || au.qtd_autorizada || ' sessões já usadas na autorização (glosa 3292).');
      end if;
    elsif au.id is not null then
      v_avis := v_avis || (v_proc.codigo || ' não é o procedimento da autorização escolhida.');
    end if;
    v_rep := calcular_repasse(a.profissional_id, c.id, v_proc.id, v_data, coalesce(v_tab.valor, 0) * v_qtd);
    if v_rep is null then
      v_avis := v_avis || ('Sem regra de repasse vigente para ' || pr.nome || ' em ' || v_proc.codigo || ': repasse fica R$ 0.');
    end if;
    v_itens := v_itens || jsonb_build_object('procedimento_id', v_proc.id, 'codigo', v_proc.codigo, 'descricao', v_proc.descricao,
      'quantidade', v_qtd, 'tipo_guia', coalesce(v_tab.tipo_guia, 'SP_SADT'),
      'valor', case when v_perfil = 'profissional' then null else coalesce(v_tab.valor, 0) * v_qtd end,
      'repasse', coalesce(v_rep, 0));
  end loop;

  if so.id is null and not coalesce((c.regras->>'sem_tiss')::boolean, false)
     and exists (select 1 from jsonb_array_elements(v_itens) x where x->>'tipo_guia' = 'SP_SADT') then
    v_bloq := v_bloq || 'SP/SADT sem profissional solicitante (pedido médico).'::text;
  end if;

  if not p_gravar or array_length(v_bloq, 1) > 0 then
    return jsonb_build_object('bloqueios', to_jsonb(v_bloq), 'avisos', to_jsonb(v_avis), 'itens', v_itens,
      'data', v_data, 'contrato', c.nome, 'sem_tiss', coalesce((c.regras->>'sem_tiss')::boolean, false));
  end if;

  -- Gravação
  update atendimentos set status = 'atendido', paciente_plano_id = pl.id, autorizacao_id = p_autorizacao, atualizado_em = now()
    where id = a.id;
  if not coalesce((c.regras->>'sem_tiss')::boolean, false) then
    perform pg_advisory_xact_lock(hashtext(c.id::text));
    for v_tipo in select distinct x->>'tipo_guia' from jsonb_array_elements(v_itens) x loop
      select coalesce(max(numero_guia_prestador::bigint), 0) + 1 into v_num
        from guias where contrato_id = c.id and numero_guia_prestador ~ '^\d+$';
      insert into guias (clinica_id, contrato_id, paciente_plano_id, profissional_id, autorizacao_id, atendimento_id,
                         tipo, numero_guia_prestador, numero_guia_operadora, senha, data_atendimento, status,
                         solicitante_id, cid, indicacao_clinica, tipo_atendimento, carater_atendimento, regime_atendimento, hora_inicio, hora_fim)
      values (a.clinica_id, c.id, pl.id, a.profissional_id, p_autorizacao, a.id, v_tipo, v_num::text,
              au.numero_guia_operadora, au.senha, v_data, 'pronta', so.id, v_cid, v_ind, v_tipo_at, '1', '01',
              (a.inicio at time zone 'America/Sao_Paulo')::time, (a.fim at time zone 'America/Sao_Paulo')::time)
      returning id into v_guia;
      v_seq := 0;
      for it in select x from jsonb_array_elements(v_itens) x where x->>'tipo_guia' = v_tipo loop
        v_seq := v_seq + 1;
        select * into v_tab from contrato_tabela t where t.contrato_id = c.id and t.procedimento_id = (it->>'procedimento_id')::uuid
          and t.vigencia_inicio <= v_data and (t.vigencia_fim is null or t.vigencia_fim >= v_data)
          order by t.vigencia_inicio desc limit 1;
        insert into guia_itens (clinica_id, guia_id, procedimento_id, sequencial, data_realizacao, quantidade, valor_informado, repasse_previsto)
        values (a.clinica_id, v_guia, (it->>'procedimento_id')::uuid, v_seq, v_data, (it->>'quantidade')::numeric,
                v_tab.valor * (it->>'quantidade')::numeric, (it->>'repasse')::numeric);
      end loop;
      v_guias := v_guias || jsonb_build_object('id', v_guia, 'numero', v_num::text, 'tipo', v_tipo);
    end loop;
  end if;
  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
    values (a.clinica_id, auth.uid(), 'guias', a.id, 'guia_atendimento', jsonb_build_object('guias', v_guias, 'avisos', to_jsonb(v_avis)));
  return jsonb_build_object('bloqueios', '[]'::jsonb, 'avisos', to_jsonb(v_avis), 'itens', v_itens, 'guias', v_guias, 'gravado', true);
end $$;

create or replace function opcoes_guia(p_atendimento uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a atendimentos; v_perfil perfil_usuario;
begin
  select * into a from atendimentos where id = p_atendimento;
  v_perfil := meu_perfil(a.clinica_id);
  if v_perfil is null or (v_perfil = 'profissional' and a.profissional_id is distinct from meu_profissional(a.clinica_id)) then
    raise exception 'Sem permissão para este atendimento';
  end if;
  return jsonb_build_object(
    'planos', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'contrato_id', c.id, 'contrato', c.nome, 'plano', pl.plano_nome,
        'carteirinha', pl.carteirinha, 'validade', pl.validade, 'principal', pl.principal,
        'sem_tiss', coalesce((c.regras->>'sem_tiss')::boolean, false), 'regras', c.regras->>'observacoes',
        'autorizacoes', coalesce((select jsonb_agg(jsonb_build_object('id', au.id, 'senha', au.senha, 'procedimento_id', au.procedimento_id,
            'codigo', p.codigo, 'qtd', au.qtd_autorizada, 'solicitante_id', au.solicitante_id, 'cid', au.cid, 'indicacao', au.indicacao_clinica, 'data', au.data_autorizacao, 'validade', au.validade,
            'usadas', (select coalesce(sum(i.quantidade), 0) from guia_itens i join guias g on g.id = i.guia_id
                       where g.autorizacao_id = au.id and g.status <> 'cancelada')) order by au.data_autorizacao desc)
          from autorizacoes au join procedimentos p on p.id = au.procedimento_id where au.paciente_plano_id = pl.id), '[]'),
        'procedimentos', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'codigo', p.codigo, 'descricao', p.descricao))
          from contrato_tabela t join procedimentos p on p.id = t.procedimento_id
          where t.contrato_id = c.id and (t.vigencia_fim is null or t.vigencia_fim >= current_date)), '[]')
      ) order by pl.principal desc)
      from paciente_planos pl join contratos c on c.id = pl.contrato_id where pl.paciente_id = a.paciente_id), '[]'),
    'contratos', case when v_perfil = 'profissional' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) order by c.nome)
      from contratos c where c.clinica_id = a.clinica_id and c.ativo
        and not exists (select 1 from contrato_tabela t where t.contrato_id = c.id and t.tipo_guia = 'PARTICULAR')), '[]') end,
    'solicitantes', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'conselho', s.conselho, 'numero', s.numero_conselho, 'uf', s.uf_conselho) order by s.nome)
      from solicitantes s where s.clinica_id = a.clinica_id and s.ativo), '[]'),
    'guias', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'numero', g.numero_guia_prestador, 'tipo', g.tipo, 'status', g.status))
      from guias g where g.atendimento_id = a.id and g.status <> 'cancelada'), '[]'));
end $$;

revoke all on function guia_atendimento(uuid, uuid, uuid, jsonb, boolean, jsonb), opcoes_guia(uuid) from public, anon;
grant execute on function guia_atendimento(uuid, uuid, uuid, jsonb, boolean, jsonb), opcoes_guia(uuid) to authenticated;
