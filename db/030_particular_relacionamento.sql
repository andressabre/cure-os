-- 030 — Lote B: recebimento do particular (pagamento, desconto decidido pelo profissional, nº da NFS-e emitida no Emissor Nacional gov.br)
--        Lote C: relacionamento (aniversário e reavaliações), opt-out: todos aceitam por padrão; "pediu para sair" desliga.

-- ======================================================== B. recebimentos
create table if not exists recebimentos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  atendimento_id uuid references atendimentos on delete set null,
  paciente_id uuid not null references pacientes,
  profissional_id uuid references profissionais,
  procedimento_id uuid references procedimentos,
  descricao text,
  valor_tabela numeric(10,2),
  desconto numeric(10,2) not null default 0 check (desconto >= 0),
  valor_pago numeric(10,2) not null check (valor_pago >= 0),
  forma text not null check (forma in ('pix','dinheiro','debito','credito','credito_parcelado','transferencia','outro')),
  parcelas int not null default 1 check (parcelas between 1 and 24),
  pago_em date not null default current_date,
  nf_numero text, nf_emitida_em date,
  observacao text,
  lancamento_id uuid references lancamentos on delete set null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists recebimentos_paciente on recebimentos (paciente_id);
create index if not exists recebimentos_atendimento on recebimentos (atendimento_id);
create index if not exists recebimentos_nf_pendente on recebimentos (clinica_id) where nf_numero is null;
alter table recebimentos enable row level security;
create policy rec_gestao on recebimentos to authenticated
  using (meu_perfil(clinica_id) in ('gestor','financeiro','recepcao'))
  with check (meu_perfil(clinica_id) in ('gestor','financeiro','recepcao'));
create policy rec_prof on recebimentos to authenticated
  using (profissional_id = meu_profissional(clinica_id))
  with check (profissional_id = meu_profissional(clinica_id));

alter table lancamentos drop constraint if exists lancamentos_origem_check;
alter table lancamentos add constraint lancamentos_origem_check check (origem in ('manual','repasse','lote','extrato','particular'));

-- Recebimento → lançamento "a receber / pago" no Financeiro (caixa e DRE), com categoria e área pelo procedimento/profissional
create or replace function recebimento_lancamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cod text; v_cat text; v_area text; v_esp text; v_lanc uuid; v_pac text; v_forma text;
begin
  if tg_op = 'DELETE' then
    if old.lancamento_id is not null then update lancamentos set status = 'cancelado' where id = old.lancamento_id; end if;
    return old;
  end if;
  select codigo into v_cod from procedimentos where id = new.procedimento_id;
  select especialidade into v_esp from profissionais where id = new.profissional_id;
  select nome into v_pac from pacientes where id = new.paciente_id;
  v_area := case when v_cod ~ '(PALM|CHIN)' then 'palmilha' when v_esp ilike 'nutri%' then 'nutricao'
                 when v_esp ilike 'psic%' then 'psicologia' when v_esp ilike 'fisio%' then 'fisioterapia' else 'geral' end;
  v_cat := case when v_cod ~ '(PALM|CHIN)' then 'Palmilhas e chinelos 3D'
                when v_cod ~ '(AVAL|BIO|ANTRO|TM4|VENT4)' then 'Pacotes e avaliações' else 'Particular – consultas e sessões' end;
  v_forma := new.forma || case when new.parcelas > 1 then ' ' || new.parcelas || 'x' else '' end;
  if new.lancamento_id is null then
    insert into lancamentos (clinica_id, tipo, descricao, categoria_id, area, competencia, vencimento, valor_previsto, status,
      valor_realizado, data_realizado, forma_pagamento, documento, profissional_id, origem, observacao)
    values (new.clinica_id, 'receber', 'Particular – ' || coalesce(v_pac, '') || coalesce(' – ' || new.descricao, ''),
      (select id from categorias_financeiras where clinica_id = new.clinica_id and nome = v_cat limit 1), v_area,
      date_trunc('month', new.pago_em)::date, new.pago_em, new.valor_pago, 'pago', new.valor_pago, new.pago_em, v_forma,
      case when new.nf_numero is not null then 'NFS-e ' || new.nf_numero end, new.profissional_id, 'particular',
      case when new.desconto > 0 then 'Desconto R$ ' || new.desconto end)
    returning id into v_lanc;
    new.lancamento_id := v_lanc;
  else
    update lancamentos set valor_previsto = new.valor_pago, valor_realizado = new.valor_pago, data_realizado = new.pago_em,
      vencimento = new.pago_em, competencia = date_trunc('month', new.pago_em)::date, forma_pagamento = v_forma, area = v_area,
      documento = case when new.nf_numero is not null then 'NFS-e ' || new.nf_numero end,
      observacao = case when new.desconto > 0 then 'Desconto R$ ' || new.desconto end
    where id = new.lancamento_id;
  end if;
  return new;
end $$;
revoke execute on function recebimento_lancamento() from public, anon, authenticated;
drop trigger if exists recebimento_lancamento on recebimentos;
create trigger recebimento_lancamento before insert or update on recebimentos for each row execute function recebimento_lancamento();
drop trigger if exists recebimento_lancamento_del on recebimentos;
create trigger recebimento_lancamento_del after delete on recebimentos for each row execute function recebimento_lancamento();

-- ======================================================== C. relacionamento (opt-out)
alter table pacientes alter column consentimento_comunicacao set default true;
alter table pacientes add column if not exists comunicacao_optout_em timestamptz;
update pacientes set consentimento_comunicacao = true where comunicacao_optout_em is null and consentimento_comunicacao is distinct from true;

update clinicas set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('relacionamento', jsonb_build_object(
  'reavaliacoes', jsonb_build_array(
    jsonb_build_object('nome', 'Bioimpedância', 'dias', 90, 'codigos', jsonb_build_array('20101104','CURE-BIO','CURE-BIOANT','CURE-AVAL6')),
    jsonb_build_object('nome', 'Palmilha 3D', 'dias', 365, 'codigos', jsonb_build_array('CURE-PALM3D','CURE-PALM3D-C','CURE-CHIN3D','CURE-CHIN3D-C','CURE-CPALM'))),
  'texto_aniversario', 'Olá, {nome}! A equipe da Clínica Cure deseja um feliz aniversário! 🎉 Muita saúde e um ótimo novo ciclo.',
  'texto_reavaliacao', 'Olá, {nome}! Aqui é da Clínica Cure. Já faz {tempo} desde sua última {item}. Que tal agendar uma reavaliação para acompanhar sua evolução?',
  'rodape_sair', 'Se não quiser mais receber mensagens como esta, responda SAIR.'))
where not (coalesce(config, '{}'::jsonb) ? 'relacionamento');

-- Lista do dia: aniversariantes (hoje + p_dias) e reavaliações vencendo/vencidas (até 30 dias atrás) sem agendamento futuro
create or replace function relacionamento(p_clinica uuid, p_dias int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cfg jsonb; v_out jsonb := '[]'::jsonb; g jsonb;
begin
  if coalesce(meu_perfil(p_clinica)::text, '') not in ('gestor','financeiro','recepcao') then raise exception 'Sem permissão'; end if;
  select config->'relacionamento' into v_cfg from clinicas where id = p_clinica;
  -- aniversário (dia/mês nos próximos p_dias)
  v_out := v_out || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'aniversario', 'paciente_id', p.id, 'nome', p.nome, 'telefone', p.telefone,
      'quando', d.dia, 'idade', extract(year from age(d.dia, p.data_nascimento))::int) order by d.dia)
    from pacientes p
    cross join lateral (select make_date(extract(year from current_date)::int + case when to_char(p.data_nascimento, 'MMDD') < to_char(current_date, 'MMDD') then 1 else 0 end,
      extract(month from p.data_nascimento)::int, 1) + (extract(day from p.data_nascimento)::int - 1) dia) d   -- 29/02 vira 01/03 em ano comum
    where p.clinica_id = p_clinica and p.ativo and p.consentimento_comunicacao and p.comunicacao_optout_em is null
      and p.data_nascimento is not null and d.dia between current_date and current_date + p_dias), '[]'::jsonb);
  -- reavaliações
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
      select jsonb_agg(jsonb_build_object('tipo', 'reavaliacao', 'item', g->>'nome', 'paciente_id', p.id, 'nome', p.nome, 'telefone', p.telefone,
          'ultima', u.dia, 'quando', u.dia + (g->>'dias')::int) order by u.dia)
      from ult u join pacientes p on p.id = u.paciente_id
      where p.ativo and p.consentimento_comunicacao and p.comunicacao_optout_em is null
        and u.dia + (g->>'dias')::int between current_date - 30 and current_date + p_dias
        and not exists (select 1 from atendimentos a where a.paciente_id = p.id and a.inicio > now() and a.status in ('agendado','confirmado'))), '[]'::jsonb);
  end loop;
  return jsonb_build_object('itens', v_out, 'config', v_cfg);
end $$;
revoke execute on function relacionamento(uuid, int) from public, anon;
grant execute on function relacionamento(uuid, int) to authenticated;
