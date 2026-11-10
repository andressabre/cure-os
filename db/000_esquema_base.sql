-- =====================================================================
-- db/000_esquema_base.sql
-- Esquema base extraido da producao do projeto Supabase (paipxhfhwiztznvbxawz)
-- em 2026-11-10, via execute_sql somente leitura.
--
-- Uso: gerado a partir da producao; substitui 001-033 para bancos NOVOS.
-- NAO aplicar em banco existente (producao ja tem estas migracoes aplicadas).
-- Migracoes seguintes (db/034 em diante) partem deste arquivo.
--
-- Conteudo: somente DDL. Zero INSERT / COPY / dados de negocio.
-- Ordem: extensoes -> tipos -> tabelas (colunas, defaults, PK) ->
--        constraints (FK, UNIQUE, CHECK) -> indices -> funcoes ->
--        triggers -> RLS e policies -> grants/revokes -> storage -> trigger em auth.users
--
-- CONTAGENS DE PRODUCAO (pg_catalog / information_schema, 2026-11-10):
--   tabelas public ............... 37
--   colunas public ............... 421
--   constraints public ........... 175  (37 PK + 138 FK/UNIQUE/CHECK em ALTER TABLE)
--   indices public ............... 71   (37 PK + 8 UNIQUE de constraint + 26 CREATE INDEX)
--   funcoes public ............... 45
--   triggers public (nao internos) 6
--   policies public .............. 59
--   tipos enum public ............ 10
--   extensoes instaladas ......... 5 (plpgsql e builtin; 4 criadas aqui)
--   buckets storage .............. 2
--   policies storage.objects ..... 6
--   triggers em auth.users ....... 2
--
-- VALIDACAO: create_branch NAO foi usado (plano gratuito). A conferencia
-- foi feita contando, no proprio arquivo, os mesmos objetos acima e
-- comparando com as contagens de producao (ver linha de conferencia no fim).
--
-- FORA DESTE ARQUIVO (gerenciado pela plataforma ou nao extraido):
--   - schema auth e tabelas de auth.* (Supabase Auth);
--   - triggers internos do schema storage (criados pelo Supabase Storage);
--   - ALTER DEFAULT PRIVILEGES do projeto (grants automaticos da plataforma);
--   - configuracoes do painel (SMTP, politica de senha, sessao, MFA);
--   - Edge Function agenda-ics (arquivo proprio, nao e SQL);
--   - dados (nenhum INSERT foi gerado).
--
-- ACHADOS DE SEGURANCA ENCONTRADOS NA EXTRACAO (nao corrigidos aqui; ver grants
-- no fim do arquivo): ver secao "ACHADOS" no bloco de grants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extensoes
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ---------------------------------------------------------------------
-- 2. Tipos enumerados
-- ---------------------------------------------------------------------
CREATE TYPE classe_linha AS ENUM ('da_clinica', 'outra_clinica', 'inconsistente');
CREATE TYPE formato_retorno AS ENUM ('xml', 'pdf', 'planilha');
CREATE TYPE modo_desconto AS ENUM ('proporcional', 'manual', 'sem_desconto');
CREATE TYPE perfil_usuario AS ENUM ('gestor', 'financeiro', 'recepcao', 'profissional');
CREATE TYPE status_glosa AS ENUM ('pendente', 'em_recurso', 'recuperada', 'definitiva', 'aceita');
CREATE TYPE status_guia AS ENUM ('rascunho', 'pronta', 'enviada', 'paga', 'glosa_parcial', 'glosa_total', 'cancelada');
CREATE TYPE status_lote AS ENUM ('aberto', 'fechado', 'enviado', 'protocolado', 'retornado');
CREATE TYPE status_retorno AS ENUM ('processando', 'em_revisao', 'confirmado', 'descartado');
CREATE TYPE tipo_cnpj AS ENUM ('proprio', 'intermediario', 'outro');
CREATE TYPE tipo_regra AS ENUM ('fixo', 'percentual');

-- ---------------------------------------------------------------------
-- 3. Tabelas (colunas, defaults, PK). FK/UNIQUE/CHECK na secao 4.
-- ---------------------------------------------------------------------
CREATE TABLE public.clinicas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  config jsonb NOT NULL DEFAULT '{"abre": "07:00", "dias": [1, 2, 3, 4, 5, 6], "fecha": "20:00", "intervalo_min": 10}'::jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE public.profissionais (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  nome text NOT NULL,
  cpf text,
  conselho text,
  numero_conselho text,
  uf_conselho char(2),
  cbo text,
  especialidade text,
  notificacoes_ativas boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  duracao_padrao_min integer NOT NULL DEFAULT 45,
  cor text NOT NULL DEFAULT '#F8781D',
  agenda_token uuid NOT NULL DEFAULT gen_random_uuid(),
  PRIMARY KEY (id)
);

CREATE TABLE public.usuarios_clinica (
  user_id uuid NOT NULL,
  clinica_id uuid NOT NULL,
  perfil perfil_usuario NOT NULL,
  profissional_id uuid,
  funcoes_extras text[] NOT NULL DEFAULT '{}'::text[],
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, clinica_id)
);

CREATE TABLE public.convites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  email text NOT NULL,
  perfil perfil_usuario NOT NULL,
  profissional_id uuid,
  usado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.auditoria (
  id bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  clinica_id uuid,
  user_id uuid,
  tabela text NOT NULL,
  registro_id text,
  acao text NOT NULL,
  dados jsonb,
  em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.motivos_glosa (
  codigo text NOT NULL,
  descricao text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  substituido_por text,
  inativo_desde date,
  PRIMARY KEY (codigo)
);

CREATE TABLE public.procedimentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  codigo_tabela text NOT NULL DEFAULT '22',
  codigo text NOT NULL,
  descricao text NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE public.operadoras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  nome text NOT NULL,
  registro_ans text,
  cnpj text,
  PRIMARY KEY (id)
);

CREATE TABLE public.cnpjs_faturamento (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  razao_social text NOT NULL,
  cnpj text NOT NULL,
  cnes text,
  tipo tipo_cnpj NOT NULL DEFAULT 'proprio',
  ordem smallint NOT NULL DEFAULT 1,
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE public.solicitantes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  nome text NOT NULL,
  conselho text NOT NULL DEFAULT 'CRM',
  numero_conselho text NOT NULL,
  uf_conselho char(2) NOT NULL DEFAULT 'SC',
  cbo text NOT NULL DEFAULT '225125',
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE public.encaminhamentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  paciente_id uuid NOT NULL,
  area text NOT NULL,
  solicitante_id uuid,
  data_pedido date NOT NULL,
  validade date,
  cid text,
  indicacao_clinica text,
  qtd_sessoes integer,
  arquivo text,
  arquivo_nome text,
  status text NOT NULL DEFAULT 'ativo',
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  PRIMARY KEY (id)
);

CREATE TABLE public.pacientes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  nome text NOT NULL,
  nome_social text,
  cpf text,
  data_nascimento date,
  sexo char(1),
  nome_mae text,
  cns text,
  telefone text,
  email text,
  endereco jsonb,
  consentimento_comunicacao boolean NOT NULL DEFAULT true,
  campos_extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  origem text,
  origem_id text,
  ativo boolean NOT NULL DEFAULT true,
  comunicacao_optout_em timestamptz,
  PRIMARY KEY (id)
);

CREATE TABLE public.paciente_planos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  paciente_id uuid NOT NULL,
  contrato_id uuid NOT NULL,
  plano_nome text,
  carteirinha text NOT NULL,
  validade date,
  principal boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE public.contratos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  operadora_id uuid NOT NULL,
  cnpj_faturamento_id uuid NOT NULL,
  nome text NOT NULL,
  codigo_prestador_operadora text,
  versao_tiss text NOT NULL DEFAULT '4.03.00',
  vigencia_inicio date,
  vigencia_fim date,
  prazo_envio_dias integer,
  prazo_recurso_dias integer,
  regras jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE public.contrato_tabela (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  contrato_id uuid NOT NULL,
  procedimento_id uuid NOT NULL,
  valor numeric(12,2) NOT NULL,
  vigencia_inicio date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim date,
  tipo_guia text NOT NULL DEFAULT 'SP_SADT',
  PRIMARY KEY (id)
);

CREATE TABLE public.regras_repasse (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  profissional_id uuid NOT NULL,
  contrato_id uuid,
  procedimento_id uuid,
  tipo tipo_regra NOT NULL,
  valor numeric(12,2) NOT NULL,
  vigencia_inicio date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim date,
  PRIMARY KEY (id)
);

CREATE TABLE public.atendimentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  paciente_id uuid NOT NULL,
  profissional_id uuid NOT NULL,
  paciente_plano_id uuid,
  autorizacao_id uuid,
  inicio timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'agendado',
  criado_em timestamptz NOT NULL DEFAULT now(),
  fim timestamptz NOT NULL,
  servico text,
  sala text,
  observacao text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  serie_id uuid,
  lembrete_enviado_em timestamptz,
  PRIMARY KEY (id)
);

CREATE TABLE public.autorizacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  paciente_plano_id uuid NOT NULL,
  profissional_id uuid,
  procedimento_id uuid NOT NULL,
  senha text,
  numero_guia_operadora text,
  qtd_autorizada integer NOT NULL,
  data_autorizacao date,
  validade date,
  solicitante_id uuid,
  cid text,
  indicacao_clinica text,
  status text NOT NULL DEFAULT 'autorizada',
  qtd_solicitada integer,
  solicitada_em timestamptz NOT NULL DEFAULT now(),
  observacao text,
  encaminhamento_id uuid,
  area text,
  PRIMARY KEY (id)
);

CREATE TABLE public.guias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  contrato_id uuid NOT NULL,
  lote_id uuid,
  paciente_plano_id uuid NOT NULL,
  profissional_id uuid NOT NULL,
  autorizacao_id uuid,
  atendimento_id uuid,
  tipo text NOT NULL DEFAULT 'SP_SADT',
  numero_guia_prestador text NOT NULL,
  numero_guia_operadora text,
  senha text,
  data_atendimento date NOT NULL,
  status status_guia NOT NULL DEFAULT 'rascunho',
  solicitante_id uuid,
  cid text,
  indicacao_clinica text,
  tipo_atendimento text NOT NULL DEFAULT '03',
  carater_atendimento text NOT NULL DEFAULT '1',
  regime_atendimento text NOT NULL DEFAULT '01',
  hora_inicio time,
  hora_fim time,
  PRIMARY KEY (id)
);

CREATE TABLE public.guia_itens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  guia_id uuid NOT NULL,
  procedimento_id uuid NOT NULL,
  sequencial integer NOT NULL DEFAULT 1,
  data_realizacao date NOT NULL,
  quantidade numeric(8,2) NOT NULL DEFAULT 1,
  valor_informado numeric(12,2) NOT NULL,
  valor_liberado numeric(12,2),
  valor_glosa numeric(12,2) NOT NULL DEFAULT 0,
  repasse_previsto numeric(12,2) NOT NULL DEFAULT 0,
  repasse_desconto numeric(12,2) NOT NULL DEFAULT 0,
  repasse_final numeric(12,2) GENERATED ALWAYS AS (repasse_previsto - repasse_desconto) STORED,
  atendimento_id uuid,
  PRIMARY KEY (id)
);

CREATE TABLE public.guia_anexos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  guia_id uuid NOT NULL,
  tipo text NOT NULL,
  arquivo text NOT NULL,
  arquivo_nome text,
  enviado_portal_em date,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  PRIMARY KEY (id)
);

CREATE TABLE public.lotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  contrato_id uuid NOT NULL,
  numero_lote text NOT NULL,
  competencia date NOT NULL,
  status status_lote NOT NULL DEFAULT 'aberto',
  protocolo text,
  data_envio date,
  arquivo_xml text,
  tipo_guia text NOT NULL DEFAULT 'SP_SADT',
  qtd_guias integer,
  valor_total numeric(14,2),
  hash_md5 text,
  gerado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  previsto_pagamento date,
  PRIMARY KEY (id)
);

CREATE TABLE public.retornos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  contrato_id uuid,
  formato formato_retorno NOT NULL,
  arquivo text NOT NULL,
  registro_ans text,
  codigo_prestador text,
  data_emissao date,
  total_informado numeric(14,2),
  total_liberado numeric(14,2),
  total_glosa numeric(14,2),
  soma_confere boolean,
  status status_retorno NOT NULL DEFAULT 'processando',
  enviado_por uuid,
  confirmado_por uuid,
  confirmado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.retorno_linhas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  retorno_id uuid NOT NULL,
  numero_lote text,
  protocolo text,
  numero_guia_prestador text,
  numero_guia_operadora text,
  carteirinha text,
  data_realizacao date,
  codigo_procedimento text,
  sequencial_item integer,
  valor_informado numeric(12,2),
  valor_liberado numeric(12,2),
  valor_glosa numeric(12,2),
  codigo_glosa text,
  classe classe_linha,
  guia_id uuid,
  guia_item_id uuid,
  confianca numeric(3,2),
  revisado boolean NOT NULL DEFAULT false,
  pagina_origem integer,
  PRIMARY KEY (id)
);

CREATE TABLE public.glosas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  guia_item_id uuid NOT NULL,
  retorno_linha_id uuid,
  codigo_glosa text,
  valor numeric(12,2) NOT NULL,
  status status_glosa NOT NULL DEFAULT 'pendente',
  prazo_recurso date,
  modo_desconto modo_desconto NOT NULL DEFAULT 'proporcional',
  desconto_manual numeric(12,2),
  orientacao text,
  confirmada_por uuid,
  confirmada_em timestamptz,
  PRIMARY KEY (id)
);

CREATE TABLE public.glosas_operadora (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  operadora_id uuid NOT NULL,
  codigo text NOT NULL,
  descricao text NOT NULL,
  codigo_ans text,
  PRIMARY KEY (id)
);

CREATE TABLE public.lancamentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  tipo text NOT NULL,
  descricao text NOT NULL,
  categoria_id uuid,
  conta_id uuid,
  area text,
  competencia date NOT NULL,
  vencimento date NOT NULL,
  valor_previsto numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'previsto',
  valor_realizado numeric(12,2),
  data_realizado date,
  forma_pagamento text,
  documento text,
  fornecedor text,
  contrato_id uuid,
  lote_id uuid,
  profissional_id uuid,
  serie_id uuid,
  parcela text,
  origem text NOT NULL DEFAULT 'manual',
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.categorias_financeiras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  tipo text NOT NULL,
  grupo_dre text NOT NULL,
  nome text NOT NULL,
  ordem integer NOT NULL DEFAULT 100,
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE public.contas_financeiras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'banco',
  banco text,
  agencia text,
  conta text,
  saldo_inicial numeric(12,2) NOT NULL DEFAULT 0,
  data_saldo_inicial date NOT NULL DEFAULT CURRENT_DATE,
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

CREATE TABLE public.recebimentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  atendimento_id uuid,
  paciente_id uuid NOT NULL,
  profissional_id uuid,
  procedimento_id uuid,
  descricao text,
  valor_tabela numeric(10,2),
  desconto numeric(10,2) NOT NULL DEFAULT 0,
  valor_pago numeric(10,2) NOT NULL,
  forma text NOT NULL,
  parcelas integer NOT NULL DEFAULT 1,
  pago_em date NOT NULL DEFAULT CURRENT_DATE,
  nf_numero text,
  nf_emitida_em date,
  observacao text,
  lancamento_id uuid,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (id)
);

CREATE TABLE public.notificacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  profissional_id uuid,
  tipo text NOT NULL,
  referencia uuid,
  mensagem text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.documento_modelos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  profissional_id uuid,
  tipo text NOT NULL,
  titulo text NOT NULL,
  corpo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.documentos_emitidos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  paciente_id uuid NOT NULL,
  profissional_id uuid,
  emitido_por uuid NOT NULL DEFAULT auth.uid(),
  atendimento_id uuid,
  tipo text NOT NULL,
  titulo text NOT NULL,
  corpo text NOT NULL,
  codigo text NOT NULL DEFAULT upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8)),
  emitido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.prontuario_registros (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL,
  paciente_id uuid NOT NULL,
  profissional_id uuid NOT NULL,
  atendimento_id uuid,
  area text NOT NULL,
  modelo text NOT NULL,
  data_registro date NOT NULL DEFAULT CURRENT_DATE,
  conteudo jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'rascunho',
  assinado_em timestamptz,
  hash_assinatura text,
  origem text NOT NULL DEFAULT 'cure_os',
  origem_arquivo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  editado_em timestamptz,
  PRIMARY KEY (id)
);

CREATE TABLE public.prontuario_adendos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL,
  clinica_id uuid NOT NULL,
  profissional_id uuid NOT NULL,
  texto text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.prontuario_anexos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL,
  clinica_id uuid NOT NULL,
  profissional_id uuid NOT NULL,
  arquivo text NOT NULL,
  nome text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE public.prontuario_versoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  registro_id uuid NOT NULL,
  clinica_id uuid NOT NULL,
  profissional_id uuid NOT NULL,
  data_registro date,
  conteudo jsonb,
  hash_assinatura text,
  assinado_em timestamptz,
  substituido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------
-- 4. Constraints: PK ja inline acima; FK, UNIQUE e CHECK abaixo.
-- ---------------------------------------------------------------------
ALTER TABLE public.atendimentos ADD CONSTRAINT atendimentos_autorizacao_id_fkey FOREIGN KEY (autorizacao_id) REFERENCES autorizacoes(id);
ALTER TABLE public.atendimentos ADD CONSTRAINT atendimentos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.atendimentos ADD CONSTRAINT atendimentos_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES pacientes(id);
ALTER TABLE public.atendimentos ADD CONSTRAINT atendimentos_paciente_plano_id_fkey FOREIGN KEY (paciente_plano_id) REFERENCES paciente_planos(id);
ALTER TABLE public.atendimentos ADD CONSTRAINT atendimentos_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.atendimentos ADD CONSTRAINT atendimento_status_ok CHECK ((status = ANY (ARRAY['agendado'::text, 'confirmado'::text, 'presente'::text, 'atendido'::text, 'faltou'::text, 'cancelado'::text])));
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_encaminhamento_id_fkey FOREIGN KEY (encaminhamento_id) REFERENCES encaminhamentos(id);
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_paciente_plano_id_fkey FOREIGN KEY (paciente_plano_id) REFERENCES paciente_planos(id);
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_procedimento_id_fkey FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id);
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES solicitantes(id);
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_area_check CHECK ((area = ANY (ARRAY['fisioterapia'::text, 'nutricao'::text, 'psicologia'::text, 'palmilha'::text, 'outra'::text])));
ALTER TABLE public.autorizacoes ADD CONSTRAINT autorizacoes_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'autorizada'::text, 'negada'::text, 'cancelada'::text])));
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_financeiras_clinica_id_nome_key UNIQUE (clinica_id, nome);
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_financeiras_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_financeiras_grupo_dre_check CHECK ((grupo_dre = ANY (ARRAY['receita_bruta'::text, 'deducoes'::text, 'custo_direto'::text, 'despesa_operacional'::text, 'resultado_financeiro'::text, 'investimento'::text, 'retirada'::text, 'transferencia'::text])));
ALTER TABLE public.categorias_financeiras ADD CONSTRAINT categorias_financeiras_tipo_check CHECK ((tipo = ANY (ARRAY['receita'::text, 'despesa'::text])));
ALTER TABLE public.cnpjs_faturamento ADD CONSTRAINT cnpjs_faturamento_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.contas_financeiras ADD CONSTRAINT contas_financeiras_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.contas_financeiras ADD CONSTRAINT contas_financeiras_tipo_check CHECK ((tipo = ANY (ARRAY['banco'::text, 'caixa'::text, 'cartao'::text, 'aplicacao'::text])));
ALTER TABLE public.contrato_tabela ADD CONSTRAINT contrato_tabela_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.contrato_tabela ADD CONSTRAINT contrato_tabela_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id) ON DELETE CASCADE;
ALTER TABLE public.contrato_tabela ADD CONSTRAINT contrato_tabela_procedimento_id_fkey FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id);
ALTER TABLE public.contratos ADD CONSTRAINT contratos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.contratos ADD CONSTRAINT contratos_cnpj_faturamento_id_fkey FOREIGN KEY (cnpj_faturamento_id) REFERENCES cnpjs_faturamento(id);
ALTER TABLE public.contratos ADD CONSTRAINT contratos_operadora_id_fkey FOREIGN KEY (operadora_id) REFERENCES operadoras(id);
ALTER TABLE public.convites ADD CONSTRAINT convites_clinica_id_email_key UNIQUE (clinica_id, email);
ALTER TABLE public.convites ADD CONSTRAINT convites_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.convites ADD CONSTRAINT convites_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.documento_modelos ADD CONSTRAINT documento_modelos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.documento_modelos ADD CONSTRAINT documento_modelos_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE CASCADE;
ALTER TABLE public.documentos_emitidos ADD CONSTRAINT documentos_emitidos_atendimento_id_fkey FOREIGN KEY (atendimento_id) REFERENCES atendimentos(id) ON DELETE SET NULL;
ALTER TABLE public.documentos_emitidos ADD CONSTRAINT documentos_emitidos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE RESTRICT;
ALTER TABLE public.documentos_emitidos ADD CONSTRAINT documentos_emitidos_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE RESTRICT;
ALTER TABLE public.documentos_emitidos ADD CONSTRAINT documentos_emitidos_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE RESTRICT;
ALTER TABLE public.documentos_emitidos ADD CONSTRAINT documentos_emitidos_tipo_check CHECK ((tipo = ANY (ARRAY['atestado'::text, 'comparecimento'::text, 'acompanhante'::text, 'alta'::text, 'relatorio'::text, 'orientacoes'::text, 'livre'::text])));
ALTER TABLE public.encaminhamentos ADD CONSTRAINT encaminhamentos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.encaminhamentos ADD CONSTRAINT encaminhamentos_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE;
ALTER TABLE public.encaminhamentos ADD CONSTRAINT encaminhamentos_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES solicitantes(id);
ALTER TABLE public.encaminhamentos ADD CONSTRAINT encaminhamentos_area_check CHECK ((area = ANY (ARRAY['fisioterapia'::text, 'nutricao'::text, 'psicologia'::text, 'palmilha'::text, 'outra'::text])));
ALTER TABLE public.encaminhamentos ADD CONSTRAINT encaminhamentos_qtd_sessoes_check CHECK (((qtd_sessoes IS NULL) OR (qtd_sessoes > 0)));
ALTER TABLE public.encaminhamentos ADD CONSTRAINT encaminhamentos_status_check CHECK ((status = ANY (ARRAY['ativo'::text, 'cancelado'::text])));
ALTER TABLE public.glosas ADD CONSTRAINT glosas_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.glosas ADD CONSTRAINT glosas_codigo_glosa_fkey FOREIGN KEY (codigo_glosa) REFERENCES motivos_glosa(codigo);
ALTER TABLE public.glosas ADD CONSTRAINT glosas_confirmada_por_fkey FOREIGN KEY (confirmada_por) REFERENCES auth.users(id);
ALTER TABLE public.glosas ADD CONSTRAINT glosas_guia_item_id_fkey FOREIGN KEY (guia_item_id) REFERENCES guia_itens(id);
ALTER TABLE public.glosas ADD CONSTRAINT glosas_retorno_linha_id_fkey FOREIGN KEY (retorno_linha_id) REFERENCES retorno_linhas(id);
ALTER TABLE public.glosas_operadora ADD CONSTRAINT glosas_operadora_operadora_id_codigo_key UNIQUE (operadora_id, codigo);
ALTER TABLE public.glosas_operadora ADD CONSTRAINT glosas_operadora_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.glosas_operadora ADD CONSTRAINT glosas_operadora_codigo_ans_fkey FOREIGN KEY (codigo_ans) REFERENCES motivos_glosa(codigo);
ALTER TABLE public.glosas_operadora ADD CONSTRAINT glosas_operadora_operadora_id_fkey FOREIGN KEY (operadora_id) REFERENCES operadoras(id) ON DELETE CASCADE;
ALTER TABLE public.guia_anexos ADD CONSTRAINT guia_anexos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.guia_anexos ADD CONSTRAINT guia_anexos_guia_id_fkey FOREIGN KEY (guia_id) REFERENCES guias(id) ON DELETE CASCADE;
ALTER TABLE public.guia_anexos ADD CONSTRAINT guia_anexos_tipo_check CHECK ((tipo = ANY (ARRAY['02'::text, '03'::text, '04'::text, '05'::text, '06'::text, '14'::text])));
ALTER TABLE public.guia_itens ADD CONSTRAINT guia_itens_atendimento_id_fkey FOREIGN KEY (atendimento_id) REFERENCES atendimentos(id);
ALTER TABLE public.guia_itens ADD CONSTRAINT guia_itens_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.guia_itens ADD CONSTRAINT guia_itens_guia_id_fkey FOREIGN KEY (guia_id) REFERENCES guias(id) ON DELETE CASCADE;
ALTER TABLE public.guia_itens ADD CONSTRAINT guia_itens_procedimento_id_fkey FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id);
ALTER TABLE public.guias ADD CONSTRAINT guias_contrato_id_numero_guia_prestador_key UNIQUE (contrato_id, numero_guia_prestador);
ALTER TABLE public.guias ADD CONSTRAINT guias_atendimento_id_fkey FOREIGN KEY (atendimento_id) REFERENCES atendimentos(id);
ALTER TABLE public.guias ADD CONSTRAINT guias_autorizacao_id_fkey FOREIGN KEY (autorizacao_id) REFERENCES autorizacoes(id);
ALTER TABLE public.guias ADD CONSTRAINT guias_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.guias ADD CONSTRAINT guias_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id);
ALTER TABLE public.guias ADD CONSTRAINT guias_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES lotes(id);
ALTER TABLE public.guias ADD CONSTRAINT guias_paciente_plano_id_fkey FOREIGN KEY (paciente_plano_id) REFERENCES paciente_planos(id);
ALTER TABLE public.guias ADD CONSTRAINT guias_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.guias ADD CONSTRAINT guias_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES solicitantes(id);
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES categorias_financeiras(id);
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_conta_id_fkey FOREIGN KEY (conta_id) REFERENCES contas_financeiras(id);
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id);
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES lotes(id);
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_area_check CHECK ((area = ANY (ARRAY['fisioterapia'::text, 'nutricao'::text, 'psicologia'::text, 'palmilha'::text, 'geral'::text])));
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_check CHECK (((status <> 'pago'::text) OR ((valor_realizado IS NOT NULL) AND (data_realizado IS NOT NULL))));
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_origem_check CHECK ((origem = ANY (ARRAY['manual'::text, 'repasse'::text, 'lote'::text, 'extrato'::text, 'particular'::text])));
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_status_check CHECK ((status = ANY (ARRAY['previsto'::text, 'pago'::text, 'cancelado'::text])));
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_tipo_check CHECK ((tipo = ANY (ARRAY['receber'::text, 'pagar'::text])));
ALTER TABLE public.lancamentos ADD CONSTRAINT lancamentos_valor_previsto_check CHECK ((valor_previsto >= (0)::numeric));
ALTER TABLE public.lotes ADD CONSTRAINT lotes_contrato_id_numero_lote_key UNIQUE (contrato_id, numero_lote);
ALTER TABLE public.lotes ADD CONSTRAINT lotes_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.lotes ADD CONSTRAINT lotes_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id);
ALTER TABLE public.notificacoes ADD CONSTRAINT notificacoes_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.notificacoes ADD CONSTRAINT notificacoes_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.operadoras ADD CONSTRAINT operadoras_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.paciente_planos ADD CONSTRAINT paciente_planos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.paciente_planos ADD CONSTRAINT paciente_planos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id);
ALTER TABLE public.paciente_planos ADD CONSTRAINT paciente_planos_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE;
ALTER TABLE public.pacientes ADD CONSTRAINT pacientes_clinica_id_cpf_key UNIQUE (clinica_id, cpf);
ALTER TABLE public.pacientes ADD CONSTRAINT pacientes_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.procedimentos ADD CONSTRAINT procedimentos_codigo_tabela_codigo_key UNIQUE (codigo_tabela, codigo);
ALTER TABLE public.profissionais ADD CONSTRAINT profissionais_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.prontuario_adendos ADD CONSTRAINT prontuario_adendos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_adendos ADD CONSTRAINT prontuario_adendos_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_adendos ADD CONSTRAINT prontuario_adendos_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES prontuario_registros(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_adendos ADD CONSTRAINT prontuario_adendos_texto_check CHECK ((length(TRIM(BOTH FROM texto)) > 0));
ALTER TABLE public.prontuario_anexos ADD CONSTRAINT prontuario_anexos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_anexos ADD CONSTRAINT prontuario_anexos_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_anexos ADD CONSTRAINT prontuario_anexos_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES prontuario_registros(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_atendimento_id_fkey FOREIGN KEY (atendimento_id) REFERENCES atendimentos(id) ON DELETE SET NULL;
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_area_check CHECK ((area = ANY (ARRAY['nutricao'::text, 'fisioterapia'::text, 'psicologia'::text, 'outra'::text])));
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_modelo_check CHECK ((modelo = ANY (ARRAY['soapn'::text, 'fisio_avaliacao'::text, 'fisio_evolucao'::text, 'psico_registro'::text, 'livre'::text])));
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_origem_check CHECK ((origem = ANY (ARRAY['cure_os'::text, 'sistema_antigo'::text])));
ALTER TABLE public.prontuario_registros ADD CONSTRAINT prontuario_registros_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'assinado'::text])));
ALTER TABLE public.prontuario_versoes ADD CONSTRAINT prontuario_versoes_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_versoes ADD CONSTRAINT prontuario_versoes_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE RESTRICT;
ALTER TABLE public.prontuario_versoes ADD CONSTRAINT prontuario_versoes_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES prontuario_registros(id) ON DELETE RESTRICT;
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_atendimento_id_fkey FOREIGN KEY (atendimento_id) REFERENCES atendimentos(id) ON DELETE SET NULL;
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_lancamento_id_fkey FOREIGN KEY (lancamento_id) REFERENCES lancamentos(id) ON DELETE SET NULL;
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_paciente_id_fkey FOREIGN KEY (paciente_id) REFERENCES pacientes(id);
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_procedimento_id_fkey FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id);
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_desconto_check CHECK ((desconto >= (0)::numeric));
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_forma_check CHECK ((forma = ANY (ARRAY['pix'::text, 'dinheiro'::text, 'debito'::text, 'credito'::text, 'credito_parcelado'::text, 'transferencia'::text, 'outro'::text])));
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_parcelas_check CHECK (((parcelas >= 1) AND (parcelas <= 24)));
ALTER TABLE public.recebimentos ADD CONSTRAINT recebimentos_valor_pago_check CHECK ((valor_pago >= (0)::numeric));
ALTER TABLE public.regras_repasse ADD CONSTRAINT regras_repasse_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.regras_repasse ADD CONSTRAINT regras_repasse_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id);
ALTER TABLE public.regras_repasse ADD CONSTRAINT regras_repasse_procedimento_id_fkey FOREIGN KEY (procedimento_id) REFERENCES procedimentos(id);
ALTER TABLE public.regras_repasse ADD CONSTRAINT regras_repasse_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id) ON DELETE CASCADE;
ALTER TABLE public.retorno_linhas ADD CONSTRAINT retorno_linhas_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.retorno_linhas ADD CONSTRAINT retorno_linhas_guia_id_fkey FOREIGN KEY (guia_id) REFERENCES guias(id);
ALTER TABLE public.retorno_linhas ADD CONSTRAINT retorno_linhas_guia_item_id_fkey FOREIGN KEY (guia_item_id) REFERENCES guia_itens(id);
ALTER TABLE public.retorno_linhas ADD CONSTRAINT retorno_linhas_retorno_id_fkey FOREIGN KEY (retorno_id) REFERENCES retornos(id) ON DELETE CASCADE;
ALTER TABLE public.retornos ADD CONSTRAINT retornos_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.retornos ADD CONSTRAINT retornos_confirmado_por_fkey FOREIGN KEY (confirmado_por) REFERENCES auth.users(id);
ALTER TABLE public.retornos ADD CONSTRAINT retornos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES contratos(id);
ALTER TABLE public.retornos ADD CONSTRAINT retornos_enviado_por_fkey FOREIGN KEY (enviado_por) REFERENCES auth.users(id);
ALTER TABLE public.solicitantes ADD CONSTRAINT solicitantes_clinica_id_conselho_numero_conselho_uf_conselh_key UNIQUE (clinica_id, conselho, numero_conselho, uf_conselho);
ALTER TABLE public.solicitantes ADD CONSTRAINT solicitantes_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.usuarios_clinica ADD CONSTRAINT usuarios_clinica_clinica_id_fkey FOREIGN KEY (clinica_id) REFERENCES clinicas(id) ON DELETE CASCADE;
ALTER TABLE public.usuarios_clinica ADD CONSTRAINT usuarios_clinica_profissional_id_fkey FOREIGN KEY (profissional_id) REFERENCES profissionais(id);
ALTER TABLE public.usuarios_clinica ADD CONSTRAINT usuarios_clinica_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 5. Indices (os que sustentam UNIQUE/PK ja vieram das constraints)
-- ---------------------------------------------------------------------
CREATE INDEX atendimentos_clinica_inicio ON public.atendimentos USING btree (clinica_id, inicio);
CREATE INDEX atendimentos_profissional_id_inicio_idx ON public.atendimentos USING btree (profissional_id, inicio);
CREATE INDEX atendimentos_sala_inicio ON public.atendimentos USING btree (clinica_id, sala, inicio) WHERE (sala IS NOT NULL);
CREATE INDEX atendimentos_serie ON public.atendimentos USING btree (serie_id) WHERE (serie_id IS NOT NULL);
CREATE UNIQUE INDEX profissionais_agenda_token ON public.profissionais USING btree (agenda_token);
CREATE INDEX documentos_emitidos_pac ON public.documentos_emitidos USING btree (paciente_id, emitido_em DESC);
CREATE UNIQUE INDEX documentos_emitidos_codigo ON public.documentos_emitidos USING btree (codigo);
CREATE INDEX encaminhamentos_paciente ON public.encaminhamentos USING btree (paciente_id, area);
CREATE INDEX glosas_guia_item_id_idx ON public.glosas USING btree (guia_item_id);
CREATE INDEX guia_anexos_guia ON public.guia_anexos USING btree (guia_id);
CREATE INDEX guia_itens_atendimento ON public.guia_itens USING btree (atendimento_id);
CREATE INDEX guia_itens_guia_id_idx ON public.guia_itens USING btree (guia_id);
CREATE INDEX guias_lote_id_idx ON public.guias USING btree (lote_id);
CREATE INDEX guias_profissional_id_idx ON public.guias USING btree (profissional_id);
CREATE INDEX lanc_clinica_comp ON public.lancamentos USING btree (clinica_id, competencia);
CREATE INDEX lanc_clinica_venc ON public.lancamentos USING btree (clinica_id, vencimento);
CREATE UNIQUE INDEX lanc_repasse_unico ON public.lancamentos USING btree (clinica_id, profissional_id, competencia) WHERE ((origem = 'repasse'::text) AND (status <> 'cancelado'::text));
CREATE INDEX pacientes_nome_idx ON public.pacientes USING btree (clinica_id, lower(nome));
CREATE UNIQUE INDEX pacientes_origem_unq ON public.pacientes USING btree (clinica_id, origem, origem_id);
CREATE INDEX prontuario_reg_pac ON public.prontuario_registros USING btree (paciente_id, profissional_id, data_registro DESC);
CREATE UNIQUE INDEX prontuario_reg_arquivo ON public.prontuario_registros USING btree (clinica_id, profissional_id, origem_arquivo) WHERE (origem_arquivo IS NOT NULL);
CREATE INDEX recebimentos_atendimento ON public.recebimentos USING btree (atendimento_id);
CREATE INDEX recebimentos_nf_pendente ON public.recebimentos USING btree (clinica_id) WHERE (nf_numero IS NULL);
CREATE INDEX recebimentos_paciente ON public.recebimentos USING btree (paciente_id);
CREATE INDEX retorno_linhas_numero_lote_numero_guia_prestador_idx ON public.retorno_linhas USING btree (numero_lote, numero_guia_prestador);
CREATE INDEX retorno_linhas_retorno_id_idx ON public.retorno_linhas USING btree (retorno_id);

-- FIM DA SECAO 1-5 (tabelas, constraints, indices). Funcoes na secao 6.

-- ---------------------------------------------------------------------
-- 6. Funcoes (pg_get_functiondef, producao 2026-11-10; 45 funcoes).
--    check_function_bodies desligado: funcoes SQL referenciam outras
--    funcoes criadas depois (mesmo procedimento do pg_dump).
-- ---------------------------------------------------------------------
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.aceitar_convites()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into usuarios_clinica (user_id, clinica_id, perfil, profissional_id)
  select new.id, c.clinica_id, c.perfil, c.profissional_id
  from convites c where lower(c.email) = lower(new.email) and c.usado_em is null
  on conflict (user_id, clinica_id) do nothing;
  update convites set usado_em = now() where lower(email) = lower(new.email) and usado_em is null;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.agenda_ics_dados(p_token uuid)
 RETURNS TABLE(id uuid, inicio timestamp with time zone, fim timestamp with time zone, iniciais text, servico text, sala text, status text, profissional text, clinica text, atualizado_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id, a.inicio, a.fim,
    (select string_agg(left(w,1), '.') || '.' from unnest(regexp_split_to_array(trim(regexp_replace(pa.nome, '\(.*\)', '')), '\s+')) w where length(w) > 2),
    a.servico, a.sala, a.status, pr.nome, c.nome, a.atualizado_em
  from profissionais pr
  join atendimentos a on a.profissional_id = pr.id
  join pacientes pa on pa.id = a.paciente_id
  join clinicas c on c.id = pr.clinica_id
  where pr.agenda_token = p_token and pr.ativo
    and a.inicio between now() - interval '14 days' and now() + interval '90 days'
    and a.status <> 'cancelado';
$function$;

CREATE OR REPLACE FUNCTION public.anexos_lote(p_lote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cli uuid;
begin
  select clinica_id into v_cli from lotes where id = p_lote;
  if coalesce(meu_perfil(v_cli)::text, '') not in ('gestor','financeiro','recepcao') then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'guia_id', g.id, 'numero', g.numero_guia_prestador, 'paciente', pa.nome,
    'primeira', (select min(i.data_realizacao) from guia_itens i where i.guia_id = g.id),
    'encaminhamento', (select jsonb_build_object('id', en.id, 'area', en.area, 'validade', en.validade, 'arquivo', en.arquivo,
        'arquivo_nome', en.arquivo_nome, 'data_pedido', en.data_pedido) from encaminhamentos en where en.id = au.encaminhamento_id),
    'anexos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'arquivo', x.arquivo, 'arquivo_nome', x.arquivo_nome,
        'enviado', x.enviado_portal_em) order by x.criado_em) from guia_anexos x where x.guia_id = g.id), '[]'))
    order by g.numero_guia_prestador)
    from guias g join paciente_planos pl on pl.id = g.paciente_plano_id join pacientes pa on pa.id = pl.paciente_id
    left join autorizacoes au on au.id = g.autorizacao_id
    where g.lote_id = p_lote), '[]');
end $function$;

CREATE OR REPLACE FUNCTION public.arquivo_paciente_do_prof(p_nome text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$' and split_part(p_nome, '/', 2) = 'pacientes'
              and split_part(p_nome, '/', 3) ~ '^[0-9a-f-]{36}$'
    then meu_perfil(split_part(p_nome, '/', 1)::uuid) = 'profissional'
      and exists (select 1 from atendimentos a where a.paciente_id = split_part(p_nome, '/', 3)::uuid
                  and a.profissional_id = meu_profissional(split_part(p_nome, '/', 1)::uuid))
    else false end;
$function$;

CREATE OR REPLACE FUNCTION public.autorizacoes_paciente(p_paciente uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cli uuid;
begin
  select clinica_id into v_cli from pacientes where id = p_paciente;
  if meu_perfil(v_cli) is null then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', pl.id, 'contrato', c.nome, 'carteirinha', pl.carteirinha, 'validade', pl.validade, 'principal', pl.principal,
    'exige', contrato_exige_senha(c.id), 'senha_por_sessao', coalesce((c.regras->>'senha_por_sessao')::boolean, false),
    'procedimentos', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'codigo', p.codigo, 'descricao', p.descricao))
       from contrato_tabela t join procedimentos p on p.id = t.procedimento_id
       where t.contrato_id = c.id and (t.vigencia_fim is null or t.vigencia_fim >= current_date)), '[]'),
    'autorizacoes', coalesce((select jsonb_agg(jsonb_build_object('id', au.id, 'status', au.status, 'senha', au.senha, 'procedimento_id', au.procedimento_id, 'encaminhamento_id', au.encaminhamento_id, 'solicitante_id', au.solicitante_id, 'area', au.area,
         'codigo', p.codigo, 'qtd', au.qtd_autorizada, 'data', au.data_autorizacao, 'validade', au.validade,
         'usadas', (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status = 'atendido'),
         'agendadas', (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente')))
       order by au.solicitada_em desc)
       from autorizacoes au join procedimentos p on p.id = au.procedimento_id
       where au.paciente_plano_id = pl.id and au.status in ('pendente','autorizada')), '[]')
  ) order by pl.principal desc)
  from paciente_planos pl join contratos c on c.id = pl.contrato_id where pl.paciente_id = p_paciente), '[]');
end $function$;

CREATE OR REPLACE FUNCTION public.autorizacoes_pendentes(p_clinica uuid)
 RETURNS TABLE(autorizacao_id uuid, paciente text, carteirinha text, contrato text, procedimento text, qtd_solicitada integer, agendados bigint, atendidos bigint, primeira_data date, profissionais text, dias integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select au.id, pa.nome, pl.carteirinha, c.nome, p.codigo || ' · ' || p.descricao, coalesce(au.qtd_solicitada, au.qtd_autorizada),
    (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente')),
    (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status = 'atendido'),
    (select min((x.inicio at time zone 'America/Sao_Paulo')::date) from atendimentos x where x.autorizacao_id = au.id and x.status <> 'cancelado'),
    (select string_agg(distinct pr.nome, ', ') from atendimentos x join profissionais pr on pr.id = x.profissional_id where x.autorizacao_id = au.id),
    (current_date - au.solicitada_em::date)
  from autorizacoes au
  join paciente_planos pl on pl.id = au.paciente_plano_id join pacientes pa on pa.id = pl.paciente_id
  join contratos c on c.id = pl.contrato_id join procedimentos p on p.id = au.procedimento_id
  where au.clinica_id = p_clinica and au.status = 'pendente'
    and meu_perfil(p_clinica) is not null
    and (meu_perfil(p_clinica) <> 'profissional'
         or au.profissional_id = meu_profissional(p_clinica)
         or exists (select 1 from atendimentos x where x.autorizacao_id = au.id and x.profissional_id = meu_profissional(p_clinica)))
  order by 9 nulls last, au.solicitada_em;
$function$;

CREATE OR REPLACE FUNCTION public.calcular_desconto_repasse(p_item uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(
    case g.modo_desconto
      when 'manual'       then coalesce(g.desconto_manual,0)
      when 'sem_desconto' then 0
      else round(i.repasse_previsto * g.valor / nullif(i.valor_informado,0), 2)
    end),0)
  from guia_itens i join glosas g on g.guia_item_id = i.id
  where i.id = p_item and g.status in ('pendente','definitiva','aceita','em_recurso')
    and g.confirmada_em is not null;
$function$;

CREATE OR REPLACE FUNCTION public.calcular_repasse(p_prof uuid, p_contrato uuid, p_proc uuid, p_data date, p_valor numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case r.tipo when 'fixo' then r.valor else round(p_valor * r.valor / 100, 2) end
  from regras_repasse r
  where r.profissional_id = p_prof
    and (r.contrato_id = p_contrato or r.contrato_id is null)
    and (r.procedimento_id = p_proc or r.procedimento_id is null)
    and r.vigencia_inicio <= p_data and (r.vigencia_fim is null or r.vigencia_fim >= p_data)
  order by (r.contrato_id is not null and r.procedimento_id is not null) desc,
           (r.contrato_id is not null) desc, (r.procedimento_id is not null) desc, r.vigencia_inicio desc
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.cancelar_guia(p_guia uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g guias;
begin
  select * into g from guias where id = p_guia;
  if meu_perfil(g.clinica_id) not in ('gestor','financeiro') then raise exception 'Só a gestão cancela guias'; end if;
  if g.status not in ('rascunho','pronta') then raise exception 'Guia já enviada: não pode ser cancelada aqui'; end if;
  update guias set status = 'cancelada' where id = p_guia;
end $function$;

CREATE OR REPLACE FUNCTION public.contrato_exige_senha(p_contrato uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select not coalesce((c.regras->>'sem_tiss')::boolean, false)
     and coalesce((c.regras->>'exige_autorizacao')::boolean, true)
     and exists (select 1 from contrato_tabela t where t.contrato_id = c.id and t.tipo_guia <> 'PARTICULAR')
  from contratos c where c.id = p_contrato;
$function$;

CREATE OR REPLACE FUNCTION public.criar_lote(p_contrato uuid, p_competencia date, p_guias uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cli uuid; v_lote uuid; v_tipo text; v_num text; v_seq int; r record;
begin
  select clinica_id into v_cli from contratos where id = p_contrato;
  if coalesce(meu_perfil(v_cli)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if coalesce(array_length(p_guias, 1), 0) = 0 then raise exception 'Escolha ao menos uma guia.'; end if;
  if array_length(p_guias, 1) > 100 then raise exception 'O padrão TISS aceita no máximo 100 guias por lote.'; end if;
  for r in select g.*, situacao_guia_lote(g.id)->>'motivo' motivo from guias g where g.id = any(p_guias) loop
    if r.contrato_id <> p_contrato then raise exception 'A guia % é de outro contrato.', r.numero_guia_prestador; end if;
    if r.lote_id is not null or r.status not in ('rascunho','pronta') then
      raise exception 'A guia % já está em lote ou não está aberta.', r.numero_guia_prestador; end if;
    if r.motivo not in ('cheia','senha_vencida','sem_exigencia','prazo_entrega') then
      raise exception 'A guia % ainda não pode ir ao lote (%): só guia cheia ou com senha vencida.', r.numero_guia_prestador,
        case r.motivo when 'sem_senha' then 'sem senha' else 'sessões em aberto' end; end if;
    if v_tipo is null then v_tipo := r.tipo;
    elsif v_tipo <> r.tipo then raise exception 'Um lote só pode ter um tipo de guia (SP/SADT ou honorários).'; end if;
  end loop;
  if (select count(*) from guias where id = any(p_guias)) <> array_length(p_guias, 1) then raise exception 'Guia não encontrada.'; end if;
  select coalesce(max(substr(numero_lote, 6)::int), 0) + 1 into v_seq from lotes
   where contrato_id = p_contrato and numero_lote ~ ('^9' || to_char(p_competencia, 'YYMM') || '[0-9]{3}$');
  v_num := '9' || to_char(p_competencia, 'YYMM') || lpad(v_seq::text, 3, '0');
  insert into lotes (clinica_id, contrato_id, numero_lote, competencia, status, tipo_guia, qtd_guias, valor_total)
  values (v_cli, p_contrato, v_num, date_trunc('month', p_competencia)::date, 'fechado', v_tipo, array_length(p_guias, 1),
          (select coalesce(sum(valor_informado), 0) from guia_itens where guia_id = any(p_guias)))
  returning id into v_lote;
  update guias set lote_id = v_lote, status = 'pronta' where id = any(p_guias);
  return v_lote;
end $function$;

CREATE OR REPLACE FUNCTION public.dados_guia_impressa(p_guia uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.dados_xml_lote(p_lote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l lotes; v jsonb;
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'lote', jsonb_build_object('id', l.id, 'numero', l.numero_lote, 'tipo', l.tipo_guia, 'status', l.status, 'competencia', l.competencia),
    'contrato', jsonb_build_object('nome', c.nome, 'versao', coalesce(c.versao_tiss, '4.03.00'),
       'codigo_prestador', c.codigo_prestador_operadora, 'registro_ans', o.registro_ans, 'operadora', o.nome,
       'cnpj', f.cnpj, 'cnes', f.cnes, 'razao_social', f.razao_social),
    'guias', coalesce((select jsonb_agg(jsonb_build_object(
       'numero', g.numero_guia_prestador, 'numero_operadora', coalesce(g.numero_guia_operadora, au.numero_guia_operadora),
       'senha', coalesce(g.senha, au.senha), 'data_autorizacao', au.data_autorizacao, 'validade_senha', au.validade,
       'carteirinha', pl.carteirinha, 'indicacao_clinica', coalesce(g.indicacao_clinica, au.indicacao_clinica),
       'tipo_atendimento', coalesce(g.tipo_atendimento, '03'), 'carater', coalesce(g.carater_atendimento, '1'),
       'regime', coalesce(g.regime_atendimento, '01'),
       'solicitante', (select jsonb_build_object('nome', s.nome, 'conselho', s.conselho, 'numero', s.numero_conselho,
                         'uf', s.uf_conselho, 'cbo', s.cbo) from solicitantes s where s.id = coalesce(g.solicitante_id, au.solicitante_id)),
       'itens', (select jsonb_agg(jsonb_build_object(
           'data', i.data_realizacao, 'quantidade', i.quantidade, 'valor', i.valor_informado,
           'tabela', p.codigo_tabela, 'codigo', p.codigo, 'descricao', p.descricao,
           'hora_inicio', to_char(at.inicio at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
           'hora_fim', to_char(at.fim at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
           'profissional', (select jsonb_build_object('nome', pr.nome, 'cpf', pr.cpf, 'conselho', pr.conselho,
               'numero', pr.numero_conselho, 'uf', pr.uf_conselho, 'cbo', pr.cbo)
             from profissionais pr where pr.id = coalesce(at.profissional_id, g.profissional_id)))
           order by i.data_realizacao, i.sequencial)
         from guia_itens i join procedimentos p on p.id = i.procedimento_id
         left join atendimentos at on at.id = i.atendimento_id
         where i.guia_id = g.id)) order by g.numero_guia_prestador)
       from guias g join paciente_planos pl on pl.id = g.paciente_plano_id
       left join autorizacoes au on au.id = g.autorizacao_id
       where g.lote_id = l.id), '[]'))
  into v
  from contratos c join operadoras o on o.id = c.operadora_id
  left join cnpjs_faturamento f on f.id = c.cnpj_faturamento_id
  where c.id = l.contrato_id;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.desfazer_lote(p_lote uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l lotes;
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if l.status <> 'fechado' then raise exception 'Lote já enviado não pode ser desfeito.'; end if;
  update guias set lote_id = null where lote_id = p_lote;
  delete from lotes where id = p_lote;
end $function$;

CREATE OR REPLACE FUNCTION public.editar_procedimento_particular(p_clinica uuid, p_proc uuid, p_nome text, p_valor numeric, p_remover boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_t contrato_tabela; v_cod text;
begin
  if meu_perfil(p_clinica) is null then raise exception 'Sem permissão'; end if;
  select t.* into v_t from contrato_tabela t join contratos c on c.id = t.contrato_id
    where c.clinica_id = p_clinica and t.procedimento_id = p_proc and t.tipo_guia = 'PARTICULAR' and t.vigencia_fim is null limit 1;
  if v_t.id is null then raise exception 'Procedimento não está na tabela particular.'; end if;
  if p_remover then
    update contrato_tabela set vigencia_fim = current_date - 1 where id = v_t.id;
    return jsonb_build_object('removido', true);
  end if;
  select codigo into v_cod from procedimentos where id = p_proc;
  if p_nome is not null and btrim(p_nome) <> '' and v_cod like 'CURE-%' then
    update procedimentos set descricao = btrim(p_nome) where id = p_proc;
  end if;
  if p_valor is not null and round(p_valor, 2) <> v_t.valor then
    if v_t.vigencia_inicio >= current_date then
      update contrato_tabela set valor = round(p_valor, 2) where id = v_t.id;
    else
      update contrato_tabela set vigencia_fim = current_date - 1 where id = v_t.id;
      insert into contrato_tabela (clinica_id, contrato_id, procedimento_id, valor, vigencia_inicio, tipo_guia)
        values (v_t.clinica_id, v_t.contrato_id, p_proc, round(p_valor, 2), current_date, 'PARTICULAR');
    end if;
  end if;
  return jsonb_build_object('id', p_proc, 'descricao', (select descricao from procedimentos where id = p_proc), 'valor', round(coalesce(p_valor, v_t.valor), 2));
end $function$;

CREATE OR REPLACE FUNCTION public.estatisticas(p_clinica uuid, p_ano integer, p_prof uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  ultimo as (
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
end $function$;

CREATE OR REPLACE FUNCTION public.exigir_convite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from convites c where lower(c.email) = lower(new.email) and c.usado_em is null) then
    raise exception 'CONVITE_OBRIGATORIO: este e-mail não tem convite da clínica.';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.gerar_repasse_mes(p_clinica uuid, p_competencia date, p_vencimento date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.guia_atendimento(p_atendimento uuid, p_plano uuid, p_autorizacao uuid, p_itens jsonb, p_gravar boolean DEFAULT false, p_dados jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; a atendimentos; pl paciente_planos; c contratos; au autorizacoes; v_aut uuid := p_autorizacao;
  v_exige boolean; v_data date; v_tipo text; v_guia uuid; v_num bigint; v_seq int; it jsonb; v_tab contrato_tabela;
  v_guias jsonb := '[]'; v_bloq jsonb; v_avis jsonb; v_sol uuid; v_cid text; v_ind text; v_tipo_at text; v_novo boolean;
begin
  select * into a from atendimentos where id = p_atendimento;
  if a.id is null then raise exception 'Atendimento não encontrado'; end if;
  select * into pl from paciente_planos where id = p_plano and paciente_id = a.paciente_id;
  if pl.id is null then raise exception 'Convênio do paciente não encontrado'; end if;
  select * into c from contratos where id = pl.contrato_id;
  v_exige := coalesce(contrato_exige_senha(c.id), false);
  if v_aut is null and a.autorizacao_id is not null
     and exists (select 1 from autorizacoes where id = a.autorizacao_id and paciente_plano_id = pl.id) then
    v_aut := a.autorizacao_id;
  end if;
  select * into au from autorizacoes where id = v_aut;

  r := guia_atendimento_base(p_atendimento, p_plano, v_aut, p_itens, false, p_dados);
  v_bloq := coalesce(r->'bloqueios', '[]'); v_avis := coalesce(r->'avisos', '[]');
  if exists (select 1 from guia_itens i join guias g on g.id = i.guia_id where i.atendimento_id = a.id and g.status <> 'cancelada') then
    v_bloq := v_bloq || to_jsonb('Este atendimento já está em uma guia.'::text);
  end if;
  if au.status in ('negada','cancelada') then
    v_bloq := v_bloq || to_jsonb(('Autorização ' || au.status || ': escolha outra ou atenda como particular.')::text);
  elsif v_exige and (au.id is null or au.status = 'pendente' or nullif(trim(au.senha), '') is null) then
    v_avis := v_avis || to_jsonb((case when au.id is null
      then 'Sem autorização: será criada uma solicitação PENDENTE (tarefa "Autorizar guia"). A guia não entra no lote sem senha.'
      else 'Autorização ainda PENDENTE (sem senha): a guia não entra no lote até a senha ser informada.' end)::text);
  end if;
  if v_exige and au.id is not null and au.encaminhamento_id is null then
    v_avis := v_avis || to_jsonb('Autorização sem encaminhamento vinculado: o pedido médico é anexo obrigatório no faturamento (ficha do paciente → Autorizações).'::text);
  end if;
  r := r || jsonb_build_object('bloqueios', v_bloq, 'avisos', v_avis, 'autorizacao_id', v_aut,
    'sem_senha', v_exige and (au.id is null or nullif(trim(au.senha), '') is null));
  if not p_gravar or jsonb_array_length(v_bloq) > 0 then return r; end if;

  v_data := (a.inicio at time zone 'America/Sao_Paulo')::date;
  v_sol := coalesce(nullif(p_dados->>'solicitante_id', '')::uuid, au.solicitante_id);
  v_cid := upper(nullif(trim(coalesce(p_dados->>'cid', au.cid, '')), ''));
  v_ind := nullif(trim(coalesce(p_dados->>'indicacao_clinica', au.indicacao_clinica, '')), '');
  v_tipo_at := coalesce(nullif(p_dados->>'tipo_atendimento', ''), '03');

  if v_exige and au.id is null then
    insert into autorizacoes (clinica_id, paciente_plano_id, profissional_id, procedimento_id, qtd_autorizada, qtd_solicitada,
      status, solicitante_id, cid, indicacao_clinica, observacao)
    values (a.clinica_id, pl.id, a.profissional_id, (r->'itens'->0->>'procedimento_id')::uuid, 1, 1,
      'pendente', v_sol, v_cid, v_ind, 'Criada no fechamento do atendimento sem autorização')
    returning * into au;
    v_aut := au.id;
  end if;

  update atendimentos set status = 'atendido', paciente_plano_id = pl.id, autorizacao_id = v_aut, atualizado_em = now() where id = a.id;

  if not coalesce((c.regras->>'sem_tiss')::boolean, false) then
    perform pg_advisory_xact_lock(hashtext(c.id::text));
    for v_tipo in select distinct x->>'tipo_guia' from jsonb_array_elements(r->'itens') x loop
      v_guia := null; v_novo := false;
      if v_aut is not null and not coalesce((c.regras->>'guia_por_sessao')::boolean, false) then
        select g.id into v_guia from guias g
        where g.autorizacao_id = v_aut and g.tipo = v_tipo
          and g.status in ('rascunho','pronta') and g.lote_id is null
        order by g.data_atendimento limit 1;
      end if;
      if v_guia is null then
        v_novo := true;
        select coalesce(max(numero_guia_prestador::bigint), 0) + 1 into v_num
          from guias where contrato_id = c.id and numero_guia_prestador ~ '^\d+$';
        insert into guias (clinica_id, contrato_id, paciente_plano_id, profissional_id, autorizacao_id, atendimento_id,
                           tipo, numero_guia_prestador, numero_guia_operadora, senha, data_atendimento, status,
                           solicitante_id, cid, indicacao_clinica, tipo_atendimento, carater_atendimento, regime_atendimento, hora_inicio, hora_fim)
        values (a.clinica_id, c.id, pl.id, a.profissional_id, v_aut, a.id, v_tipo, v_num::text,
                au.numero_guia_operadora, au.senha, v_data, 'pronta', v_sol, v_cid, v_ind, v_tipo_at, '1', '01',
                (a.inicio at time zone 'America/Sao_Paulo')::time, (a.fim at time zone 'America/Sao_Paulo')::time)
        returning id into v_guia;
      end if;
      select coalesce(max(sequencial), 0) into v_seq from guia_itens where guia_id = v_guia;
      for it in select x from jsonb_array_elements(r->'itens') x where x->>'tipo_guia' = v_tipo loop
        v_seq := v_seq + 1;
        select * into v_tab from contrato_tabela t where t.contrato_id = c.id and t.procedimento_id = (it->>'procedimento_id')::uuid
          and t.vigencia_inicio <= v_data and (t.vigencia_fim is null or t.vigencia_fim >= v_data)
          order by t.vigencia_inicio desc limit 1;
        insert into guia_itens (clinica_id, guia_id, procedimento_id, sequencial, data_realizacao, quantidade, valor_informado,
                                repasse_previsto, atendimento_id)
        values (a.clinica_id, v_guia, (it->>'procedimento_id')::uuid, v_seq, v_data, (it->>'quantidade')::numeric,
                v_tab.valor * (it->>'quantidade')::numeric, (it->>'repasse')::numeric, a.id);
      end loop;
      v_guias := v_guias || jsonb_build_object('id', v_guia,
        'numero', (select numero_guia_prestador from guias where id = v_guia), 'tipo', v_tipo, 'nova', v_novo);
    end loop;
  end if;
  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
    values (a.clinica_id, auth.uid(), 'guias', a.id, 'guia_atendimento', jsonb_build_object('guias', v_guias, 'autorizacao', v_aut, 'avisos', v_avis));
  return r || jsonb_build_object('guias', v_guias, 'gravado', true, 'autorizacao_id', v_aut);
end $function$;

CREATE OR REPLACE FUNCTION public.guia_atendimento_base(p_atendimento uuid, p_plano uuid, p_autorizacao uuid, p_itens jsonb, p_gravar boolean DEFAULT false, p_dados jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if pl.validade is not null and pl.validade < v_data then
    v_bloq := v_bloq || ('Carteirinha vencida em ' || to_char(pl.validade, 'DD/MM/YYYY') || '.');
  end if;
  if nullif(trim(pl.carteirinha), '') is null then v_bloq := v_bloq || 'Paciente sem número de carteirinha.'::text; end if;
  if pa.data_nascimento is null then v_avis := v_avis || 'Paciente sem data de nascimento.'::text; end if;
  if nullif(pa.cpf, '') is null then v_avis := v_avis || 'Paciente sem CPF.'::text; end if;
  if pr.conselho is null or pr.numero_conselho is null or pr.uf_conselho is null or pr.cbo is null then
    v_avis := v_avis || ('Cadastro de ' || pr.nome || ' sem conselho/número/UF/CBO: o XML TISS vai exigir.');
  end if;

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
    if exists (select 1 from guia_itens i join guias g on g.id = i.guia_id join paciente_planos pp on pp.id = g.paciente_plano_id
               where i.procedimento_id = v_proc.id and i.data_realizacao = v_data and g.status <> 'cancelada'
                 and g.contrato_id = c.id and (pp.id = pl.id or pp.carteirinha = pl.carteirinha)) then
      v_bloq := v_bloq || (v_proc.codigo || ' já cobrado para este paciente em ' || to_char(v_data, 'DD/MM/YYYY') || ' (glosa 3209 — duplicidade).');
    end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.importar_prontuario_antigo(p_clinica uuid, p_origem_id text, p_arquivo text, p_texto text, p_data date, p_area text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prof uuid := meu_profissional(p_clinica); v_pac uuid;
begin
  if v_prof is null then raise exception 'Só profissionais podem importar prontuário.'; end if;
  select coalesce((campos_extras->>'mesclado_em')::uuid, id) into v_pac from pacientes where clinica_id = p_clinica and origem = 'motivar_2012' and origem_id = p_origem_id limit 1;
  if v_pac is null then return 'paciente_nao_encontrado'; end if;
  if exists (select 1 from prontuario_registros where clinica_id = p_clinica and profissional_id = v_prof and origem_arquivo = p_arquivo) then
    return 'ja_importado'; end if;
  insert into prontuario_registros (clinica_id, paciente_id, profissional_id, area, modelo, data_registro, conteudo, status, origem, origem_arquivo)
  values (p_clinica, v_pac, v_prof, coalesce(p_area, 'outra'), 'livre', coalesce(p_data, current_date),
          jsonb_build_object('texto', p_texto), 'assinado', 'sistema_antigo', p_arquivo);
  return 'importado';
end $function$;

CREATE OR REPLACE FUNCTION public.lote_candidatas(p_clinica uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(meu_perfil(p_clinica)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  return coalesce((select jsonb_agg(x order by x->>'contrato') from (
    select jsonb_build_object(
      'contrato_id', c.id, 'contrato', c.nome, 'versao', c.versao_tiss,
      'guias', jsonb_agg(jsonb_build_object(
        'id', g.id, 'numero', g.numero_guia_prestador, 'tipo', g.tipo, 'senha', coalesce(g.senha, au.senha),
        'paciente', pa.nome, 'carteirinha', pl.carteirinha, 'profissional', pr.nome,
        'primeira', (select min(i.data_realizacao) from guia_itens i where i.guia_id = g.id),
        'ultima', (select max(i.data_realizacao) from guia_itens i where i.guia_id = g.id),
        'valor', (select coalesce(sum(i.valor_informado), 0) from guia_itens i where i.guia_id = g.id),
        'situacao', situacao_guia_lote(g.id)) order by g.numero_guia_prestador)) x
    from guias g
    join contratos c on c.id = g.contrato_id
    join paciente_planos pl on pl.id = g.paciente_plano_id
    join pacientes pa on pa.id = pl.paciente_id
    join profissionais pr on pr.id = g.profissional_id
    left join autorizacoes au on au.id = g.autorizacao_id
    where g.clinica_id = p_clinica and g.lote_id is null and g.status in ('rascunho','pronta')
      and not coalesce((c.regras->>'sem_tiss')::boolean, false)
      and exists (select 1 from guia_itens i where i.guia_id = g.id)
    group by c.id, c.nome, c.versao_tiss) s(x)), '[]');
end $function$;

CREATE OR REPLACE FUNCTION public.meu_extrato(p_clinica uuid, p_de date, p_ate date)
 RETURNS TABLE(data date, paciente text, procedimento text, numero_guia text, repasse_previsto numeric, desconto_glosa numeric, repasse_final numeric, glosa_codigo text, glosa_motivo text, glosa_status status_glosa, orientacao text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where g.clinica_id = p_clinica and g.profissional_id = meu_profissional(p_clinica)
    and i.data_realizacao between p_de and p_ate
  order by i.data_realizacao;
$function$;

CREATE OR REPLACE FUNCTION public.meu_perfil(p_clinica uuid)
 RETURNS perfil_usuario
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select perfil from usuarios_clinica where user_id = auth.uid() and clinica_id = p_clinica and ativo;
$function$;

CREATE OR REPLACE FUNCTION public.meu_profissional(p_clinica uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select profissional_id from usuarios_clinica where user_id = auth.uid() and clinica_id = p_clinica and ativo;
$function$;

CREATE OR REPLACE FUNCTION public.meus_pacientes_prontuario(p_clinica uuid)
 RETURNS TABLE(paciente_id uuid, nome text, ultimo_atendimento timestamp with time zone, registros bigint, rascunhos bigint, ultimo_registro date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with eu as (select meu_profissional(p_clinica) as id),
  pac as (
    select a.paciente_id from atendimentos a, eu where a.clinica_id = p_clinica and a.profissional_id = eu.id
    union select r.paciente_id from prontuario_registros r, eu where r.clinica_id = p_clinica and r.profissional_id = eu.id)
  select p.id, coalesce(p.nome_social, p.nome),
    (select max(a.inicio) from atendimentos a, eu where a.paciente_id = p.id and a.profissional_id = eu.id and a.status = 'atendido'),
    (select count(*) from prontuario_registros r, eu where r.paciente_id = p.id and r.profissional_id = eu.id),
    (select count(*) from prontuario_registros r, eu where r.paciente_id = p.id and r.profissional_id = eu.id and r.status = 'rascunho'),
    (select max(r.data_registro) from prontuario_registros r, eu where r.paciente_id = p.id and r.profissional_id = eu.id)
  from pac join pacientes p on p.id = pac.paciente_id
  where (select id from eu) is not null;
$function$;

CREATE OR REPLACE FUNCTION public.novo_procedimento_particular(p_clinica uuid, p_nome text, p_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ct uuid; v_proc uuid; v_cod text; v_nome text := btrim(p_nome);
begin
  if meu_perfil(p_clinica) is null then raise exception 'Sem permissão'; end if;
  if coalesce(length(v_nome), 0) < 3 then raise exception 'Informe o nome do procedimento.'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Informe o valor.'; end if;
  select c.id into v_ct from contratos c where c.clinica_id = p_clinica and c.ativo
    and exists (select 1 from contrato_tabela t where t.contrato_id = c.id and t.tipo_guia = 'PARTICULAR') order by c.vigencia_inicio desc nulls last limit 1;
  if v_ct is null then raise exception 'Não há contrato particular ativo.'; end if;
  select p.id into v_proc from procedimentos p join contrato_tabela t on t.procedimento_id = p.id and t.contrato_id = v_ct
    where lower(p.descricao) = lower(v_nome) limit 1;
  if v_proc is not null then raise exception 'Já existe "%" na tabela particular.', v_nome; end if;
  v_cod := 'CURE-' || upper(left(regexp_replace(translate(lower(v_nome), 'áàâãéêíóôõúç', 'aaaaeeiooouc'), '[^a-z0-9]', '', 'g'), 6))
           || '-' || upper(substr(md5(random()::text), 1, 3));
  insert into procedimentos (codigo_tabela, codigo, descricao) values ('00', v_cod, v_nome) returning id into v_proc;
  insert into contrato_tabela (clinica_id, contrato_id, procedimento_id, valor, vigencia_inicio, tipo_guia)
    values (p_clinica, v_ct, v_proc, round(p_valor, 2), current_date, 'PARTICULAR');
  return jsonb_build_object('id', v_proc, 'codigo', v_cod, 'descricao', v_nome, 'valor', round(p_valor, 2));
end $function$;

CREATE OR REPLACE FUNCTION public.opcoes_guia(p_atendimento uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.pasta_clinica_ok(p_nome text, p_perfis text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$'
    then coalesce(meu_perfil(split_part(p_nome, '/', 1)::uuid)::text = any(p_perfis), false) else false end;
$function$;

CREATE OR REPLACE FUNCTION public.pasta_prontuario_ok(p_nome text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$' and split_part(p_nome, '/', 2) ~ '^[0-9a-f-]{36}$'
    then meu_profissional(split_part(p_nome, '/', 1)::uuid) = split_part(p_nome, '/', 2)::uuid else false end;
$function$;

CREATE OR REPLACE FUNCTION public.pendencias(p_clinica uuid)
 RETURNS TABLE(gravidade text, area text, descricao text, link text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select 'alta', 'Profissionais', p.nome || ': falta ' || concat_ws(', ',
      case when coalesce(p.conselho,'') = '' then 'conselho' end,
      case when coalesce(p.numero_conselho,'') = '' then 'nº do conselho' end,
      case when coalesce(p.uf_conselho,'') = '' then 'UF do conselho' end,
      case when coalesce(p.cbo,'') = '' then 'CBO' end) || ' (obrigatório na guia TISS)', 'profissionais'
  from profissionais p where p.clinica_id = p_clinica and p.ativo
    and (coalesce(p.conselho,'') = '' or coalesce(p.numero_conselho,'') = '' or coalesce(p.uf_conselho,'') = '' or coalesce(p.cbo,'') = '')
  union all
  select 'media', 'Repasse', p.nome || ': sem regra de repasse cadastrada', 'repasse'
  from profissionais p where p.clinica_id = p_clinica and p.ativo
    and not exists (select 1 from regras_repasse r where r.profissional_id = p.id)
  union all
  select 'alta', 'Contratos', k.nome || ': há repasse definido para ' || pr.codigo || ' (' || pr.descricao || '), mas o contrato não tem valor de recebimento para esse procedimento', 'contratos'
  from regras_repasse r join contratos k on k.id = r.contrato_id join procedimentos pr on pr.id = r.procedimento_id
  where r.clinica_id = p_clinica and (r.vigencia_fim is null or r.vigencia_fim >= current_date)
    and not exists (select 1 from contrato_tabela t where t.contrato_id = k.id and t.procedimento_id = pr.id and t.vigencia_fim is null)
  union all
  select 'alta', 'Contratos', 'CNPJ de faturamento "' || c.razao_social || '" está inválido ou incompleto', 'contratos'
  from cnpjs_faturamento c where c.clinica_id = p_clinica and c.ativo and length(regexp_replace(c.cnpj, '\D', '', 'g')) <> 14
  union all
  select 'alta', 'Contratos', k.nome || ': sem código do prestador na operadora', 'contratos'
  from contratos k join operadoras o on o.id = k.operadora_id
  where k.clinica_id = p_clinica and k.ativo and coalesce(k.codigo_prestador_operadora,'') = '' and o.registro_ans is not null
  union all
  select 'alta', 'Contratos', k.nome || ': sem tabela de valores vigente', 'contratos'
  from contratos k where k.clinica_id = p_clinica and k.ativo
    and not exists (select 1 from contrato_tabela t where t.contrato_id = k.id and t.vigencia_inicio <= current_date and (t.vigencia_fim is null or t.vigencia_fim >= current_date))
  union all
  select 'media', 'Contratos', k.nome || ': prazos de envio e recurso não informados', 'contratos'
  from contratos k join operadoras o on o.id = k.operadora_id
  where k.clinica_id = p_clinica and k.ativo and o.registro_ans is not null and (k.prazo_envio_dias is null or k.prazo_recurso_dias is null)
  union all
  select 'media', 'Contratos', k.nome || ': tabela de valores vigente desde ' || to_char(min(t.vigencia_inicio), 'DD/MM/YYYY') || ' — conferir reajuste anual', 'contratos'
  from contratos k join contrato_tabela t on t.contrato_id = k.id and t.vigencia_fim is null
  where k.clinica_id = p_clinica and k.ativo group by k.id, k.nome having min(t.vigencia_inicio) < current_date - interval '11 months'
  union all
  select 'media', 'Retornos', 'Retorno de ' || to_char(r.data_emissao, 'DD/MM/YYYY') || ' aguardando revisão das glosas', 'retornos-' || r.id
  from retornos r where r.clinica_id = p_clinica and r.status = 'em_revisao'
  union all
  select 'baixa', 'Acessos', p.nome || ': ainda sem acesso ao sistema (convite pendente)', 'acessos'
  from profissionais p where p.clinica_id = p_clinica and p.ativo
    and not exists (select 1 from usuarios_clinica u where u.profissional_id = p.id)
    and not exists (select 1 from convites v where v.profissional_id = p.id);
$function$;

CREATE OR REPLACE FUNCTION public.prontuario_trava()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.status = 'assinado' then raise exception 'Registro assinado não pode ser apagado (guarda legal de 20 anos).'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.clinica_id <> old.clinica_id or new.paciente_id <> old.paciente_id or new.profissional_id <> old.profissional_id then
      raise exception 'Não é permitido trocar paciente, profissional ou clínica do registro.'; end if;
    if old.status = 'assinado' then
      raise exception 'Registro assinado não pode ser alterado. Para corrigir ou complementar, use um adendo.';
    end if;
  end if;
  new.atualizado_em := now();
  if new.status = 'assinado' then
    new.assinado_em := now();
    new.hash_assinatura := encode(sha256(convert_to(
      new.paciente_id::text || '|' || new.profissional_id::text || '|' || new.data_registro::text || '|' || new.modelo || '|' || new.conteudo::text, 'UTF8')), 'hex');
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.recebimento_lancamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.registrar_backup_automatico(p_arquivo text, p_linhas integer, p_arquivos integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update clinicas set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'ultimo_backup', now(), 'ultimo_backup_tipo', 'automatico',
    'ultimo_backup_info', jsonb_build_object('arquivo', p_arquivo, 'linhas', p_linhas, 'arquivos', p_arquivos))
  where id is not null;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_envio_lote(p_lote uuid, p_data_envio date, p_protocolo text, p_numero_operadora text DEFAULT NULL::text)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l lotes; c contratos; v_prazo int; v_venc date; v_cat uuid; v_num text := nullif(trim(p_numero_operadora), '');
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if l.status <> 'fechado' then raise exception 'Este lote já foi enviado.'; end if;
  if l.arquivo_xml is null and v_num is null then
    raise exception 'Gere o XML ou informe o número do lote/GRD que a operadora deu.'; end if;
  if v_num is not null and exists (select 1 from lotes where contrato_id = l.contrato_id and numero_lote = v_num and id <> l.id) then
    raise exception 'O lote % já existe neste contrato.', v_num; end if;
  select * into c from contratos where id = l.contrato_id;
  v_prazo := coalesce((c.regras->>'prazo_pagamento_dias')::int, 30);
  v_venc := p_data_envio + v_prazo;
  update lotes set numero_lote = coalesce(v_num, numero_lote),
    status = case when nullif(trim(p_protocolo), '') is null then 'enviado' else 'protocolado' end::status_lote,
    data_envio = p_data_envio, protocolo = nullif(trim(p_protocolo), ''), previsto_pagamento = v_venc where id = p_lote
    returning * into l;
  update guias set status = 'enviada' where lote_id = p_lote;
  select id into v_cat from categorias_financeiras where clinica_id = l.clinica_id and nome = 'Convênios';
  delete from lancamentos where lote_id = p_lote and origem = 'lote' and status = 'previsto';
  insert into lancamentos (clinica_id, tipo, descricao, categoria_id, competencia, vencimento, valor_previsto,
    contrato_id, lote_id, fornecedor, origem, observacao)
  values (l.clinica_id, 'receber', 'Lote ' || l.numero_lote || ' – ' || c.nome, v_cat, l.competencia, v_venc, l.valor_total,
    c.id, l.id, c.nome, 'lote', l.qtd_guias || ' guias; previsto = valor informado (o retorno ajusta as glosas). Prazo ' || v_prazo || ' dias.');
  return v_venc;
end $function$;

CREATE OR REPLACE FUNCTION public.relacionamento(p_clinica uuid, p_dias integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb; v_out jsonb := '[]'::jsonb; g jsonb;
begin
  if coalesce(meu_perfil(p_clinica)::text, '') not in ('gestor','financeiro','recepcao') then raise exception 'Sem permissão'; end if;
  select config->'relacionamento' into v_cfg from clinicas where id = p_clinica;
  v_out := v_out || coalesce((select jsonb_agg(jsonb_build_object('tipo', 'aniversario', 'paciente_id', p.id, 'nome', p.nome, 'telefone', p.telefone,
      'quando', d.dia, 'idade', extract(year from age(d.dia, p.data_nascimento))::int) order by d.dia)
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
      select jsonb_agg(jsonb_build_object('tipo', 'reavaliacao', 'item', g->>'nome', 'paciente_id', p.id, 'nome', p.nome, 'telefone', p.telefone,
          'ultima', u.dia, 'quando', u.dia + (g->>'dias')::int) order by u.dia)
      from ult u join pacientes p on p.id = u.paciente_id
      where p.ativo and p.consentimento_comunicacao and p.comunicacao_optout_em is null
        and u.dia + (g->>'dias')::int between current_date - 30 and current_date + p_dias
        and not exists (select 1 from atendimentos a where a.paciente_id = p.id and a.inicio > now() and a.status in ('agendado','confirmado'))), '[]'::jsonb);
  end loop;
  return jsonb_build_object('itens', v_out, 'config', v_cfg);
end $function$;

CREATE OR REPLACE FUNCTION public.responder_autorizacao(p_aut uuid, p_status text, p_senha text DEFAULT NULL::text, p_data date DEFAULT NULL::date, p_validade date DEFAULT NULL::date, p_qtd integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare au autorizacoes; v_perfil perfil_usuario; v_min date; v_max date; v_ag int; v_av text[] := '{}';
begin
  select * into au from autorizacoes where id = p_aut;
  if au.id is null then raise exception 'Autorização não encontrada'; end if;
  v_perfil := meu_perfil(au.clinica_id);
  if v_perfil is null or (v_perfil = 'profissional' and au.profissional_id is distinct from meu_profissional(au.clinica_id)
     and not exists (select 1 from atendimentos x where x.autorizacao_id = au.id and x.profissional_id = meu_profissional(au.clinica_id))) then
    raise exception 'Sem permissão para esta autorização';
  end if;
  select count(*) into v_ag from atendimentos where autorizacao_id = au.id and status in ('agendado','confirmado','presente');
  if p_status = 'negada' then
    update autorizacoes set status = 'negada', observacao = coalesce(observacao || ' · ', '') || 'Negada em ' || to_char(current_date, 'DD/MM/YYYY') where id = au.id;
    if v_ag > 0 then v_av := v_av || (v_ag || ' atendimento(s) agendado(s) estão ligados a esta autorização: remarque como particular ou peça nova autorização.'); end if;
    return jsonb_build_object('avisos', to_jsonb(v_av));
  end if;
  if p_status <> 'autorizada' then raise exception 'Situação inválida'; end if;
  if nullif(trim(p_senha), '') is null then raise exception 'Informe a senha.'; end if;
  if p_data is null then raise exception 'Informe a data da autorização.'; end if;
  select min(i.data_realizacao), max(i.data_realizacao) into v_min, v_max
    from guia_itens i join guias g on g.id = i.guia_id where g.autorizacao_id = au.id and g.status <> 'cancelada';
  if v_min is not null and p_data > v_min then
    raise exception 'Data da autorização (%) é posterior à 1ª sessão já realizada (%): glosa 1814. Confira a data.', to_char(p_data, 'DD/MM/YYYY'), to_char(v_min, 'DD/MM/YYYY');
  end if;
  if p_validade is not null and v_max is not null and p_validade < v_max then
    raise exception 'Senha válida até %, antes de sessão já realizada em %.', to_char(p_validade, 'DD/MM/YYYY'), to_char(v_max, 'DD/MM/YYYY');
  end if;
  update autorizacoes set status = 'autorizada', senha = trim(p_senha), data_autorizacao = p_data, validade = p_validade,
    qtd_autorizada = coalesce(p_qtd, qtd_autorizada) where id = au.id;
  update guias set senha = trim(p_senha) where autorizacao_id = au.id and status in ('rascunho','pronta');
  if exists (select 1 from atendimentos x where x.autorizacao_id = au.id and x.status in ('agendado','confirmado','presente')
             and p_validade is not null and (x.inicio at time zone 'America/Sao_Paulo')::date > p_validade) then
    v_av := v_av || 'Há sessões agendadas depois da validade da senha: remarque ou peça prorrogação.'::text;
  end if;
  if coalesce(p_qtd, au.qtd_autorizada) < (select count(*) from atendimentos x where x.autorizacao_id = au.id and x.status <> 'cancelado' and x.status <> 'faltou') then
    v_av := v_av || 'Há mais sessões ligadas do que o autorizado: as excedentes serão bloqueadas no fechamento (glosa 3292).'::text;
  end if;
  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
    values (au.clinica_id, auth.uid(), 'autorizacoes', au.id, 'responder', jsonb_build_object('senha', p_senha, 'data', p_data, 'validade', p_validade, 'qtd', p_qtd));
  return jsonb_build_object('avisos', to_jsonb(v_av));
end $function$;

CREATE OR REPLACE FUNCTION public.salvar_xml_lote(p_lote uuid, p_xml text, p_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l lotes;
begin
  select * into l from lotes where id = p_lote;
  if coalesce(meu_perfil(l.clinica_id)::text, '') not in ('gestor','financeiro') then raise exception 'Sem permissão'; end if;
  if l.status <> 'fechado' then raise exception 'Lote já enviado: o XML não pode ser substituído.'; end if;
  update lotes set arquivo_xml = p_xml, hash_md5 = p_hash, gerado_em = now() where id = p_lote;
end $function$;

CREATE OR REPLACE FUNCTION public.semear_categorias(p_clinica uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.situacao_guia_lote(p_guia uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'realizadas', r.realizadas,
    'autorizadas', au.qtd_autorizada,
    'validade', au.validade,
    'dias_para_vencer', case when au.validade is not null then au.validade - current_date end,
    'dias_desde_primeira', current_date - r.primeira,
    'prazo_entrega', (c.regras->>'prazo_entrega_dias')::int,
    'exige_senha', contrato_exige_senha(g.contrato_id),
    'motivo', case
      when not contrato_exige_senha(g.contrato_id) then 'sem_exigencia'
      when coalesce(g.senha, au.senha) is null or au.status is distinct from 'autorizada' then 'sem_senha'
      when au.qtd_autorizada is null or r.realizadas >= au.qtd_autorizada
           or coalesce((c.regras->>'guia_por_sessao')::boolean, false) then 'cheia'
      when au.validade is not null and au.validade < current_date then 'senha_vencida'
      when (c.regras->>'prazo_entrega_dias') is not null
           and current_date - r.primeira >= (c.regras->>'prazo_entrega_dias')::int - 10 then 'prazo_entrega'
      else 'aguardando' end)
  from guias g
  join contratos c on c.id = g.contrato_id
  left join autorizacoes au on au.id = g.autorizacao_id
  cross join lateral (select count(distinct coalesce(i.atendimento_id, i.id))::int realizadas, min(i.data_realizacao) primeira
                      from guia_itens i where i.guia_id = g.id) r
  where g.id = p_guia;
$function$;

CREATE OR REPLACE FUNCTION public.trg_glosa_notifica()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.trg_glosa_recalcula()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_item uuid := coalesce(new.guia_item_id, old.guia_item_id);
begin
  update guia_itens set repasse_desconto = least(repasse_previsto, calcular_desconto_repasse(v_item))
  where id = v_item;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.verificar_documento(p_codigo text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('valido', true, 'tipo', d.titulo, 'emitido_em', d.emitido_em,
    'profissional', pr.nome, 'conselho', pr.conselho || ' ' || pr.numero_conselho,
    'paciente_iniciais', (select string_agg(left(w, 1), '') from regexp_split_to_table(p.nome, '\s+') w where length(w) > 2))
  from documentos_emitidos d join pacientes p on p.id = d.paciente_id left join profissionais pr on pr.id = d.profissional_id
  where d.codigo = upper(trim(p_codigo));
$function$;

CREATE OR REPLACE FUNCTION public.vincular_convite_existente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(new.email);
  if v_uid is not null then
    insert into usuarios_clinica (user_id, clinica_id, perfil, profissional_id)
    values (v_uid, new.clinica_id, new.perfil, new.profissional_id)
    on conflict (user_id, clinica_id) do update set perfil = excluded.perfil, profissional_id = excluded.profissional_id;
    new.usado_em := now();
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.vincular_encaminhamento(p_autorizacao uuid, p_encaminhamento uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare au autorizacoes; en encaminhamentos; v_pac uuid; avisos jsonb := '[]';
begin
  select * into au from autorizacoes where id = p_autorizacao;
  if coalesce(meu_perfil(au.clinica_id)::text, '') not in ('gestor','recepcao','financeiro') then raise exception 'Sem permissão'; end if;
  if p_encaminhamento is null then
    update autorizacoes set encaminhamento_id = null where id = au.id;
    return jsonb_build_object('avisos', avisos);
  end if;
  select * into en from encaminhamentos where id = p_encaminhamento;
  select paciente_id into v_pac from paciente_planos where id = au.paciente_plano_id;
  if en.id is null or en.paciente_id <> v_pac then raise exception 'O encaminhamento não é deste paciente.'; end if;
  if en.status <> 'ativo' then raise exception 'Encaminhamento cancelado.'; end if;
  if au.area is not null and au.area <> en.area then
    raise exception 'Área diferente: a autorização é de % e o encaminhamento é de %.', au.area, en.area; end if;
  if en.validade is not null and au.data_autorizacao is not null and en.validade < au.data_autorizacao then
    avisos := avisos || to_jsonb('O encaminhamento já estava vencido na data da autorização.'::text); end if;
  if en.arquivo is null then avisos := avisos || to_jsonb('Encaminhamento sem arquivo: anexe o pedido (obrigatório no faturamento).'::text); end if;
  update autorizacoes set encaminhamento_id = en.id, area = en.area,
    solicitante_id = coalesce(solicitante_id, en.solicitante_id),
    cid = coalesce(nullif(cid, ''), en.cid),
    indicacao_clinica = coalesce(nullif(indicacao_clinica, ''), en.indicacao_clinica)
  where id = au.id;
  update guias g set solicitante_id = coalesce(g.solicitante_id, en.solicitante_id),
    cid = coalesce(nullif(g.cid, ''), en.cid), indicacao_clinica = coalesce(nullif(g.indicacao_clinica, ''), en.indicacao_clinica)
  where g.autorizacao_id = au.id and g.lote_id is null and g.status in ('rascunho','pronta');
  return jsonb_build_object('avisos', avisos);
end $function$;

RESET check_function_bodies;

-- ---------------------------------------------------------------------
-- 7. Triggers (pg_get_triggerdef; 6 em public + 2 em auth.users).
--    Triggers internos do schema storage ficam de fora (criados pelo Supabase).
--    Triggers de auditoria da db/035 NAO existem em producao: nao estao aqui.
-- ---------------------------------------------------------------------
CREATE TRIGGER convite_usuario_existente BEFORE INSERT ON public.convites FOR EACH ROW EXECUTE FUNCTION vincular_convite_existente();
CREATE TRIGGER glosa_notifica AFTER INSERT OR UPDATE ON public.glosas FOR EACH ROW EXECUTE FUNCTION trg_glosa_notifica();
CREATE TRIGGER glosa_recalcula AFTER INSERT OR DELETE OR UPDATE ON public.glosas FOR EACH ROW EXECUTE FUNCTION trg_glosa_recalcula();
CREATE TRIGGER prontuario_trava BEFORE INSERT OR DELETE OR UPDATE ON public.prontuario_registros FOR EACH ROW EXECUTE FUNCTION prontuario_trava();
CREATE TRIGGER recebimento_lancamento BEFORE INSERT OR UPDATE ON public.recebimentos FOR EACH ROW EXECUTE FUNCTION recebimento_lancamento();
CREATE TRIGGER recebimento_lancamento_del AFTER DELETE ON public.recebimentos FOR EACH ROW EXECUTE FUNCTION recebimento_lancamento();

-- ---------------------------------------------------------------------
-- 8. RLS: todas as 37 tabelas de public com row level security ligada.
-- ---------------------------------------------------------------------
ALTER TABLE public.atendimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autorizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias_financeiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cnpjs_faturamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_financeiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contrato_tabela ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_emitidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encaminhamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glosas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glosas_operadora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guia_anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guia_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motivos_glosa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operadoras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paciente_planos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profissionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prontuario_adendos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prontuario_anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prontuario_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prontuario_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recebimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regras_repasse ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retorno_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retornos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_clinica ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 9. Policies de public (59) e de storage.objects (6).
-- ---------------------------------------------------------------------
CREATE POLICY edita_atendimentos ON public.atendimentos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY prof_atendimentos ON public.atendimentos AS PERMISSIVE FOR SELECT TO authenticated USING (((meu_perfil(clinica_id) = 'profissional'::perfil_usuario) AND (profissional_id = meu_profissional(clinica_id))));
CREATE POLICY prof_status_atendimentos ON public.atendimentos AS PERMISSIVE FOR UPDATE TO authenticated USING (((meu_perfil(clinica_id) = 'profissional'::perfil_usuario) AND (profissional_id = meu_profissional(clinica_id)))) WITH CHECK (((meu_perfil(clinica_id) = 'profissional'::perfil_usuario) AND (profissional_id = meu_profissional(clinica_id))));
CREATE POLICY gestor_auditoria ON public.auditoria AS PERMISSIVE FOR SELECT TO authenticated USING ((meu_perfil(clinica_id) = 'gestor'::perfil_usuario));
CREATE POLICY edita_autorizacoes ON public.autorizacoes AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_categorias_financeiras ON public.categorias_financeiras AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestor_clinica ON public.clinicas AS PERMISSIVE FOR UPDATE TO authenticated USING ((meu_perfil(id) = 'gestor'::perfil_usuario));
CREATE POLICY ver_clinica ON public.clinicas AS PERMISSIVE FOR SELECT TO authenticated USING ((meu_perfil(id) IS NOT NULL));
CREATE POLICY gestao_cnpjs_faturamento ON public.cnpjs_faturamento AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_contas_financeiras ON public.contas_financeiras AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_contrato_tabela ON public.contrato_tabela AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_contratos ON public.contratos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestor_convites ON public.convites AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = 'gestor'::perfil_usuario)) WITH CHECK ((meu_perfil(clinica_id) = 'gestor'::perfil_usuario));
CREATE POLICY dm_clinica ON public.documento_modelos AS PERMISSIVE FOR ALL TO authenticated USING (((profissional_id IS NULL) AND (meu_perfil(clinica_id) = 'gestor'::perfil_usuario))) WITH CHECK (((profissional_id IS NULL) AND (meu_perfil(clinica_id) = 'gestor'::perfil_usuario)));
CREATE POLICY dm_ler ON public.documento_modelos AS PERMISSIVE FOR SELECT TO authenticated USING (((meu_perfil(clinica_id) IS NOT NULL) AND ((profissional_id IS NULL) OR (profissional_id = meu_profissional(clinica_id)))));
CREATE POLICY dm_proprio ON public.documento_modelos AS PERMISSIVE FOR ALL TO authenticated USING ((profissional_id = meu_profissional(clinica_id))) WITH CHECK ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY de_autor ON public.documentos_emitidos AS PERMISSIVE FOR SELECT TO authenticated USING ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY de_criar ON public.documentos_emitidos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((emitido_por = auth.uid()) AND ((profissional_id = meu_profissional(clinica_id)) OR ((tipo = ANY (ARRAY['comparecimento'::text, 'acompanhante'::text])) AND (meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])) AND ((profissional_id IS NULL) OR (EXISTS ( SELECT 1 FROM profissionais pr WHERE ((pr.id = documentos_emitidos.profissional_id) AND (pr.clinica_id = documentos_emitidos.clinica_id)))))))));
CREATE POLICY de_recepcao ON public.documentos_emitidos AS PERMISSIVE FOR SELECT TO authenticated USING (((tipo = ANY (ARRAY['comparecimento'::text, 'acompanhante'::text])) AND (meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))));
CREATE POLICY edita_encaminhamentos ON public.encaminhamentos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY prof_encaminhamentos ON public.encaminhamentos AS PERMISSIVE FOR SELECT TO authenticated USING (((meu_perfil(clinica_id) = 'profissional'::perfil_usuario) AND (EXISTS ( SELECT 1 FROM atendimentos a WHERE ((a.paciente_id = encaminhamentos.paciente_id) AND (a.profissional_id = meu_profissional(encaminhamentos.clinica_id)))))));
CREATE POLICY gestao_glosas ON public.glosas AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_glosas_operadora ON public.glosas_operadora AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY ler_glosas_operadora ON public.glosas_operadora AS PERMISSIVE FOR SELECT TO authenticated USING ((meu_perfil(clinica_id) IS NOT NULL));
CREATE POLICY edita_guia_anexos ON public.guia_anexos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_guia_itens ON public.guia_itens AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_guias ON public.guias AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_lancamentos ON public.lancamentos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_lotes ON public.lotes AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY ler_motivos ON public.motivos_glosa AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY marcar_lida ON public.notificacoes AS PERMISSIVE FOR UPDATE TO authenticated USING ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY minhas_notificacoes ON public.notificacoes AS PERMISSIVE FOR SELECT TO authenticated USING (((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])) OR (profissional_id = meu_profissional(clinica_id))));
CREATE POLICY gestao_operadoras ON public.operadoras AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY edita_paciente_planos ON public.paciente_planos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY edita_pacientes ON public.pacientes AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY prof_pacientes ON public.pacientes AS PERMISSIVE FOR SELECT TO authenticated USING (((meu_perfil(clinica_id) = 'profissional'::perfil_usuario) AND (EXISTS ( SELECT 1 FROM atendimentos a WHERE ((a.paciente_id = pacientes.id) AND (a.profissional_id = meu_profissional(pacientes.clinica_id)))))));
CREATE POLICY prof_pacientes_prontuario ON public.pacientes AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1 FROM prontuario_registros r WHERE ((r.paciente_id = pacientes.id) AND (r.profissional_id = meu_profissional(pacientes.clinica_id))))));
CREATE POLICY gestor_insere_procedimentos ON public.procedimentos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1 FROM usuarios_clinica u WHERE ((u.user_id = auth.uid()) AND (u.perfil = 'gestor'::perfil_usuario) AND u.ativo))));
CREATE POLICY ler_procedimentos ON public.procedimentos AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY edita_profissionais ON public.profissionais AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY prof_proprio_cadastro ON public.profissionais AS PERMISSIVE FOR SELECT TO authenticated USING ((id = meu_profissional(clinica_id)));
CREATE POLICY pa_criar ON public.prontuario_adendos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profissional_id = meu_profissional(clinica_id)) AND (EXISTS ( SELECT 1 FROM prontuario_registros r WHERE ((r.id = prontuario_adendos.registro_id) AND (r.profissional_id = prontuario_adendos.profissional_id) AND (r.status = 'assinado'::text))))));
CREATE POLICY pa_ler ON public.prontuario_adendos AS PERMISSIVE FOR SELECT TO authenticated USING ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY px_criar ON public.prontuario_anexos AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profissional_id = meu_profissional(clinica_id)) AND (EXISTS ( SELECT 1 FROM prontuario_registros r WHERE ((r.id = prontuario_anexos.registro_id) AND (r.profissional_id = prontuario_anexos.profissional_id))))));
CREATE POLICY px_ler ON public.prontuario_anexos AS PERMISSIVE FOR SELECT TO authenticated USING ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY pr_apagar ON public.prontuario_registros AS PERMISSIVE FOR DELETE TO authenticated USING (((profissional_id = meu_profissional(clinica_id)) AND (status = 'rascunho'::text)));
CREATE POLICY pr_criar ON public.prontuario_registros AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((profissional_id = meu_profissional(clinica_id)) AND (EXISTS ( SELECT 1 FROM pacientes p WHERE ((p.id = prontuario_registros.paciente_id) AND (p.clinica_id = prontuario_registros.clinica_id))))));
CREATE POLICY pr_editar ON public.prontuario_registros AS PERMISSIVE FOR UPDATE TO authenticated USING ((profissional_id = meu_profissional(clinica_id))) WITH CHECK ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY pr_ler ON public.prontuario_registros AS PERMISSIVE FOR SELECT TO authenticated USING ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY pv_ler ON public.prontuario_versoes AS PERMISSIVE FOR SELECT TO authenticated USING ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY rec_gestao ON public.recebimentos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario, 'recepcao'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario, 'recepcao'::perfil_usuario])));
CREATE POLICY rec_prof ON public.recebimentos AS PERMISSIVE FOR ALL TO authenticated USING ((profissional_id = meu_profissional(clinica_id))) WITH CHECK ((profissional_id = meu_profissional(clinica_id)));
CREATE POLICY gestao_regras_repasse ON public.regras_repasse AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_retorno_linhas ON public.retorno_linhas AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY gestao_retornos ON public.retornos AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY edita_solicitantes ON public.solicitantes AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario]))) WITH CHECK ((meu_perfil(clinica_id) = ANY (ARRAY['gestor'::perfil_usuario, 'recepcao'::perfil_usuario, 'financeiro'::perfil_usuario])));
CREATE POLICY ler_solicitantes ON public.solicitantes AS PERMISSIVE FOR SELECT TO authenticated USING ((meu_perfil(clinica_id) IS NOT NULL));
CREATE POLICY gestor_usuarios ON public.usuarios_clinica AS PERMISSIVE FOR ALL TO authenticated USING ((meu_perfil(clinica_id) = 'gestor'::perfil_usuario)) WITH CHECK ((meu_perfil(clinica_id) = 'gestor'::perfil_usuario));
CREATE POLICY ver_proprio_vinculo ON public.usuarios_clinica AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (meu_perfil(clinica_id) = 'gestor'::perfil_usuario)));
CREATE POLICY documentos_apagar ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'documentos'::text) AND pasta_clinica_ok(name, ARRAY['gestor'::text, 'recepcao'::text, 'financeiro'::text])));
CREATE POLICY documentos_enviar ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'documentos'::text) AND pasta_clinica_ok(name, ARRAY['gestor'::text, 'recepcao'::text, 'financeiro'::text])));
CREATE POLICY documentos_ler ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'documentos'::text) AND pasta_clinica_ok(name, ARRAY['gestor'::text, 'recepcao'::text, 'financeiro'::text])));
CREATE POLICY documentos_ler_prof ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'documentos'::text) AND arquivo_paciente_do_prof(name)));
CREATE POLICY prontuario_enviar ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'prontuario'::text) AND pasta_prontuario_ok(name)));
CREATE POLICY prontuario_ler ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'prontuario'::text) AND pasta_prontuario_ok(name)));

-- ---------------------------------------------------------------------
-- 10. Grants e revokes de EXECUTE e de tabela (estado de producao).
--     ACHADOS (nao corrigidos aqui, ver relatorio): ver comentarios marcados.
-- ---------------------------------------------------------------------
-- Tabelas: producao concede ALL a anon e authenticated (padrao da plataforma).
-- ACHADO: anon nao deveria ter privilegios de tabela; TRUNCATE ignora RLS.
GRANT ALL ON TABLE public.atendimentos, public.auditoria, public.autorizacoes, public.categorias_financeiras,
  public.clinicas, public.cnpjs_faturamento, public.contas_financeiras, public.contrato_tabela, public.contratos,
  public.convites, public.documento_modelos, public.documentos_emitidos, public.encaminhamentos, public.glosas,
  public.glosas_operadora, public.guia_anexos, public.guia_itens, public.guias, public.lancamentos, public.lotes,
  public.motivos_glosa, public.notificacoes, public.operadoras, public.paciente_planos, public.pacientes,
  public.procedimentos, public.profissionais, public.prontuario_adendos, public.prontuario_anexos,
  public.prontuario_registros, public.prontuario_versoes, public.recebimentos, public.regras_repasse,
  public.retorno_linhas, public.retornos, public.solicitantes, public.usuarios_clinica
  TO anon, authenticated;

-- Funcoes: revoga EXECUTE de PUBLIC e anon em todas e concede so o necessario.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.anexos_lote, public.arquivo_paciente_do_prof, public.autorizacoes_paciente, public.autorizacoes_pendentes,
  public.calcular_desconto_repasse, public.cancelar_guia, public.criar_lote, public.dados_guia_impressa,
  public.dados_xml_lote, public.desfazer_lote, public.editar_procedimento_particular, public.estatisticas,
  public.gerar_repasse_mes, public.guia_atendimento, public.importar_prontuario_antigo, public.lote_candidatas,
  public.meu_extrato, public.meu_perfil, public.meu_profissional, public.meus_pacientes_prontuario,
  public.novo_procedimento_particular, public.opcoes_guia, public.pasta_clinica_ok, public.pasta_prontuario_ok,
  public.pendencias, public.prontuario_trava, public.registrar_envio_lote, public.relacionamento,
  public.responder_autorizacao, public.salvar_xml_lote, public.trg_glosa_notifica, public.trg_glosa_recalcula,
  public.verificar_documento, public.vincular_encaminhamento
  TO authenticated;

-- Estado de producao que diverge da intencao do CLAUDE.md (db/025):
-- ACHADO: estas funcoes continuam com EXECUTE para PUBLIC/anon em producao.
--   calcular_desconto_repasse e pendencias nao deveriam ser chamaveis por anon.
--   trg_glosa_* sao de gatilho; EXECUTE para anon nao e necessario.
--   verificar_documento e a unica funcao anonima prevista.
GRANT EXECUTE ON FUNCTION public.calcular_desconto_repasse, public.pendencias,
  public.trg_glosa_notifica, public.trg_glosa_recalcula, public.verificar_documento TO PUBLIC, anon;

-- Funcoes sem EXECUTE para authenticated (uso interno: trigger, storage ou service role):
-- calcular_repasse, situacao_guia_lote, contrato_exige_senha, guia_atendimento_base,
-- agenda_ics_dados, semear_categorias, registrar_backup_automatico, aceitar_convites,
-- exigir_convite, vincular_convite_existente, recebimento_lancamento.

-- ---------------------------------------------------------------------
-- 11. Storage: buckets e policies.
--     Buckets criados pela API/painel (sem INSERT neste arquivo). Parametros de producao:
--       documentos  -> public = false, file_size_limit = 10485760 (10 MB), mime livre
--       prontuario  -> public = false, file_size_limit = 10485760 (10 MB), mime livre
--     Policies de storage.objects estao na secao 9 (documentos_* e prontuario_*).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 12. Trigger em auth.users (fora de public; exige schema auth da plataforma).
--     antes_criar_usuario recusa e-mail sem convite pendente (db/025).
-- ---------------------------------------------------------------------
CREATE TRIGGER antes_criar_usuario BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION exigir_convite();
CREATE TRIGGER ao_criar_usuario AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION aceitar_convites();

-- ---------------------------------------------------------------------
-- CONFERENCIA (2026-11-10): contagens do arquivo x producao
--   tabelas 37 x 37 | colunas 421 x 421 | funcoes 45 x 45 | triggers 8 x 8 (6 public + 2 auth)
--   policies 65 x 65 (59 public + 6 storage) | RLS 37 x 37 | indices 71 x 71 (37 PK + 8 UNIQUE + 26)
--   constraints 175 x 175 (37 PK + 138 FK/UNIQUE/CHECK) | enums 10 x 10 | buckets 2 x 2 (texto)
-- ---------------------------------------------------------------------
