-- =====================================================================
-- CURE OS — Migração 001: Fundação (cadastros, contratos, faturamento,
-- retornos/glosas e repasse). Multi-clínica desde o início (clinica_id).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
create type perfil_usuario   as enum ('gestor','financeiro','recepcao','profissional');
create type tipo_cnpj        as enum ('proprio','intermediario','outro');
create type tipo_regra       as enum ('fixo','percentual');
create type status_lote      as enum ('aberto','fechado','enviado','protocolado','retornado');
create type status_guia      as enum ('rascunho','pronta','enviada','paga','glosa_parcial','glosa_total','cancelada');
create type formato_retorno  as enum ('xml','pdf','planilha');
create type status_retorno   as enum ('processando','em_revisao','confirmado','descartado');
create type classe_linha     as enum ('da_clinica','outra_clinica','inconsistente');
create type status_glosa     as enum ('pendente','em_recurso','recuperada','definitiva','aceita');
create type modo_desconto    as enum ('proporcional','manual','sem_desconto');

-- ---------- Núcleo: clínicas e acesso ----------
create table clinicas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

create table cnpjs_faturamento (           -- CNPJ 1 = próprio, 2/3 = intermediários
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  razao_social text not null,
  cnpj text not null,
  cnes text,
  tipo tipo_cnpj not null default 'proprio',
  ordem smallint not null default 1,
  ativo boolean not null default true
);

create table profissionais (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  nome text not null,
  cpf text,
  conselho text,            -- CRN, CREFITO, CRP...
  numero_conselho text,
  uf_conselho char(2),
  cbo text,
  especialidade text,
  notificacoes_ativas boolean not null default true,   -- opt-in do profissional
  ativo boolean not null default true
);

create table usuarios_clinica (
  user_id uuid not null references auth.users on delete cascade,
  clinica_id uuid not null references clinicas on delete cascade,
  perfil perfil_usuario not null,
  profissional_id uuid references profissionais,
  funcoes_extras text[] not null default '{}',
  ativo boolean not null default true,
  primary key (user_id, clinica_id)
);

-- ---------- Pacientes ----------
create table pacientes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  nome text not null,
  nome_social text,
  cpf text,
  data_nascimento date,
  sexo char(1),
  nome_mae text,
  cns text,
  telefone text,
  email text,
  endereco jsonb,
  consentimento_comunicacao boolean not null default false,
  campos_extras jsonb not null default '{}',
  criado_em timestamptz not null default now(),
  unique (clinica_id, cpf)
);

-- ---------- Convênios ----------
create table operadoras (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  nome text not null,
  registro_ans text,
  cnpj text
);

create table contratos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  operadora_id uuid not null references operadoras,
  cnpj_faturamento_id uuid not null references cnpjs_faturamento,
  nome text not null,                         -- ex.: "SulAmérica via Motivar"
  codigo_prestador_operadora text,
  versao_tiss text not null default '4.03.00',
  vigencia_inicio date,
  vigencia_fim date,
  prazo_envio_dias int,
  prazo_recurso_dias int,
  regras jsonb not null default '{}',         -- carência, limite de sessões etc.
  ativo boolean not null default true
);

create table paciente_planos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  paciente_id uuid not null references pacientes on delete cascade,
  contrato_id uuid not null references contratos,
  plano_nome text,
  carteirinha text not null,
  validade date,
  principal boolean not null default true
);

-- Catálogo TUSS (global, sem clinica_id)
create table procedimentos (
  id uuid primary key default gen_random_uuid(),
  codigo_tabela text not null default '22',
  codigo text not null,
  descricao text not null,
  unique (codigo_tabela, codigo)
);

create table contrato_tabela (              -- o que a clínica RECEBE
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  contrato_id uuid not null references contratos on delete cascade,
  procedimento_id uuid not null references procedimentos,
  valor numeric(12,2) not null,
  vigencia_inicio date not null default current_date,
  vigencia_fim date
);

create table regras_repasse (               -- o que a clínica PAGA a cada profissional
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  profissional_id uuid not null references profissionais on delete cascade,
  contrato_id uuid references contratos,      -- null = vale para todos os contratos
  procedimento_id uuid references procedimentos, -- null = todos os procedimentos
  tipo tipo_regra not null,
  valor numeric(12,2) not null,               -- R$ (fixo) ou % (percentual)
  vigencia_inicio date not null default current_date,
  vigencia_fim date
);

-- ---------- Atendimento e autorização ----------
create table autorizacoes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  paciente_plano_id uuid not null references paciente_planos,
  profissional_id uuid references profissionais,
  procedimento_id uuid not null references procedimentos,
  senha text,
  numero_guia_operadora text,
  qtd_autorizada int not null,
  data_autorizacao date not null,
  validade date
);

create table atendimentos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  paciente_id uuid not null references pacientes,
  profissional_id uuid not null references profissionais,
  paciente_plano_id uuid references paciente_planos,   -- null = particular
  autorizacao_id uuid references autorizacoes,
  inicio timestamptz not null,
  status text not null default 'agendado',  -- agendado/confirmado/presente/atendido/faltou/cancelado
  criado_em timestamptz not null default now()
);

-- ---------- Faturamento ----------
create table lotes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  contrato_id uuid not null references contratos,
  numero_lote text not null,
  competencia date not null,
  status status_lote not null default 'aberto',
  protocolo text,
  data_envio date,
  arquivo_xml text,
  unique (contrato_id, numero_lote)          -- chave do vínculo com o retorno
);

create table guias (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  contrato_id uuid not null references contratos,
  lote_id uuid references lotes,
  paciente_plano_id uuid not null references paciente_planos,
  profissional_id uuid not null references profissionais,
  autorizacao_id uuid references autorizacoes,
  atendimento_id uuid references atendimentos,
  tipo text not null default 'SP_SADT',
  numero_guia_prestador text not null,
  numero_guia_operadora text,
  senha text,
  data_atendimento date not null,
  status status_guia not null default 'rascunho',
  unique (contrato_id, numero_guia_prestador)
);

create table guia_itens (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  guia_id uuid not null references guias on delete cascade,
  procedimento_id uuid not null references procedimentos,
  sequencial int not null default 1,
  data_realizacao date not null,
  quantidade numeric(8,2) not null default 1,
  valor_informado numeric(12,2) not null,
  valor_liberado numeric(12,2),
  valor_glosa numeric(12,2) not null default 0,
  repasse_previsto numeric(12,2) not null default 0,   -- calculado pela regra
  repasse_desconto numeric(12,2) not null default 0,   -- efeito da glosa
  repasse_final numeric(12,2) generated always as (repasse_previsto - repasse_desconto) stored
);

-- ---------- Retornos e glosas ----------
create table motivos_glosa (               -- tabela ANS de mensagens/glosas (global)
  codigo text primary key,
  descricao text not null
);

create table retornos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  contrato_id uuid references contratos,
  formato formato_retorno not null,
  arquivo text not null,                     -- caminho no Storage
  registro_ans text,
  codigo_prestador text,
  data_emissao date,
  total_informado numeric(14,2),
  total_liberado numeric(14,2),
  total_glosa numeric(14,2),
  soma_confere boolean,                      -- soma das linhas = total do arquivo
  status status_retorno not null default 'processando',
  enviado_por uuid references auth.users,
  confirmado_por uuid references auth.users,
  confirmado_em timestamptz,
  criado_em timestamptz not null default now()
);

create table retorno_linhas (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  retorno_id uuid not null references retornos on delete cascade,
  numero_lote text,
  protocolo text,
  numero_guia_prestador text,
  numero_guia_operadora text,
  carteirinha text,
  data_realizacao date,
  codigo_procedimento text,
  sequencial_item int,
  valor_informado numeric(12,2),
  valor_liberado numeric(12,2),
  valor_glosa numeric(12,2),
  codigo_glosa text,
  classe classe_linha,
  guia_id uuid references guias,
  guia_item_id uuid references guia_itens,
  confianca numeric(3,2),                    -- 0–1
  revisado boolean not null default false,
  pagina_origem int
);

create table glosas (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  guia_item_id uuid not null references guia_itens,
  retorno_linha_id uuid references retorno_linhas,
  codigo_glosa text references motivos_glosa,
  valor numeric(12,2) not null,
  status status_glosa not null default 'pendente',
  prazo_recurso date,
  modo_desconto modo_desconto not null default 'proporcional',
  desconto_manual numeric(12,2),
  orientacao text,                           -- recado da gestora ao profissional
  confirmada_por uuid references auth.users,
  confirmada_em timestamptz
);

-- ---------- Notificações e auditoria ----------
create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  profissional_id uuid references profissionais,
  tipo text not null,                        -- glosa, repasse, agenda
  referencia uuid,
  mensagem text not null,
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);

create table auditoria (
  id bigint generated always as identity primary key,
  clinica_id uuid,
  user_id uuid,
  tabela text not null,
  registro_id text,
  acao text not null,
  dados jsonb,
  em timestamptz not null default now()
);

-- ---------- Índices de vínculo ----------
create index on retorno_linhas (retorno_id);
create index on retorno_linhas (numero_lote, numero_guia_prestador);
create index on guias (lote_id);
create index on guias (profissional_id);
create index on guia_itens (guia_id);
create index on glosas (guia_item_id);
create index on atendimentos (profissional_id, inicio);

-- =====================================================================
-- Regra de repasse com glosa (definida pela gestora):
-- desconto proporcional = repasse_previsto × (glosa do item / valor do item)
-- ex.: recebe 80, paga 60, glosa 80 → desconto 60; glosa 40 → desconto 30.
-- Pode ser substituído por valor manual ou "sem desconto" na glosa.
-- =====================================================================
create or replace function calcular_desconto_repasse(p_item uuid)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(
    case g.modo_desconto
      when 'manual'       then coalesce(g.desconto_manual,0)
      when 'sem_desconto' then 0
      else round(i.repasse_previsto * g.valor / nullif(i.valor_informado,0), 2)
    end),0)
  from guia_itens i join glosas g on g.guia_item_id = i.id
  where i.id = p_item and g.status in ('pendente','definitiva','aceita','em_recurso')
    and g.confirmada_em is not null;
$$;

create or replace function trg_glosa_recalcula() returns trigger
language plpgsql set search_path = public as $$
declare v_item uuid := coalesce(new.guia_item_id, old.guia_item_id);
begin
  update guia_itens set repasse_desconto = least(repasse_previsto, calcular_desconto_repasse(v_item))
  where id = v_item;
  return null;
end $$;

create trigger glosa_recalcula after insert or update or delete on glosas
for each row execute function trg_glosa_recalcula();

-- Notifica o profissional quando a gestora CONFIRMA uma glosa
create or replace function trg_glosa_notifica() returns trigger
language plpgsql set search_path = public as $$
declare v_prof uuid;
begin
  if new.confirmada_em is not null and (old is null or old.confirmada_em is null) then
    select g.profissional_id into v_prof from guia_itens i join guias g on g.id = i.guia_id
    where i.id = new.guia_item_id;
    insert into notificacoes (clinica_id, profissional_id, tipo, referencia, mensagem)
    values (new.clinica_id, v_prof, 'glosa', new.id,
            'Nova glosa confirmada (código ' || coalesce(new.codigo_glosa,'—') || ').');
  end if;
  return new;
end $$;

create trigger glosa_notifica after insert or update on glosas
for each row execute function trg_glosa_notifica();

-- =====================================================================
-- Segurança (RLS) — perfis
-- =====================================================================
create or replace function meu_perfil(p_clinica uuid) returns perfil_usuario
language sql stable security definer set search_path = public as $$
  select perfil from usuarios_clinica
  where user_id = auth.uid() and clinica_id = p_clinica and ativo;
$$;

create or replace function meu_profissional(p_clinica uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select profissional_id from usuarios_clinica
  where user_id = auth.uid() and clinica_id = p_clinica and ativo;
$$;

do $$
declare t text;
begin
  -- Tabelas de gestão total (gestor + financeiro)
  foreach t in array array['cnpjs_faturamento','operadoras','contratos','contrato_tabela',
    'regras_repasse','lotes','guias','guia_itens','retornos','retorno_linhas','glosas'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy gestao_%1$s on %1$I for all to authenticated
      using (meu_perfil(clinica_id) in ('gestor','financeiro'))
      with check (meu_perfil(clinica_id) in ('gestor','financeiro'))$p$, t);
  end loop;

  -- Tabelas operacionais (gestor + recepção editam; profissional lê)
  foreach t in array array['pacientes','paciente_planos','profissionais','atendimentos','autorizacoes'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy edita_%1$s on %1$I for all to authenticated
      using (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'))
      with check (meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'))$p$, t);
  end loop;
end $$;

-- Profissional: só os próprios atendimentos e os pacientes deles
create policy prof_atendimentos on atendimentos for select to authenticated
  using (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id));
create policy prof_pacientes on pacientes for select to authenticated
  using (meu_perfil(clinica_id) = 'profissional' and exists (
    select 1 from atendimentos a where a.paciente_id = pacientes.id
      and a.profissional_id = meu_profissional(pacientes.clinica_id)));
create policy prof_proprio_cadastro on profissionais for select to authenticated
  using (id = meu_profissional(clinica_id));

alter table clinicas enable row level security;
create policy ver_clinica on clinicas for select to authenticated using (meu_perfil(id) is not null);
create policy gestor_clinica on clinicas for update to authenticated using (meu_perfil(id) = 'gestor');

alter table usuarios_clinica enable row level security;
create policy ver_proprio_vinculo on usuarios_clinica for select to authenticated
  using (user_id = auth.uid() or meu_perfil(clinica_id) = 'gestor');
create policy gestor_usuarios on usuarios_clinica for all to authenticated
  using (meu_perfil(clinica_id) = 'gestor') with check (meu_perfil(clinica_id) = 'gestor');

alter table notificacoes enable row level security;
create policy minhas_notificacoes on notificacoes for select to authenticated
  using (meu_perfil(clinica_id) in ('gestor','financeiro')
         or profissional_id = meu_profissional(clinica_id));
create policy marcar_lida on notificacoes for update to authenticated
  using (profissional_id = meu_profissional(clinica_id));

alter table auditoria enable row level security;
create policy gestor_auditoria on auditoria for select to authenticated
  using (meu_perfil(clinica_id) = 'gestor');

alter table procedimentos enable row level security;
create policy ler_procedimentos on procedimentos for select to authenticated using (true);
alter table motivos_glosa enable row level security;
create policy ler_motivos on motivos_glosa for select to authenticated using (true);

-- Extrato do profissional: mostra SÓ o repasse dele, nunca o valor que a clínica recebe
create or replace function meu_extrato(p_clinica uuid, p_de date, p_ate date)
returns table (data date, paciente text, procedimento text, numero_guia text,
               repasse_previsto numeric, desconto_glosa numeric, repasse_final numeric,
               glosa_codigo text, glosa_motivo text, glosa_status status_glosa, orientacao text)
language sql stable security definer set search_path = public as $$
  select i.data_realizacao, p.nome, pr.descricao, g.numero_guia_prestador,
         i.repasse_previsto, i.repasse_desconto, i.repasse_final,
         gl.codigo_glosa, mg.descricao, gl.status, gl.orientacao
  from guia_itens i
  join guias g on g.id = i.guia_id
  join paciente_planos pp on pp.id = g.paciente_plano_id
  join pacientes p on p.id = pp.paciente_id
  join procedimentos pr on pr.id = i.procedimento_id
  left join glosas gl on gl.guia_item_id = i.id and gl.confirmada_em is not null
  left join motivos_glosa mg on mg.codigo = gl.codigo_glosa
  where g.clinica_id = p_clinica
    and g.profissional_id = meu_profissional(p_clinica)
    and i.data_realizacao between p_de and p_ate
  order by i.data_realizacao;
$$;

revoke execute on function meu_extrato(uuid,date,date) from public, anon;
grant execute on function meu_extrato(uuid,date,date) to authenticated;

-- Motivos de glosa já vistos no retorno real da SulAmérica (out/2026)
insert into motivos_glosa (codigo, descricao) values
 ('1814','Cobrança de procedimento com data de autorização posterior à do atendimento'),
 ('3209','Cobrança de procedimento/item assistencial em duplicidade'),
 ('3292','Quantidade solicitada de procedimento/item assistencial acima da autorizada'),
 ('1705','Valor do procedimento apresentado a maior')
on conflict do nothing;
