# Cure OS — contexto técnico para continuar o desenvolvimento

Sistema de gestão da Clínica Cure: agenda, pacientes, convênios, faturamento TISS, retornos/glosas, repasse, financeiro e prontuário.

> **Repositório público.** Aqui fica só o contexto TÉCNICO. Valores de contrato, repasse, códigos de prestador, CNPJs de terceiros,
> dados de portais das operadoras e números financeiros NÃO entram neste repositório (nem em commits, nem em comentários de SQL).
> O contexto de negócio completo fica com a gestora, fora do GitHub. Na dúvida, pergunte antes de versionar.

## Infra
- **Front:** HTML + JS (ES modules, sem build), GitHub Pages (push na `main` publica). Commits com autor "Andressa Brenneisen".
- **Banco/Auth:** Supabase (plano gratuito — não gerar custos). Chave publicável no `js/core.js` é pública por desenho; a segurança está na RLS.
- **Edge Functions:** `agenda-ics` (calendário iCal por profissional, token em `profissionais.agenda_token`, só iniciais do paciente) e
  `gerir-acesso` (código em `supabase/functions/gerir-acesso/`; só gestor ativo da clínica; cria/edita login, senha, perfil, vínculo e ativo; audita sem a senha).
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
  **13/11/2026:** cada autorização é uma sanfona (`<details>`): linha com senha, situação, alertas (acabando, sem encaminhamento, guia segurada), validade,
  "N de X" e bolinhas por sessão; aberta por padrão só a da próxima sessão agendada (+ botão Abrir todas). Chips exclusivas (`categoria()`):
  **Agendar da ficha:** botão 📅 na linha da senha (não profissional; senha ativa com saldo, ou contrato `senha_por_sessao` → `aut:'nova'` do mesmo procedimento)
  grava `sessionStorage.agendar_para` e abre `#agenda` na semana do profissional; faixa laranja no topo; o modal vem com paciente/plano/senha preenchidos.
  A faixa fica até "Cancelar" ou "Voltar à ficha" (permite marcar várias sessões).
  Abertas · Pendentes · Realizadas · Liberadas p/ faturar (só gestão; aproximação no cliente: guia sem envio, não segurada e no lote/liberada à mão/cheia/vencida) · Histórico · Todas.
- **Cadastro (db/041):** `pacientes.observacao` e `pacientes.alerta` (alerta em destaque na ficha e ao escolher o paciente na agenda);
  boas-vindas por mailto/wa.me com textos `clinicas.config.boas_vindas_texto` (particular) e `boas_vindas_convenio` ({nome} {clinica}).
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

- **Saldo de sessões (db/043, item 31):** `numeracao_sessoes(ids[])` (INVOKER, 1 chamada por tela) → selo "S N/X" no bloco da agenda e linha no modal
  (laranja nas 2 sessões antes da última ou senha vencendo em ≤ 7 dias; vermelho na última/vencida); senha de 1 sessão conta pelo encaminhamento.
  Ficha: barra feitas | agendadas | livres + selo "senha acabando". `pendencias` ganhou "Autorizações — senha acabando" (link `paciente-<id>`).
- **Particular (db/030, `particular.js`):** tabela `recebimentos` (procedimento da tabela PARTICULAR, desconto decidido pelo profissional,
  forma/parcelas, nº da NFS-e emitida no Emissor Nacional gov.br); gatilho lança em `lancamentos` (origem 'particular', categoria/área pelo código).
- **Relacionamento (db/030, `relacionamento.js`):** função `relacionamento(clinica, dias)` → aniversários + reavaliações (`config.relacionamento.reavaliacoes`:
  nome, dias, códigos); modelo opt-out (`consentimento_comunicacao` padrão true, `comunicacao_optout_em` ao pedir para sair; rodapé "responda SAIR").

- **Agenda visual (15/11/2026, inspirada no ZenFisio):** visões Dia · Semana (1 profissional ou todos, atendimentos sobrepostos em faixas lado a lado) · Mês ·
  Lista do dia · Lista da semana; filtros no cliente (status — inclui ver cancelados —, sala, convênio/Particular, serviço, paciente sem acento) guardados em
  `sessionStorage.agenda_vis`. Clique no atendimento abre o **cartão rápido** (`.ag-pop`): dados, sessão N/X, status rápido (Confirmado/Chegou/Faltou),
  **▶ Iniciar atendimento** (só o profissional do atendimento: marca `presente` e abre `#paciente-<id>-prontuario:<at>`), ✓ Atendido (fecha guia), WhatsApp, Detalhes (modal antigo).
  Convênio aparece como "Convênio (Amil)" via `convenio_atendimentos(ids[])` (db/045, DEFINER: só o nome do contrato; equipe vê a clínica, profissional só os seus).
  **Arrastar para remarcar** (dia/semana, mouse ou caneta; no toque usar Detalhes): encaixa no intervalo da agenda, troca de profissional ao soltar em outra coluna
  na visão do dia, checa expediente/pausa, profissional e sala, pede confirmação; confirmado volta a agendado e o lembrete fica desmarcado. Esc cancela.
- **Avaliação por cliques (db/044, item 15, `avaliacao-cliques.js`):** roteiros em chips por modelo — `fisio_avaliacao`, `fisio_esportiva` (novo: modalidade e carga,
  agachamento unipodal, hop test LSI), `soapn` (anamnese → S, última linha AF), `psico_registro`, `medica_consulta` (novo, área `medicina`, CRM). Bandeiras vermelhas
  com aviso, testes especiais por região (1 clique +, 2 −, 3 limpa; teste de região desmarcada sai do texto), PSFS com média. Cada clique regenera o texto nos campos;
  texto digitado à mão não é apagado (`_g` guarda o último texto gerado por campo). Escolhas salvas em `conteudo.cliques`.
  **Evolução rápida (`fisio_evolucao`, 15/11/2026):** campos novos `diag` e `estado`; nº da sessão automático (última evolução + 1); diagnóstico/CID preenchido
  do encaminhamento ativo de fisioterapia (CID + descrição do `cid10.json`) + diagnóstico da última avaliação; região/lado herdados; botão "↻ Repetir condutas da
  última sessão" (região, lado, condutas e detalhes); chips de como chegou / o que foi feito / resposta / próxima, EVA antes→depois.
  **Avaliação podoposturológica (`fisio_podo`, db/046):** modelo separado para baropodometria/palmilha — estática (carga D/E com E calculado, retropé×antepé,
  picos por região e lado, centro de pressão, arco), dinâmica (pisada D/E, marcha, trajetória), postura e mobilidade (joelhos, retropé, hálux, lunge test, Thomas),
  **FPI-6** por pé (6 critérios −2…+2, total e classe calculados: ≤−5 altamente supinado, −4…−1 supinado, 0…+5 neutro, +6…+9 pronado, ≥+10 altamente pronado),
  correlação com a queixa e conduta; aviso de pé em risco (DM/neuropatia + hiperpressão). "Copiar da avaliação anterior" traz motivo/contexto e a conclusão
  ganha a comparação automática (FPI e carga anterior → atual). Avaliação de fisio ganhou profissão, comorbidades, peso/altura/IMC, achados de palpação,
  ADM comparada entre lados, escore de questionário funcional (campo livre; WOMAC é licenciado), objetivos de curto e longo prazo e data da reavaliação.
  **Escanometria (resultado):** bloco `blocoEsc` em `fisio_podo`, `fisio_avaliacao` e `fisio_esportiva` (campo `escanometria`): fêmur/tíbia/altura do pé D/E em cm,
  diferença anatômica, do pé e total em mm (positivo = D maior), distância femorotibial direta e compensação na palmilha. Baropodometria estática ficou opcional:
  os números completos vêm do PDF do BaroScan, anexado ao registro.
- **Solicitação de exame (db/047, `emissao.js`, tipo `solicitacao`):** escanometria pelo método de Farill (medidas em checkbox), RX dos pés em AP com altura
  base–tibiotársica e RX panorâmico da coluna; CID padrão M21.7 com descrição do `cid10.json`; justificativa opcional; texto editável, timbrado e com código.
- **Relacionamento + e-mail (db/048):** `relacionamento()` devolve `email`; botão ✉ E-mail por paciente (mailto) e "E-mail em lote" por item de reavaliação
  (Cco, grupos de 20, texto sem nome). Palmilha 3D = 365 dias em `config.relacionamento.reavaliacoes`. Envio automático exige SMTP da clínica (pendente).

- **Acessos (15/11/2026):** **a gestora tem acesso total** a todas as telas (exceto ler prontuário de outro profissional — sigilo por autor).
  Na tela `#acessos` cria acesso com nome, e-mail (= login), senha provisória (botão Gerar), perfil e profissional vinculado; edita e-mail/senha/perfil/vínculo;
  desativa (bloqueia o login na hora via ban do Auth, se a pessoa não tiver outro vínculo). Não pode rebaixar nem desativar a si mesma.
  Convite por e-mail continua como alternativa; convite pendente pode virar acesso com senha ou ser excluído.

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
