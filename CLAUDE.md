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
  `repasse`, `extrato`, `painel`, `estatisticas`, `financeiro`, `backup`, `documentos` (Storage), `guia-impressa`, `prontuario`, `emissao`, `acessos`,
  `hoje`, `paleta`, `linha-tempo`, `previsao`, `glosas-intel`, `espera`, `conciliacao` + `extrato-banco` (ver "Módulos e ferramentas novos"); `js/pwa.js` registra o service worker.
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
  **15/11/2026:** nova aba **Avaliações** (`abaAvaliacoes`, mesmo `prontuario.js`, conjunto `AVALIACOES`): dinamometria, avaliação postural (SAPO), podoposturológica e projeto de palmilha 3D
  saem da aba Prontuário (mesma tabela e RLS por autor; só a tela separa). Atendimento com avaliação ligada não conta como "sem evolução".
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
  **Carteiras (db/051, 15/11/2026):** `carteiras` (1 `empresa` + `pessoal` por sócio); `lancamentos.carteira_id` e `contas_financeiras.carteira_id`
  (trigger `carteira_padrao` põe a empresa quando vem vazio: repasse, lote, particular). RLS: pessoal só `gestor` (os sócios veem as duas pessoais);
  `financeiro` só a empresa. Categorias com `uso` empresa|pessoal ("Casa – …"). Carteira pessoal não tem DRE nem repasse. Seletor em chips no topo do módulo.
  **Recorrência:** `recorrencia` fixa (com `reajuste_mes` → selo "reajuste?" naquele mês) ou media (`media_meses`; trigger `reprojetar_media` refaz os
  previstos futuros não confirmados pela média dos últimos N confirmados/pagos); `valor_confirmado` = fatura chegou; "aplicar às próximas" e "+12 meses" no editar.
  **Anexos:** bucket privado `financeiro` (`<clinica>/<empresa|pessoal>/<lançamento>/…`, 5 MB, fotos reduzidas a 1600 px JPEG no navegador;
  `pasta_financeiro_ok`: pessoal só gestor); colunas `fatura_arquivo` e `comprovante_arquivo`; comprovante também na baixa.
  **Contas (Cadastros):** + Conta, Editar e **Excluir** (17/11/2026): excluir só se a conta não tem lançamento, movimento de extrato nem contrato apontando para ela (checagem no cliente; as FKs de `lancamentos` e `extrato_movimentos` também barram no banco); com uso, desmarcar "Ativa".
- **Chave Gestão ↔ Profissional (15/11/2026):** quem é gestor/financeiro E tem profissional vinculado vê a chave no menu lateral (`#chave-modo`).
  `estado.perfilReal` guarda o perfil de verdade; `aplicarModo()` troca `estado.perfil` para 'profissional' no modo profissional (menu, agenda,
  ficha e `podeGerir()` passam a se comportar como profissional). Só muda a tela — a RLS continua pelo perfil real. Modo salvo em `localStorage.modo_<user>`.
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
- **Avaliação postural por foto — SAPO (db/049, `avaliacao-postural.js`, modelo `fisio_postural`):** 4 vistas (anterior, posterior, laterais D/E); foto no bucket
  `prontuario` (pasta do autor → só ele vê); marcação guiada ponto a ponto com lupa, arrastar para ajustar, pular ponto; fio de prumo com 2 marcas corrige a vertical e dá
  escala em cm (padrão 100 cm). Medidas pelas definições da documentação SAPO (Duarte/Ferreira 2005): alinhamentos horizontais (tragos, acrômios, EIAS, tíbias),
  acrômios×EIAS, ângulo frontal do MI (valgo/varo), ângulo Q (SAPO trocânter–tuberosidade–patela + clássico EIAS–patela–tuberosidade), IA dos MMII (EIAS–maléolo medial,
  + cm), IA escápulas×T3, perna/retropé (valgo/varo), laterais (trago–C7, acrômio–trago, tronco, quadril, corpo, pelve EIAS–EIPS, joelho flexo/recurvato, tornozelo).
  Sem ponto de corte normal/anormal (só direção em palavras). Texto vai para anterior/posterior/lateral/conclusão (mantém texto digitado); conclusão lista os 5 maiores
  desvios + comparação com a avaliação postural anterior (`conteudo.sapo.med`). "🖨 Laudo com fotos" (editor e registro) monta PDF com fotos anotadas, tabela e referências.
  Foto trocada/cancelada fica órfã no Storage (sem política de delete no bucket); backup ZIP não leva as fotos.
- **Avaliação por dinamometria (db/054, `avaliacao-dinamometria.js` + `anatomia.js`, modelo `dinamometria`, todas as áreas):** preensão palmar (3 tentativas/mão,
  maior valor entre as mãos; EWGSOP2 < 27/16 kgf e AWGS2 < 28/18; MDC95 por aparelho de Akgün 2026 — sem MDC próprio usa 5,87 kg; outro aparelho = não compara) e
  segmentar isométrica (assimetria = (maior − menor)/maior, faixas pelo % arredondado ≤ 10 leve / 11–14 moderada / ≥ 15 alta; LSI do lado acometido; I/Q do joelho sem corte).
  Estado em `conteudo.dina`; texto gerado nos campos preensao/segmentar/conclusao. "🖨 Laudo premium" (A4 timbrado). Mapa = **atlas anatômico vetorial próprio**
  (`anatomia.js`: masculino/feminino pelo `pacientes.sexo`, vistas anterior/posterior; músculo → máscara colorida pela pior classe; profundos tracejados;
  mapa movimento→músculos em `MUSCULOS`). Anterior: D do paciente à esquerda de quem olha; posterior: D à direita.
- **Projeto de palmilha 3D (db/055, `palmilha3d.js` + `palmilha3d-motor.js`, modelo `fisio_palmilha3d`, aba Avaliações):** escaneamento .obj do Sense por pé
  → processado **no navegador** (PCA, mapa plantar 1 mm, nivelamento pelos apoios, medial +y) e guardado compactado (`.obj.gz`) no bucket `prontuario`
  (pasta do autor); `conteudo.palmilha` = { pes{dir,esq: arquivo/nome/medidas}, proj{molde, numero_br, largura, parametros, ajustes[], borda_arredondada_mm},
  resultado }. Reabrir o registro gera de novo a mesma palmilha. **Contorno = moldes próprios** (curva contínua por Fourier; tênis feminino/masculino,
  infantil, chinelo +8 mm) escalados pelo nº BR (comprimento = (BR+2)/1,5 cm), largura estreita/normal/larga (−4/+6% no antepé), alinhados ao eixo do pé.
  **Espessura** = base (calcanhar→antepé→ponta) + preenchimento do arco × fator, com tetos por região (calibrado em 21 pares escaneamento × palmilha aprovada:
  erro ≈ 1,1 mm no interior; contorno ≈ 97% do desenho aprovado). 19 ajustes posicionados pelos pontos anatômicos automáticos (1º/5º meta, calcâneo) e
  **arrastáveis no mapa 2D** (dx/dy); preenchimento % por ajuste → STL de zona para usar como modificador no fatiador. **Alertas em vermelho:** elemento invade
  a planta > 4 mm, espessura < 2 mm (TPU bico 0,6), pé fora do contorno > 6 mm, cunha > 6°, calço > 10 mm. Malha fechada (poly2tri via jsdelivr) checada
  antes do download; visualização 3D com three.js (jsdelivr). Protocolos de partida no código + protocolos da clínica em `clinicas.config.palmilha_protocolos`
  (só a gestão grava). Texto gerado no campo `prescricao` (mantém o que foi digitado).
- **Solicitação de exame (db/047, `emissao.js`, tipo `solicitacao`):** escanometria pelo método de Farill (medidas em checkbox), RX dos pés em AP com altura
  base–tibiotársica e RX panorâmico da coluna; CID padrão M21.7 com descrição do `cid10.json`; justificativa opcional; texto editável, timbrado e com código.
- **Relacionamento + e-mail (db/048):** `relacionamento()` devolve `email`; botão ✉ E-mail por paciente (mailto) e "E-mail em lote" por item de reavaliação
  (Cco, grupos de 20, texto sem nome). Palmilha 3D = 365 dias em `config.relacionamento.reavaliacoes`. Envio automático exige SMTP da clínica (pendente).

- **Acessos (15/11/2026):** **a gestora tem acesso total** a todas as telas (exceto ler prontuário de outro profissional — sigilo por autor).
  Na tela `#acessos` cria acesso com nome, e-mail (= login), senha provisória (botão Gerar), perfil e profissional vinculado; edita e-mail/senha/perfil/vínculo;
  desativa (bloqueia o login na hora via ban do Auth, se a pessoa não tiver outro vínculo). Não pode rebaixar nem desativar a si mesma.
  Convite por e-mail continua como alternativa; convite pendente pode virar acesso com senha ou ser excluído.

- **Profissional por área (db/052, 15/11/2026):** profissional vê **todos os pacientes** da clínica (menu Pacientes, sem "+ Paciente"), todos os
  encaminhamentos e os vínculos de convênio; **autorizações só da sua área** (`minhas_areas()` pela especialidade — fisio cobre palmilha —
  ou feitas em seu nome) na RLS e em `autorizacoes_paciente`; o sócio no modo profissional recebe o mesmo filtro no cliente (`areasDaEspecialidade` no core).
  **Agenda:** profissional cria agendamento só para si (`prof_cria_atendimentos`), com serviços de `SERVICOS_DA_AREA`, série e nova solicitação de senha
  (`prof_cria_autorizacoes`, status pendente/autorizada); agendamento existente segue só leitura para ele (status e observação). Conflito de sala/horário
  vem de `ocupacao_agenda()` (DEFINER, sem dados de paciente). Botão 📅 da ficha liberado para o profissional.
- **Profissionais responsáveis (db/053, 15/11/2026):** `pacientes.profissionais_resp uuid[]` (vários por paciente); trigger `incluir_responsavel`
  em `atendimentos` acrescenta o profissional ao agendar; histórico preenchido por atendimentos + prontuário; editável no cadastro (gestão/recepção).
  Pacientes tem filtro "Meus pacientes" para quem tem profissional vinculado. Ainda NÃO restringe a visão (decisão 15/11/2026: prontuário já é por autor).
- **Trava de senha (db/050, 15/11/2026):** gatilho `trava_autorizada_sem_senha` em `autorizacoes`: status `autorizada` em contrato que exige senha
  (`contrato_exige_senha`) precisa de senha, data da autorização e validade (validade ≥ data). Particular/sem_tiss isentos; só checa quando status/senha/data/validade mudam.

- **Excluir cadastro (db/058, 16/11/2026):** botão "🗑 Excluir cadastro" na ficha (Cadastro, gestão/recepção/financeiro) → `paciente_vinculos` (conta atendimentos, prontuário,
  documentos, recebimentos, encaminhamentos e autorizações) e `excluir_paciente` (DEFINER; só apaga paciente sem histórico, senão orienta a desativar). O DELETE direto
  apagaria planos/autorizações em cascata. Cadastro novo avisa se já existe paciente com o mesmo nome (`pacientes.js`).

- **Gerar SADT (db/059, 16/11/2026, `sadt.js`):** botão "🖨 Gerar SADT" na autorização (gestão; só com nº da guia da operadora e contrato com `regras.autorizacao.modelo_sadt`).
  Preenche o modelo em branco da operadora (`modelos/sadt-<modelo>.pdf` + `.layout.json` com a geometria das caixas) com pdf-lib (jsdelivr), no navegador, e guarda o PDF
  no paciente (slot `guia_arquivo` de todas as linhas da mesma guia). Campos 4–6 (data/senha/validade) ficam em branco como no portal; campo 7 = nº da guia da operadora;
  execução (36–57) e totais em branco. `autorizacoes.numero_guia_prestador` (campo 2) vem de `numero_guia_prestador_aut` (sequencial por contrato, máximo + 1).
  Registro ANS, código do prestador, CNES e nome do prestador vêm de `contratos.regras.autorizacao` (nunca no código). Novo modelo = PDF + layout + `modelo_sadt` no contrato.
  **Uma guia = um bloco (16/11/2026):** na ficha, autorizações do mesmo plano com o mesmo nº de guia da operadora (ou mesma senha) aparecem numa sanfona só, procedimentos lado a lado (`agrupa`/`catGrupo` em `paciente.js`); um único 🖨 Gerar SADT.

### Módulos e ferramentas novos (backlog, 16/11/2026)
- **Hoje (`hoje.js`, rota `#hoje`, itens 10 e 21):** central do dia de cada perfil. Seções que carregam cada uma sozinha (falha ou falta de permissão só faz a seção sumir):
  atendimentos de hoje (com atalho para a agenda), lembretes de amanhã por link wa.me (não aparece para profissional; réplica do texto da agenda, que não exporta a função),
  autorizações aguardando senha, evoluções em aberto e avisos (só quem tem profissional vinculado), pendências (só gestão, link para o Painel) e aniversariantes
  (não profissional; mesmo texto e rodapé "responda SAIR" do `relacionamento.js`). Sócio no modo profissional enxerga como profissional.
- **Busca Ctrl+K / Cmd+K (`paleta.js`, `iniciarPaleta`/`abrirPaleta` no `main.js`):** paleta de comandos com elemento próprio no `<body>` (não usa `modal()`). Pula para qualquer
  tela que o perfil enxerga (a lista vem das `ROTAS` já filtradas), executa ações rápidas (novo agendamento, Hoje, alterar senha) e busca paciente a partir de 2 letras. Não guarda nome de paciente: só os ids das últimas telas usadas (`localStorage`) para ordenar.
- **Linha do tempo do paciente (`linha-tempo.js`, `renderLinhaTempo(elemento, pacienteId)`, backlog 14):** aba da ficha (`linhatempo()` em `paciente.js`) que junta atendimentos,
  autorizações, encaminhamentos, documentos, registros de prontuário (SÓ tipo e data, nunca o texto) e, para a gestão, pagamentos e guias, numa sequência única (próximos × passados).
  Cada fonte é tolerante a erro (consulta negada ou falha → a fonte fica de fora, sem erro na tela). Chips por tipo + busca livre, filtro lembrado por paciente.
  As funções puras (`montarEventos`, `resumir`, `agrupar`…) não importam o `core.js` (que carrega o Supabase pela rede), por isso testam em node; datas em horário de Brasília.
- **PWA (`manifest.webmanifest`, `sw.js`, `js/pwa.js`):** app instalável com abertura da tela de login sem internet. O service worker é REDE PRIMEIRO só para arquivos do próprio site
  (telas, scripts, estilos, imagens) e guarda cópia para o offline; nunca toca em Supabase, fontes ou CDN (dado de paciente não passa por ele). Não existe modo offline de dados.
  Mudar `VERSAO` em `sw.js` descarta o cache antigo. O registro é silencioso (nunca mostra aviso).
- **Previsão de caixa (`previsao.js`, rota `#previsao`, item 27 + recebíveis dos convênios):** só gestor e financeiro, só a carteira EMPRESA (nunca as pessoais dos sócios), somente leitura.
  Curva do saldo dia a dia em 30/60/90 dias: saldo de hoje = mesma conta da aba Caixa do Financeiro (saldo inicial + baixas por conta ativa); entradas e saídas = lançamentos previstos;
  lotes TISS enviados e não pagos entram como recebíveis. Cenários na tela: convênios atrasam N dias e glosa esperada em % (inicia pela taxa histórica das linhas `da_clinica`
  do retorno); valem só para convênio e nada é gravado. Pontos de atenção (dias de aperto, maior saída do período) e CSV. Matemática em funções puras exportadas (centavos inteiros).
- **Inteligência de glosas (`glosas-intel.js`, rota `#glosas`, item 26):** só gestão (`podeGerir`), só linhas `da_clinica` do retorno. Perda por motivo × convênio × procedimento × profissional
  (matriz), evolução por período (3/6/12 meses ou tudo), 5 motivos de maior valor com a ação de prevenção que o sistema já sustenta, glosas pendentes com prazo de recurso vencido ou nos
  próximos 15 dias, % recuperado nos recursos e tempo até o demonstrativo, com CSV. Cálculos em funções puras exportadas; o `core.js` só é importado dentro de `render()`.
- **Lista de espera (`espera.js`, rota `#espera`, item 13, db/057 aplicada em 16/11/2026):** tabela `lista_espera` (paciente, profissional ou "qualquer", serviço, dias da semana, período,
  urgência, situação aguardando/ofertado/agendado/desistiu). Cancelamento futuro → a tela mostra quem espera aquele profissional/serviço (função pura de combinação: ignora o próprio
  paciente que cancelou e devolve a fila já em ordem), monta a mensagem wa.me (`config.espera_texto` ou texto padrão; placeholders {nome} {servico} {profissional} {dia} {hora})
  e marca "ofertado"; "Já agendei" passa pela faixa da agenda (`sessionStorage.agendar_para`). RLS: gestor/recepção/financeiro em tudo; profissional vê a fila da clínica e cria/altera só
  entradas em seu nome (sem excluir: usa "desistiu"). Auditoria genérica ligada.
- **Conciliação bancária (`conciliacao.js` + `extrato-banco.js`, rota `#conciliacao`, gestor e financeiro, item 19, db/056 aplicada em 16/11/2026; T1–T4 do arquivo, advisors e `auditoria-rls.sql` conferidos):**
  tabela `extrato_movimentos` (conta, data, valor com sinal, `id_banco`, situação pendente/conciliado/ignorado, `lancamento_id`, `baixa_anterior`, `lancamento_criado`), RLS espelhando
  `gestao_lancamentos` (gestor tudo; financeiro só conta de carteira da empresa; pessoal só gestor) e auditoria genérica. Importa OFX (SGML ou XML, UTF-8 ou windows-1252) ou CSV (separador e
  preâmbulo detectados, sinal ou colunas crédito/débito, mapeamento manual de colunas quando não reconhece), até 5 MB; deduplica por `(conta_id, id_banco)` (FITID ou hash da linha); mostra
  prévia antes de gravar e confronta o saldo do arquivo com o saldo do sistema na conta. Sugestão (funções puras em `extrato-banco.js`): valor igual e vencimento a até 5 dias = "certo";
  valor menor em lançamento de lote = "provável" (possível glosa, confira no retorno); empate = "escolher"; um lançamento só é "certo" para UM movimento. **Nenhuma baixa sem clique:**
  Confirmar (pede confirmação se houver diferença), Confirmar todos os certos, Escolher outro, Criar lançamento (nasce pago, `origem='extrato'`) e Ignorar; Desfazer devolve o lançamento ao
  estado guardado em `baixa_anterior` só se ninguém mexeu depois. A baixa são 2 gravações no cliente (lançamento e movimento), com reversão da primeira se a segunda falhar (não é transação).
  Em banco sem a 056 a tela mostra `faltaBanco`. Testes: `node ferramentas/testes-js/extrato-banco.test.mjs` (leitores e sugestão, em node) e teste de tela com `fixtures-conciliacao.js` +
  `passos-conciliacao.mjs` (importa OFX com dedupe, ignora, confirma com e sem diferença, cria lançamento, desfaz; confere o que foi gravado).
- **Teste de tela sem rede (`ferramentas/teste-tela/`, `rodar.mjs`):** abre o app num Chrome sem cabeça (Playwright) trocando o cliente Supabase por `sb-falso.js` e falha em erro de JavaScript,
  `console.error` ou toast de erro. Uso: `node ferramentas/teste-tela/rodar.mjs <rota> [--perfil …] [--fixtures ferramentas/teste-tela/fixtures-<modulo>.js] [--modulo js/modulos/x.js]
  [--script passos.mjs] [--escritas] [--texto] [--shot arq.png]` (caminho das fixtures é a partir da raiz do repositório). `fixtures-base.js` + uma fixture por módulo; RPC sem fixture devolve erro
  (aviso de que falta). Testar só o módulo tocado. NÃO testa RLS (isso é SQL) e nunca leva dado real de paciente.
- **Testes SQL de regressão (`ferramentas/testes-sql/regressao-guia.sql`, item 4):** um bloco `DO` que cria uma clínica de teste isolada, roda os casos de guia, autorização, liberação e repasse
  e SEMPRE termina com `raise exception 'RELATORIO …'`: o erro final é proposital, desfaz tudo e traz o resultado (bom = `RELATORIO: 0 falha(s)`). Roda inteiro de uma vez no SQL Editor ou por
  `execute_sql`. Rodar depois de qualquer migração que toque `guia_atendimento*`, `calcular_repasse`, `situacao_guia_lote`, `contrato_exige_senha` ou a trava de autorização.
- **`faltaBanco(error, c, migracao)` no `core.js`:** tela nova cuja tabela ainda não existe no banco (migração escrita em `db/`, não aplicada) mostra o cartão "Falta um passo para ligar esta tela"
  com o nome da migração, em vez de erro. Devolve `true` quando o erro é tabela inexistente (`PGRST205`/`42P01`) e a tela deve parar; nos outros erros devolve `false`. Permite subir a tela
  antes de a gestora aprovar a migração.

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
auditoria de bugs por módulo (agenda, paciente, tiss-xml, lotes, financeiro — um módulo por conversa).
Testes SQL de regressão das regras de guia: feitos (`ferramentas/testes-sql/regressao-guia.sql`).
