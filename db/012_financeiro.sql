-- =====================================================================
-- CURE OS — Migração 012: Financeiro gerencial (fase a + c)
-- Contas, plano de categorias (com grupo da DRE), lançamentos
-- (previsto × realizado), recorrência/parcelas e repasse do mês.
-- A contabilidade oficial segue com o contador.
-- =====================================================================

create table if not exists contas_financeiras (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  nome text not null,
  tipo text not null default 'banco' check (tipo in ('banco','caixa','cartao','aplicacao')),
  banco text, agencia text, conta text,
  saldo_inicial numeric(12,2) not null default 0,
  data_saldo_inicial date not null default current_date,
  ativo boolean not null default true
);

-- grupo_dre define a linha da DRE gerencial
create table if not exists categorias_financeiras (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  tipo text not null check (tipo in ('receita','despesa')),
  grupo_dre text not null check (grupo_dre in ('receita_bruta','deducoes','custo_direto',
    'despesa_operacional','resultado_financeiro','investimento','retirada','transferencia')),
  nome text not null,
  ordem int not null default 100,
  ativo boolean not null default true,
  unique (clinica_id, nome)
);

create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  tipo text not null check (tipo in ('receber','pagar')),
  descricao text not null,
  categoria_id uuid references categorias_financeiras,
  conta_id uuid references contas_financeiras,
  area text check (area in ('fisioterapia','nutricao','psicologia','palmilha','geral')),
  competencia date not null,                 -- 1º dia do mês a que pertence (DRE)
  vencimento date not null,
  valor_previsto numeric(12,2) not null check (valor_previsto >= 0),
  status text not null default 'previsto' check (status in ('previsto','pago','cancelado')),
  valor_realizado numeric(12,2),
  data_realizado date,
  forma_pagamento text,                      -- pix, boleto, cartao_credito, cartao_debito, dinheiro, ted, debito_automatico
  documento text,                            -- NF, boleto, recibo
  fornecedor text,                           -- quem paga/recebe (texto livre)
  contrato_id uuid references contratos,
  lote_id uuid references lotes,
  profissional_id uuid references profissionais,
  serie_id uuid,                             -- agrupa recorrências/parcelas
  parcela text,                              -- ex.: 3/12
  origem text not null default 'manual' check (origem in ('manual','repasse','lote','extrato')),
  observacao text,
  criado_em timestamptz not null default now(),
  check (status <> 'pago' or (valor_realizado is not null and data_realizado is not null))
);
create index if not exists lanc_clinica_venc on lancamentos (clinica_id, vencimento);
create index if not exists lanc_clinica_comp on lancamentos (clinica_id, competencia);
create unique index if not exists lanc_repasse_unico on lancamentos (clinica_id, profissional_id, competencia)
  where origem = 'repasse' and status <> 'cancelado';

do $$
declare t text;
begin
  foreach t in array array['contas_financeiras','categorias_financeiras','lancamentos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists gestao_%1$s on %1$I', t);
    execute format($p$create policy gestao_%1$s on %1$I for all to authenticated
      using (meu_perfil(clinica_id) in ('gestor','financeiro'))
      with check (meu_perfil(clinica_id) in ('gestor','financeiro'))$p$, t);
  end loop;
end $$;

-- Plano de categorias padrão (idempotente)
create or replace function semear_categorias(p_clinica uuid) returns void
language sql security definer set search_path = public as $$
  insert into categorias_financeiras (clinica_id, tipo, grupo_dre, nome, ordem)
  select p_clinica, t, g, n, o from (values
    ('receita','receita_bruta','Convênios',10),
    ('receita','receita_bruta','Particular – consultas e sessões',11),
    ('receita','receita_bruta','Palmilhas e chinelos 3D',12),
    ('receita','receita_bruta','Pacotes e avaliações',13),
    ('receita','receita_bruta','Outras receitas',19),
    ('despesa','deducoes','Impostos sobre faturamento (Simples/DAS)',20),
    ('despesa','deducoes','Taxas de cartão e maquininha',21),
    ('despesa','custo_direto','Repasse a profissionais',30),
    ('despesa','custo_direto','Insumos de palmilha (impressão 3D, EVA, revestimento)',31),
    ('despesa','custo_direto','Materiais de atendimento',32),
    ('despesa','despesa_operacional','Aluguel e condomínio',40),
    ('despesa','despesa_operacional','Energia, água, internet e telefone',41),
    ('despesa','despesa_operacional','Salários, encargos e pró-labore',42),
    ('despesa','despesa_operacional','Contabilidade',43),
    ('despesa','despesa_operacional','Sistemas e assinaturas',44),
    ('despesa','despesa_operacional','Marketing',45),
    ('despesa','despesa_operacional','Manutenção e limpeza',46),
    ('despesa','despesa_operacional','Conselhos, alvarás e taxas',47),
    ('despesa','despesa_operacional','Outras despesas',49),
    ('receita','resultado_financeiro','Rendimentos de aplicação',50),
    ('despesa','resultado_financeiro','Tarifas bancárias e juros',51),
    ('despesa','investimento','Equipamentos e obras',60),
    ('despesa','retirada','Distribuição de lucros',70),
    ('receita','transferencia','Transferência entre contas (entrada)',80),
    ('despesa','transferencia','Transferência entre contas (saída)',81)
  ) v(t,g,n,o)
  on conflict (clinica_id, nome) do nothing;
$$;
revoke execute on function semear_categorias(uuid) from public, anon, authenticated;
select semear_categorias(id) from clinicas;

-- Repasse do mês → um lançamento a pagar por profissional (competência = mês dos atendimentos).
-- Recalcula os previstos ainda em aberto; não mexe em repasses já pagos.
create or replace function gerar_repasse_mes(p_clinica uuid, p_competencia date, p_vencimento date)
returns int language plpgsql security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_competencia)::date; v_cat uuid; n int := 0; r record;
begin
  if coalesce(meu_perfil(p_clinica)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  select id into v_cat from categorias_financeiras where clinica_id = p_clinica and nome = 'Repasse a profissionais';
  for r in
    select g.profissional_id, p.nome, sum(i.repasse_final) total, count(*) itens
    from guia_itens i join guias g on g.id = i.guia_id join profissionais p on p.id = g.profissional_id
    where g.clinica_id = p_clinica and g.status <> 'cancelada'
      and i.data_realizacao >= v_ini and i.data_realizacao < (v_ini + interval '1 month')
    group by 1, 2
  loop
    if exists (select 1 from lancamentos where clinica_id = p_clinica and origem = 'repasse'
               and profissional_id = r.profissional_id and competencia = v_ini and status = 'pago') then
      continue;
    end if;
    delete from lancamentos where clinica_id = p_clinica and origem = 'repasse'
      and profissional_id = r.profissional_id and competencia = v_ini and status = 'previsto';
    if r.total > 0 then
      insert into lancamentos (clinica_id, tipo, descricao, categoria_id, competencia, vencimento, valor_previsto,
        profissional_id, fornecedor, origem, observacao)
      values (p_clinica, 'pagar', 'Repasse ' || to_char(v_ini, 'MM/YYYY') || ' – ' || r.nome, v_cat, v_ini, p_vencimento,
        r.total, r.profissional_id, r.nome, 'repasse', r.itens || ' itens faturados (já com desconto de glosas)');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
