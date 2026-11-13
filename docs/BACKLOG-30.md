# Cure OS — Backlog de 30 melhorias (v1, 10/11/2026)

> Repositório público: este arquivo não contém valores, códigos de prestador, CNPJs de terceiros nem dados de paciente.
> Régua usada: necropsia de 10/11/2026 + os 13 sistemas de referência (Feegow, iClinic, Ninsaúde Apolo, Clínica nas Nuvens,
> GestãoDS, ZenFisio, Shosp, Amplimed, ProDoctor, Prontmed, TOTVS Saúde, Zero Glosa, Benner Conecta).

## 0. Como este backlog é executado (divisão por modelo)

| Papel | Modelo | Faz | Não faz |
|---|---|---|---|
| **Arquiteto / auditor** | Fable 5.1 | Escreve a especificação dos itens marcados `[F]`, revisa toda migração que mexe em RLS/funções, audita cada lote antes do merge, decide trade-offs | Código mecânico, formatação, testes repetitivos |
| **Construtor** | Sonnet 5.5 / Opus 5.5 | Implementa itens `[S]`: módulo + migração + teste do que foi tocado | Mudar regra de negócio sem card aprovado |
| **Braçal** | Haiku 5.5 | Itens `[H]`: exportar esquema, scripts SQL de checagem, testes a partir de casos já escritos, docs, PWA shell, relatórios simples | Tocar em RLS, repasse, guia, XML TISS |

**Card de tarefa (obrigatório para qualquer modelo que for executar um item):**
```
Item: <código do backlog>
Objetivo (1 frase):
Arquivos que PODEM ser tocados: js/modulos/<x>.js, db/0NN_<nome>.sql
Regras que NÃO mudam: (copiar do CLAUDE.md as que tangenciam o item)
Dados: nenhum valor/CNPJ/código de prestador no repo. Custos: zero (Supabase free, sem API paga).
Testes: só do módulo tocado. Rodar get_advisors(security) após migração com função/policy.
Pronto quando: <critério verificável>
Registro: 1 linha em CLAUDE.md (seção do módulo) + "db/0NN" no commit.
```
**Definição de pronto por lote:** Fable revisa o diff, roda o checklist de segurança (`ferramentas/auditoria-rls.sql`, item S5) e só então o lote é considerado fechado.

## 1. Régua de mercado × Cure OS

| Capacidade (quem faz bem) | Cure OS hoje | Lacuna |
|---|---|---|
| Confirmação/lembrete automático por WhatsApp (Feegow, iClinic, ZenFisio) | Link wa.me manual, sem custo | Sem envio automático, sem confirmação de volta |
| Agendamento online pelo paciente (GestãoDS, ZenFisio/BuscaFisio, Feegow) | Não tem | Recepção marca tudo |
| Lista de espera com oferta automática de vaga (Zenvia, Noterro) | Não tem | Cancelamento = buraco na agenda |
| Pacote de sessões com saldo e repetição (ZenFisio) | Série ligada à senha (db/025) | Falta saldo visível no check-in e aviso de fim |
| Importação do demonstrativo e glosa automática (TOTVS, Zero Glosa) | Só XML | Retorno real chega em PDF/planilha |
| Recurso de glosa em XML (Benner, TOTVS) | Não tem | Glosa identificada, mas sem contestação |
| Validação da guia antes do envio (iClinic) | Travas 1814/3292/3209 + XSD | Ponto forte — manter |
| Repasse por profissional com tabela por convênio (GestãoDS) | Precedência contrato+proc (banco) | Ponto forte — manter |
| Conciliação bancária (Feegow) | Não tem | Lançamento "a receber" sem baixa automática |
| Painel/ranking e BI (GestãoDS, Feegow) | `estatisticas.js` básico | Sem visão de glosa × operadora × profissional |
| Portal do paciente / documentos (Amplimed, Physitrack) | Verificação pública de documento | Paciente não acessa nada |
| Assinatura ICP-Brasil (ZenFisio, Prontmed) | Hash SHA-256 + imutável | Fica para depois (custo) |
| Auditoria/LGPD (Amplimed) | Gatilhos só em glosas e prontuário | Sem trilha em guia, atendimento, financeiro, cadastro |

## 2. As 30 melhorias

Legenda: **Eixo** F = fluidez · A = automação · I = inovação · S = segurança. **Esf.** B/M/A = baixo/médio/alto. **Quem** = papel do item 0.

### Segurança e base (fazer primeiro — não mudam o comportamento, destravam o resto)

| # | Melhoria | Eixo | Esf. | Quem | Pronto quando |
|---|---|---|---|---|---|
| 1 | **Esquema base no repo**: exportar o esquema atual (tabelas, funções, policies, triggers, storage) para `db/000_esquema_base.sql`; migrações 002–006 e 008 deixam de ser lacuna | S | B | [H] | Um branch Supabase vazio sobe com 000 + 009..0NN e o app loga |
| 2 | **Checklist de segurança em SQL** (`ferramentas/auditoria-rls.sql`): lista funções executáveis por `anon`, policies sem `TO authenticated`, tabelas sem RLS, buckets públicos | S | B | [H] | Script roda e devolve zero linhas |
| 3 | **Trilha de auditoria genérica**: 1 trigger jsonb (quem, quando, antes, depois) em guias, atendimentos, autorizações, lançamentos, recebimentos, pacientes; registro de **leitura** de prontuário | S | M | [S] | `auditoria` registra abrir/alterar; tela de consulta só para gestão |
| 4 | **Testes de regressão SQL** das regras: 1814, 3292, 3209, senha vencida, guia por sessão, senha por sessão, precedência de repasse, lote cheio × parcial | S | M | [S] (casos) → [H] (script) | `ferramentas/testes.sql` roda em branch e falha se uma regra quebrar |
| 5 | **Restore drill do backup**: 1×/mês restaurar o ZIP do OneDrive num branch Supabase e conferir contagens; alerta no Painel se o último backup > 8 dias | S | M | [S] | Procedimento documentado + aviso automático |
| 6 | **Conta endurecida**: proteção de senha vazada ligada, MFA (TOTP) para gestão, expiração de sessão, convite como único caminho (já em db/025 — confirmar) | S | B | [H] | Login da gestão exige 2º fator |
| 7 | **LGPD operacional**: termo de consentimento digital no cadastro (base legal registrada), exportar "meus dados" do paciente, anonimizar paciente inativo após prazo, política de retenção (prontuário 20 anos) escrita | S | M | [F] spec → [S] | Termo salvo com data/versão; exportação em 1 clique |
| 8 | **Qualidade de cadastro**: mesclar duplicados com prévia (histórico, guias e autorizações vão para o registro mantido); CPF, nascimento e carteirinha exigidos no check-in de convênio | S | M | [S] | Zero nomes duplicados com convênio; glosa 3209 falsa deixa de ocorrer |

### Fluidez (menos cliques por atendimento)

| # | Melhoria | Eixo | Esf. | Quem | Pronto quando |
|---|---|---|---|---|---|
| 9 | **Check-in de 1 tela**: ao marcar "chegou", painel com pendências do atendimento (dado faltando, senha/saldo, guia a assinar, pagamento particular) e botões de resolver ali | F | M | [S] | Atendimento de convênio fecha sem sair da tela |
| 10 | **Painel de pendências por perfil**: recepção (autorizar guia, assinatura faltando), profissional (evolução sem assinar, senha vencendo, reavaliação), gestão (lote a enviar, retorno a conciliar, backup) | F | M | [S] | Cada perfil abre o app na sua lista do dia |
| 11 | **Command palette (Ctrl+K)**: buscar paciente, pular de módulo, ações rápidas ("novo agendamento", "fechar lote") | F | B | [H] | Qualquer tela em ≤ 2 teclas |
| 12 | **Agenda visual**: arrastar e soltar, visão dia/semana por profissional e por sala, cor por status, encaixe | F | M | [S] | Remarcar = arrastar; conflito de sala continua avisando |
| 13 | **Lista de espera com oferta de vaga**: cancelou → sistema lista quem espera aquele profissional/horário e gera mensagem wa.me em 1 clique | F | M | [S] | Vaga cancelada preenchida sem ligação |
| 14 | **Ficha do paciente como linha do tempo**: atendimentos, guias, pagamentos, documentos e (só do autor) prontuário em uma sequência filtrável | F | M | [S] | Histórico completo sem trocar de aba |
| 15 | **Avaliação por cliques → texto** (padrão TocoGO): fisio completa, nutri, psico, com escalas validadas calculadas e parágrafo pronto no prontuário | F | A | [F] spec → [S] | Avaliação de fisio em < 5 min com laudo gerado |
| 16 | **PWA leve**: manifest + service worker cacheando só o shell (nunca dados), ícone no celular, abre offline na tela de login | F | B | [H] | Instalável no celular; Lighthouse PWA ok |

### Automação (tirar trabalho da recepção e da gestão)

| # | Melhoria | Eixo | Esf. | Quem | Pronto quando |
|---|---|---|---|---|---|
| 17 | **Leitor de retorno em PDF/planilha**: extração tabular → mapeamento por operadora salvo como modelo → prévia para conferência → glosas; XML continua como caminho preferencial | A | A | [F] spec → [S] | Retorno real de 2 operadoras importado com conferência humana |
| 18 | **Recurso de glosa em XML TISS** a partir das glosas contestadas (motivo, justificativa, anexos) | A | M | [S] | XML de recurso validado no XSD da ANS |
| 19 | **Extrato OFX/CSV + conciliação**: casar crédito da operadora com "a receber" do lote e PIX/cartão com recebimentos particulares; sobra vira pendência | A | M | [S] | Baixa automática com confirmação; DRE fecha com o banco |
| 20 | **Fechamento mensal em 1 clique**: lotes elegíveis por operadora → XML → checklist de anexos → registrar envio → prévia de repasse → PDF das guias do lote para assinatura | A | M | [S] | Faturamento do mês em uma sessão guiada |
| 21 | **Lembretes em fila diária**: lista "enviar hoje" (48h e 2h antes), 1 clique por paciente (wa.me), marca enviado; evolução opcional para envio automático via Make/n8n + WhatsApp Cloud API quando houver verba | A | B→M | [H] fila → [S] API | Nenhum lembrete esquecido; custo zero na fase 1 |
| 22 | **Confirmação de presença + NPS por link**: página pública mínima (como `verificar.html`) com token único: confirmar / cancelar / nota 0–10 pós-atendimento | A | M | [S] | Status "confirmado" e NPS gravados sem a recepção digitar |
| 23 | **Alertas diários por e-mail (SMTP próprio)**: senha vencendo, saldo de sessões acabando, encaminhamento vencendo, backup atrasado | A | B | [H] | Um e-mail por perfil às 7h com o que vence em 7 dias |
| 24 | **Agendamento online do particular**: página pública com horários livres por profissional, pré-reserva confirmada pela recepção; convênio continua exigindo autorização | A | M | [S] | Paciente novo marca sozinho; agenda não aceita conflito |
| 25 | **Pacote do contador automático**: ZIP mensal (DRE, lançamentos, NFS-e registradas, repasses) gerado e salvo no OneDrive junto com o backup | A | B | [H] | Contador recebe sem a gestora montar |

### Inovação (o que os concorrentes não fazem bem)

| # | Melhoria | Eixo | Esf. | Quem | Pronto quando |
|---|---|---|---|---|---|
| 26 | **Inteligência de glosas**: motivo × operadora × profissional, % recuperado em recurso, prazo médio de pagamento por operadora, top motivos evitáveis | I | M | [S] | Painel orienta o que corrigir no cadastro/guia |
| 27 | **Previsão de caixa**: a receber por lote (prazo contratual de cada operadora) + particular previsto + contas a pagar → curva de 90 dias | I | M | [S] | Gestão vê o caixa de 3 meses à frente |
| 28 | **Assistente de IA fora do prontuário** (opcional, com confirmação humana): sugerir mapeamento de colunas de retorno novo, categoria de lançamento, rascunho de justificativa de recurso de glosa. Nunca recebe dado clínico | I | M | [F] | Cada sugestão mostra fonte e exige "aceitar" |
| 29 | **Portal do paciente mínimo**: próximos agendamentos, documentos timbrados emitidos, confirmar/cancelar, exportar meus dados (liga com 7 e 22) | I | M | [S] | Paciente resolve o básico sem WhatsApp |
| 30 | **Eventos para outros apps**: database webhooks do Supabase → Make/n8n (agendamento criado, lote enviado, glosa identificada) + sync de agenda com Outlook/Google além do ICS | I | B | [H] | Um evento novo chega no Make em < 1 min |

### Acréscimos depois da v1

| # | Melhoria | Eixo | Esf. | Quem | Pronto quando |
|---|---|---|---|---|---|
| 31 | **Saldo de sessões visível + aviso de fim** (vindo do ZenFisio, 13/11/2026): selo "S 7/10" na agenda, linha no modal, barra na ficha e pendência "Senha acabando" no Painel; 1 senha por sessão conta pelo encaminhamento. Card: `docs/cards/ITEM-31-saldo-sessoes.md` | F/A | B-M | [S] · Fable revisa db/043 | ✅ **Feito 13/11/2026** (db/043), sem esperar o piloto Amil, por decisão da gestora |

## 3. Ordem de execução (lotes)

A regra da necropsia continua: **nada de módulo novo antes do piloto Amil fechar um ciclo** (agendar → autorizar → atender → guia → lote → XML → envio → retorno). Os lotes abaixo respeitam isso.

| Lote | Itens | Gatilho para começar | Quem |
|---|---|---|---|
| **0 — Base** (não muda comportamento) | 1, 2, 6, 3 | Agora, em paralelo ao piloto | Haiku (1, 2, 6) · Sonnet (3) · Fable revisa 3 |
| **1 — Piloto fluido** | ~~31~~ (feito), 8, 9, 10, 23, 20 | Primeiro atendimento Amil fechado | Sonnet · Fable revisa 20 |
| **2 — Dinheiro de volta** | 17, 18, 19, 4, 5, 26 | Primeiro retorno real recebido | Fable spec 17 · Sonnet · Haiku script de 4 |
| **3 — Fluidez** | 11, 12, 13, 14, 15, 16 | Lote 2 em uso por 2 semanas | Haiku (11, 16) · Sonnet · Fable spec 15 |
| **4 — Relacionamento e inovação** | 21, 22, 24, 25, 27, 28, 29, 30, 7 | Equipe inteira usando o sistema | Mistura; Fable em 7 e 28 |

## 4. Riscos e contrapontos

- **Custo zero tem teto.** WhatsApp automático, ICP-Brasil e e-mail em volume custam. Os itens foram desenhados com fase 1 gratuita (wa.me, SMTP próprio, página pública) e fase 2 paga só quando houver uso real.
- **Página pública = superfície de ataque.** Itens 22, 24 e 29 expõem endpoints. Token único por link, expiração, rate limit na Edge Function e nenhum dado além do mínimo. Fable audita antes de publicar.
- **Leitor de PDF nunca é 100%.** O item 17 é "prévia + confirmação", não importação cega. Glosa só muda status com a gestora confirmando (regra já existente).
- **Backlog grande vira o mesmo erro da necropsia** (muito construído, pouco usado). O gatilho de cada lote é uso real, não calendário.
- **Teste só do módulo tocado** continua valendo; o item 4 existe para que isso seja seguro.

## 5. Ferramentas e skills a usar

- **Skill `cure-os-dev`** (criar via skill-creator): convenções do CLAUDE.md + card de tarefa + checklist de pronto, para qualquer modelo carregar antes de tocar no repo.
- **GitHub**: repo `andressabre/cure-os` adicionado à sessão com acesso de escrita; 1 commit por item com "db/0NN" na mensagem.
- **Supabase MCP**: `get_advisors(security)` após toda migração; branches para os itens 1, 4 e 5.
- **Make MCP**: itens 21 (fase 2) e 30.
- **Skills existentes**: `dataviz` (26, 27), `modern-web-guidance` (11, 12, 16), `frontend-design` (29).
