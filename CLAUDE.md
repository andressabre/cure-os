# Cure OS — contexto técnico para continuar o desenvolvimento

Sistema de gestão da Clínica Cure: agenda, pacientes, convênios, faturamento TISS, retornos/glosas, repasse, financeiro e prontuário.

> **Repositório público.** Aqui fica só o contexto TÉCNICO. Valores de contrato, repasse, códigos de prestador, CNPJs de terceiros,
> dados de portais das operadoras e números financeiros NÃO entram neste repositório (nem em commits, nem em comentários de SQL).
> O contexto de negócio completo fica com a gestora, fora do GitHub. Na dúvida, pergunte antes de versionar.

## Infra
- **Front:** HTML + JS (ES modules, sem build), GitHub Pages (push na `main` publica). Commits com autor "Andressa Brenneisen".
- **Banco/Auth:** Supabase (plano gratuito — não gerar custos). Chave publicável no `js/core.js` é pública por desenho; a segurança está na RLS.
- **Edge Function:** `agenda-ics` (calendário iCal por profissional, token em `profissionais.agenda_token`, só iniciais do paciente).
- E-mail do Supabase gratuito tem limite muito baixo: configurar SMTP próprio antes de convidar a equipe.
- **Conta nova só com convite** (db/025, trigger `antes_criar_usuario` em `auth.users`): e-mail sem convite pendente é recusado.

## Estrutura (um arquivo por módulo — mexer só no módulo tocado, testar só o que foi tocado)
- `js/core.js` — cliente Supabase, estado da sessão, utilitários de UI (modal, toast, confirmar).
  Atenção: `confirmar()` substitui o conteúdo do modal aberto → ler todos os campos do formulário ANTES de chamar.
- `js/main.js` — login, menu por perfil, rotas por `#hash`.
- `js/modulos/` — `agenda`, `pacientes` (+ `importador`), `paciente` (ficha, rota `#paciente-<id>-<aba>`), `guia` (fechar atendimento),
  `lotes` + `tiss-xml` (lote e XML TISS 4.03.00), `retornos` + `tiss` (Demonstrativo de Análise de Conta), `contratos`, `profissionais`,
  `repasse`, `extrato`, `painel`, `estatisticas`, `financeiro`, `backup`, `documentos` (Storage), `guia-impressa`, `prontuario`, `emissao`, `acessos`.
- `db/` — migrações versionadas a partir da 007 (002–006 e 008 foram aplicadas direto no Supabase; exportar o esquema para o repo é pendência).
- `ferramentas/` — exportação do sistema antigo e validação do XML contra os XSD da ANS.

## Regras de negócio (genéricas)
- Multi-clínica (`clinica_id` em tudo). CNPJ de faturamento fica no **contrato** (ordem 1 = próprio, 2/3 = intermediários).
- Retorno da operadora: separar lotes pelo nº de lote/guia da Cure; linhas de outras clínicas ficam sem carteirinha (LGPD).
- Nenhuma glosa altera status sem confirmação da gestora.
- Repasse: desconto da glosa proporcional ao que se paga ao profissional, com ajuste manual.
  Precedência: contrato+procedimento > contrato > procedimento > geral; vigência pela data do atendimento (`calcular_repasse`, só uso interno).
- Profissional nunca vê o valor que a clínica recebe nem dados de outros profissionais (RLS + funções `meu_*`).
- Agenda: expediente, dias e pausas em `clinicas.config`; 45 min padrão.

## Funcionalidades já construídas (resumo técnico)
- **Guia ao marcar Atendido** (`guia_atendimento` / `guia_atendimento_base`): prévia × gravação; bloqueia 1814, 3292, 3209, carteirinha
  vencida, procedimento sem valor; avisa dados faltando. **1 guia por senha** (SP/SADT com N datas); contratos com `regras.guia_por_sessao`
  abrem 1 guia por atendimento; `regras.sem_tiss` só registra o atendimento.
- **Autorização na agenda:** agendar convênio exige autorização (existente com saldo ou solicitação pendente → tarefa "Autorizar guia").
  `regras.senha_por_sessao` (db/029): 1 senha por atendimento — série cria 1 solicitação pendente por sessão; usar junto com `guia_por_sessao`.
- **Lote TISS:** guia vai ao lote só cheia, com senha vencida ou no limite de prazo de entrega; máx. 100 guias/lote; XML ISO-8859-1 com hash MD5;
  envio gera lançamento "a receber". Guia HONORARIO ainda bloqueia (schema 4.03 de honorários é de internação).
- **Encaminhamentos** por área com validade, vinculados à autorização sem misturar áreas; anexos ANS por guia; Storage privado `documentos`.
- **Prontuário:** registros por modelo de área; RLS só pelo autor; **assinado é imutável** (db/025) — correção só por adendo;
  `prontuario_versoes` guarda o histórico das edições do período em que foi liberado (09–10/11/2026). Importador dos .txt antigos.
- **Documentos timbrados** (`emissao.js`) com código de verificação público (`verificar.html` → `verificar_documento`, única função anônima).
- **Financeiro:** contas, categorias com grupo DRE, lançamentos previsto × realizado, repasse do mês, caixa e DRE.
- **Backup** (só gestor): ZIP no navegador. Limitação: pela RLS, exporta só o prontuário de quem gera o backup.
- **Agenda (db/025):** `clinicas.config.salas` + `sala_padrao` por profissional; padrão no agendamento = última sala usada pelo profissional;
  aviso de conflito de sala entre profissionais; **agendamento em série** (`atendimentos.serie_id`, limitado ao saldo da senha, pula conflitos;
  "cancelar esta e as próximas"); **lembretes** por link wa.me com texto `config.lembrete_texto` (placeholders {nome} {servico} {profissional}
  {dia} {hora} {sala}) e `atendimentos.lembrete_enviado_em`. Sem API paga.

- **Particular (db/030, `particular.js`):** tabela `recebimentos` (procedimento da tabela PARTICULAR, desconto decidido pelo profissional,
  forma/parcelas, nº da NFS-e emitida no Emissor Nacional gov.br); gatilho lança em `lancamentos` (origem 'particular', categoria/área pelo código).
- **Relacionamento (db/030, `relacionamento.js`):** função `relacionamento(clinica, dias)` → aniversários + reavaliações (`config.relacionamento.reavaliacoes`:
  nome, dias, códigos); modelo opt-out (`consentimento_comunicacao` padrão true, `comunicacao_optout_em` ao pedir para sair; rodapé "responda SAIR").

## Segurança (db/025)
- EXECUTE revogado de `anon`/`public` em todas as funções SECURITY DEFINER, exceto `verificar_documento`.
- `calcular_repasse`, `situacao_guia_lote`, `contrato_exige_senha`: só chamadas internas (sem EXECUTE para `authenticated`).
- Políticas sempre `TO authenticated`. Rodar `get_advisors` (security) depois de cada migração.

## Pendências técnicas (laudo 10/11/2026)
Backup institucional com todos os prontuários; piloto ponta a ponta com 1 convênio; retorno em PDF/planilha; mesclar pacientes duplicados;
trilha de auditoria; exportar esquema (migrações 002–006, 008) e criar testes SQL de regressão das regras de guia.
