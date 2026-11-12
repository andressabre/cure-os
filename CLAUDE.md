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
- `db/` — `000_esquema_base.sql` = esquema completo extraído da produção em 10/11/2026 (antes da 034); banco novo = 000 + 034 em diante.
  As 001–033 ficam como histórico (002–006 e 008 nunca foram versionadas, mas estão contidas no 000).
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
- **Liberação p/ faturamento (db/037):** automática (motivos acima) **ou** manual via `liberar_guia(guia, acao, motivo)` — `liberar` (motivo
  `liberada_manual`; "sem senha" continua bloqueando), `desfazer`, `segurar` (motivo obrigatório; precede tudo), `soltar`; só gestor/financeiro.
  Painel: `guias_liberadas_resumo` → aviso "N guias liberadas" e "N seguradas" em `pendencias`. Nomes na tela: Em aberto → Liberada → No lote → Faturado (lote enviado) → Pago/Glosa.
  Só SP/SADT (nutri, psico e fisio não usam Guia de Consulta — decidido 10/11/2026).
- **Guia impressa no modelo da operadora (db/038):** `operadoras.logo` (data URL ≤ ~60 KB, editado em Contratos → Operadoras) + Registro ANS no campo 1.
- **Encaminhamentos** por área com validade (padrão pedido + 180 dias), vinculados à autorização sem misturar áreas; anexos ANS por guia; Storage privado `documentos`.
  CID-10 local em `dados/cid10.json` (DATASUS via pacote MIT @br-health-kit/cid10) → indicação clínica automática (`descricaoCid` no core).
- **Ficha do paciente (12/11/2026):** abas Resumo · Cadastro e encaminhamentos · Autorizações e guias · Prontuário · Documentos.
  Autorização sem senha = `pendente` (exceto Particular); guias aparecem dentro da autorização (imprimir/cancelar); filtro por situação/convênio/ordem.
- **Cadastro (db/041):** `pacientes.observacao` e `pacientes.alerta` (alerta em destaque na ficha e ao escolher o paciente na agenda);
  boas-vindas por mailto/wa.me com texto `clinicas.config.boas_vindas_texto` ({nome} {clinica}).
- **Documentos:** botão único ★ Favoritos (seletor de modelo no editor: salvar edição / excluir modelo / salvar / imprimir).
- **Telefones (db/040):** `pacientes.celular` (WhatsApp) separado de `telefone` fixo; gravados só dígitos com 55; máscara `mascaraFone` no core.
- **Prontuário:** registros por modelo de área; RLS só pelo autor. **Desde db/039 (12/11/2026) não há etapa de assinar:** salvar grava status
  'assinado' (status final usado por adendos/impressão/backup) e o autor pode editar; todo UPDATE de conteúdo/data guarda a versão anterior em
  `prontuario_versoes` e marca `editado_em`; DELETE de registro final continua bloqueado. Tela em lista compacta expansível. Importador dos .txt antigos.
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
- Políticas sempre `TO authenticated`. Após toda migração: `get_advisors` (security) + `ferramentas/auditoria-rls.sql` devem voltar vazios
  (alertas esperados: RPCs `authenticated` com checagem interna de perfil, `verificar_documento` anônima, senha vazada — painel).
- db/036: sem TRUNCATE/TRIGGER/REFERENCES para anon/authenticated (inclusive em tabelas futuras).
- db/034: EXECUTE fechado também em funções comuns; `alter default privileges` revoga EXECUTE de `public` para funções novas.
- **Auditoria (db/035):** `auditar()` em 14 tabelas de negócio (só colunas alteradas; ignora `atualizado_em`, `arquivo_xml`, valores > 2000 chars);
  `registrar_leitura_prontuario` (só o autor; sem texto clínico; 1×/sessão por registro); tela `#auditoria` só gestor. Sem limpeza automática (tabela cresce).

## Pendências técnicas (laudo 10/11/2026)
Backup institucional com todos os prontuários; piloto ponta a ponta com 1 convênio; retorno em PDF/planilha; mesclar pacientes duplicados;
criar testes SQL de regressão das regras de guia.
