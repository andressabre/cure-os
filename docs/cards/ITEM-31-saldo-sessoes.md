# Item 31 — Saldo de sessões visível + aviso de fim  `[S] Sonnet` · Fable revisa a migração

> Origem: comparação com o ZenFisio (pacotes de atendimento com sessões contratadas), 13/11/2026.
> Entra no **Lote 1 — Piloto fluido** (gatilho: o primeiro atendimento Amil fechado). Esforço: baixo/médio.
> Leia `CLAUDE.md` e a skill `cure-os-dev` antes. 1 card = 1 commit. Próxima migração livre: **db/043**.

## Objetivo (1 frase)
Em qualquer tela onde aparece um atendimento de convênio, mostrar **"sessão N de X"** da senha e avisar antes de acabar o saldo, para ninguém atender sem senha nem esquecer de pedir a próxima.

## O que já existe (não refazer)
- `autorizacoes_paciente` (db/014, em db/000) já devolve `qtd`, `usadas` (atendido) e `agendadas` (agendado/confirmado/presente) por senha.
- `agenda.js` já limita a série ao saldo (linhas ~266–280) e mostra "feitas + agendadas de X" **só no select** do modal.
- `paciente.js` já conta as sessões usadas por autorização e por encaminhamento (`qtd_sessoes`).
- Trava 3292 (sessões esgotadas) continua na `guia_atendimento`: este item **avisa antes**, não substitui a trava.

## Entregas
1. **Agenda — selo no bloco do atendimento** (`agenda.js`): `S 7/10` ao lado do nome do paciente.
   - Cinza = normal · **laranja** = restam ≤ 2 (contando as agendadas) ou a senha vence em ≤ 7 dias · **vermelho** = última sessão da senha ou sessão agendada depois da validade.
   - Atendimento sem `autorizacao_id` em convênio que exige senha: selo `sem senha` (o alerta atual continua).
2. **Modal do atendimento**: uma linha fixa: `Senha 123 · sessão 7 de 10 · restam 3 · vence 20/12`.
3. **Ficha do paciente** (`paciente.js`, bloco da autorização): barra de progresso `feitas | agendadas | livres` sobre `qtd_autorizada`.
4. **Painel de pendências** (`pendencias`): novo tipo **"Senha acabando"**: autorização `autorizada`, vigente, com saldo livre ≤ 2 **ou** validade ≤ 7 dias, **e** o encaminhamento ainda tem sessões previstas (`qtd_sessoes` maior que o total já autorizado nele, ou `qtd_sessoes` nulo). Ação: "Pedir nova autorização" (abre a ficha na aba de autorizações). Aparece para recepção, gestão e o profissional do atendimento.

## Regra de cálculo (escrever igual no SQL e no JS)
- **Número da sessão** = posição do atendimento entre os atendimentos da mesma `autorizacao_id` com status em (`atendido`, `presente`, `confirmado`, `agendado`), ordenados por `inicio`. Cancelado e falta não contam.
- **Restam** = `qtd_autorizada − atendidas − agendadas` (mesma regra de `autorizacoes_paciente`).
- **Operadora com 1 senha por sessão** (Amil fisio, SulAmérica: `qtd_autorizada = 1`): o selo **não** mostra `1/1`. Mostra a posição no **encaminhamento** (`S 4/10`, sobre `encaminhamentos.qtd_sessoes`), somando as senhas ligadas ao mesmo encaminhamento. Se o encaminhamento não tiver `qtd_sessoes`, mostra só `S 4`.
- Limiares (≤ 2 sessões, ≤ 7 dias) como constantes no topo do módulo, não espalhados pelo código.

## Banco — `db/043_saldo_sessoes.sql`
- Função `numeracao_sessoes(p_atendimentos uuid[])` → `(atendimento_id, n, total, restam, validade, base)`, com `base` = 'senha' ou 'encaminhamento'.
  - `SECURITY INVOKER`, `SET search_path = public`, `GRANT EXECUTE ... TO authenticated`, `REVOKE ... FROM anon, public`.
  - Uma chamada por tela (a agenda passa os ids visíveis da semana): **nada de N+1**.
- `pendencias(p_clinica)`: acrescentar o bloco `senha_acabando` **sem mudar** os blocos existentes (usar `CREATE OR REPLACE` copiando a versão atual do banco, não a do repo, porque a produção pode estar à frente).

## Arquivos que PODEM ser tocados
`js/modulos/agenda.js`, `js/modulos/paciente.js`, `js/modulos/painel.js`, `db/043_saldo_sessoes.sql`, `css/` (só as classes do selo), `CLAUDE.md` (1 linha em "Funcionalidades já construídas").

## Regras que NÃO mudam
- 1 senha = 1 guia SP/SADT; a guia só vai ao lote cheia ou com a senha vencida, nunca parcial no fechamento do mês.
- Agendamento de convênio só com autorização vinculada; sem senha vira solicitação pendente + tarefa "Autorizar guia".
- Autorização não fica `autorizada` sem senha e validade.
- A série continua limitada ao saldo; a trava 3292 continua bloqueando na guia.
- O profissional não vê valores; este item não mostra valores.

## Dados e custo
Nenhum valor, CNPJ ou código de prestador no repo. Custo zero (sem API nova).

## Testes (só o que foi tocado)
1. Senha de 10: 6 atendidas + 1 cancelada + 2 agendadas → próxima mostra `S 9/10`, laranja, restam 1.
2. Senha vencendo em 5 dias com 4 livres → laranja + item no Painel.
3. Amil fisio (1 senha/sessão) com encaminhamento de 10: 4ª sessão → `S 4/10`; encaminhamento sem `qtd_sessoes` → `S 4`.
4. Particular → sem selo.
5. Profissional logado vê o selo e a pendência só dos próprios atendimentos (RLS).
6. `get_advisors(security)` + `ferramentas/auditoria-rls.sql` → zero linhas novas.

## Pronto quando
A recepção sabe, olhando só a agenda, quais pacientes precisam de nova senha nesta semana, e o Painel lista "Senha acabando" antes da última sessão.

## Fase 2 (fora deste card)
**31b — Pacote particular pré-pago** (o que o ZenFisio chama de pacote): vender X sessões com valor fechado, baixar uma a cada atendimento e avisar o fim. Usa a mesma função de numeração com `base = 'pacote'`. Só abrir quando houver pacote particular sendo vendido de fato.

**Commit:** `Agenda/ficha/painel: saldo de sessões da senha e aviso "Senha acabando" (db/043)`
