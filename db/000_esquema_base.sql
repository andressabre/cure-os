-- =====================================================================
-- !! INCOMPLETO (10/11/2026): contém só seções 1-5. Faltam funções, triggers, policies, grants,
-- !! storage e trigger em auth.users. NÃO usar para recriar banco até esta linha sair.
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
