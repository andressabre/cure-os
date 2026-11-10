# Lote 0 — cards de execução (itens 1, 2, 6, 3 do BACKLOG-30)

Leia `CLAUDE.md` e a skill `cure-os-dev` antes. Ordem: 1 → 2 → 6 → 3. Cada card = 1 commit. Nenhum card muda o comportamento do app para o usuário.
Próxima migração livre: **db/034**. Projeto Supabase: usar o MCP (`list_tables`, `execute_sql`, `apply_migration`, `get_advisors`, `create_branch`).

---

## Card 1 — Esquema base no repositório  `[H] Haiku`

**Objetivo:** gravar em `db/000_esquema_base.sql` o esquema completo do banco de produção, para que um banco novo seja recriável só a partir do repo.

**Arquivos que PODEM ser tocados:** `db/000_esquema_base.sql` (novo), `CLAUDE.md` (1 linha na seção `db/`).

**Como fazer:**
1. Via MCP Supabase, extrair com `execute_sql` (schema `public` + `storage` buckets/policies), nesta ordem: extensões → tipos/enums → tabelas (colunas, defaults, constraints, FKs) → índices → funções (`pg_get_functiondef`) → triggers → policies (`pg_policies`) → grants/revokes (`information_schema.role_routine_grants`) → buckets do Storage e suas policies → trigger em `auth.users` (`antes_criar_usuario`).
2. Montar o arquivo com cabeçalho: data da extração, "gerado a partir da produção; substitui 001–033 para bancos novos; não aplicar em banco existente".
3. **Remover do arquivo qualquer dado**: só DDL, zero `INSERT`. Conferir com `grep -i "insert\|copy" db/000_esquema_base.sql` → vazio.
4. Validar: `create_branch` no Supabase → aplicar o 000 no branch → `list_tables` bate com a produção (mesmas tabelas e contagem de colunas) → `delete_branch`.

**Regras que NÃO mudam:** nenhuma (só leitura da produção).
**Proibido:** `INSERT`, valores de `contratos`/`regras_repasse`, códigos de prestador em comentários.
**Pronto quando:** branch vazio sobe com `000` e `list_tables` é idêntico; `grep insert` vazio; linha no CLAUDE.md: "`db/000_esquema_base.sql` = esquema completo extraído em DD/MM/AAAA; migrações seguintes partem dele".
**Commit:** `db: esquema base extraído da produção (db/000)`

---

## Card 2 — Checklist de segurança em SQL  `[H] Haiku`

**Objetivo:** criar `ferramentas/auditoria-rls.sql`, um script de leitura que devolve **zero linhas** quando o banco está conforme.

**Arquivos que PODEM ser tocados:** `ferramentas/auditoria-rls.sql` (novo), `CLAUDE.md` (1 linha na seção Segurança).

**O script deve listar (uma query por bloco, com comentário do que significa):**
1. Funções em `public` com EXECUTE para `anon` ou `public`, exceto `verificar_documento`.
2. Funções `SECURITY DEFINER` sem `SET search_path`.
3. Tabelas de `public` com RLS desligada ou sem nenhuma policy.
4. Policies cujo `roles` não seja exatamente `{authenticated}`.
5. Buckets do Storage com `public = true`.
6. Funções marcadas como "só uso interno" no CLAUDE.md (`calcular_repasse`, `situacao_guia_lote`, `contrato_exige_senha`) com EXECUTE para `authenticated`.
7. Views em `public` com `security_invoker` desligado.

**Como validar:** rodar na produção via `execute_sql`. Se alguma query devolver linhas, **não corrigir**: registrar o resultado no PR/commit e avisar (correção é do Fable ou de card próprio).

**Pronto quando:** script roda sem erro; cada bloco tem comentário; linha no CLAUDE.md: "Após toda migração: `get_advisors` (security) + `ferramentas/auditoria-rls.sql` devem voltar vazios".
**Commit:** `ferramentas: checklist de segurança RLS/funções (auditoria-rls.sql)`

---

## Card 6 — Conta endurecida  `[H] Haiku` (parte no painel Supabase é da gestora)

**Objetivo:** fechar o que ainda está aberto no login.

**Arquivos que PODEM ser tocados:** `db/034_conta_endurecida.sql` (só se precisar), `js/main.js` (apenas o bloco de login), `CLAUDE.md`.

**Passos:**
1. Confirmar via `execute_sql` que o trigger `antes_criar_usuario` existe em `auth.users` e recusa e-mail sem convite. Se existir, não mexer.
2. Confirmar na tela de login que não há mais caminho "Primeiro acesso"/cadastro livre; se houver, remover o botão e a função associada em `js/main.js` (só isso).
3. Entregar à gestora um checklist de 3 itens para fazer no painel Supabase (não dá para fazer por MCP): **Auth → Password → "Leaked password protection" ON**; **Auth → Sessions → tempo de sessão 12 h**; **Auth → MFA (TOTP) habilitado**.
4. Se MFA for habilitado, adicionar em `js/main.js` o fluxo mínimo de enrolar/verificar TOTP **só para perfil gestão** (`supabase.auth.mfa.enroll/challenge/verify`), atrás de um botão "Ativar 2º fator" na tela de acessos. Sem biblioteca nova.

**Regras que NÃO mudam:** convite como único caminho de criação de conta; políticas `TO authenticated`.
**Pronto quando:** sem botão de cadastro livre; gestora confirma os 3 itens do painel; login da gestão pede TOTP; `get_advisors` limpo.
**Commit:** `auth: cadastro só por convite confirmado, MFA para gestão (db/034 se houver)`

---

## Card 3 — Trilha de auditoria genérica  `[S] Sonnet/Opus · revisão obrigatória do Fable antes do merge`

**Objetivo:** registrar quem/quando/antes/depois em todas as tabelas de negócio e registrar leitura de prontuário, reaproveitando a tabela `auditoria` já existente (`clinica_id, user_id, tabela, registro_id, acao, dados, em`).

**Arquivos que PODEM ser tocados:** `db/035_auditoria_generica.sql` (novo), `js/modulos/prontuario.js` (só a chamada de leitura), `js/modulos/painel.js` ou novo `js/modulos/auditoria.js` (tela de consulta, só gestão), `js/main.js` (rota + menu, 2 linhas), `CLAUDE.md`.

**Especificação (Fable):**
1. Função única `auditar()` `SECURITY DEFINER`, `SET search_path = public`, sem EXECUTE para `anon`/`authenticated` (só trigger a chama):
   - `acao` = `TG_OP` (`INSERT`/`UPDATE`/`DELETE`); `registro_id` = `NEW.id`/`OLD.id` em texto; `clinica_id` = `coalesce(NEW.clinica_id, OLD.clinica_id)`; `user_id` = `auth.uid()`.
   - `dados` = `{"antes": <OLD sem campos grandes>, "depois": <NEW sem campos grandes>, "campos": [nomes alterados]}`; em UPDATE gravar só as colunas que mudaram (comparar `to_jsonb(OLD) - to_jsonb(NEW)`), ignorando `atualizado_em`.
   - Não gravar nada se UPDATE não mudou nenhuma coluna relevante.
2. Triggers `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW` em: `guias`, `guia_itens`, `atendimentos`, `autorizacoes`, `lancamentos`, `recebimentos`, `pacientes`, `paciente_planos`, `contratos`, `contrato_tabela`, `regras_repasse`, `lotes`, `retornos`, `glosas`. **Não** colocar em `prontuario*` (já tem gatilho próprio e conteúdo clínico não entra na auditoria).
3. Leitura de prontuário: função `registrar_leitura_prontuario(registro_id uuid)` (`SECURITY DEFINER`, EXECUTE só `authenticated`) que insere `acao='LEITURA'`, `tabela='prontuario'`, `dados={}`; chamada em `prontuario.js` ao abrir um registro. Nunca inclui texto clínico.
4. RLS da `auditoria`: `SELECT` só para perfil gestão da própria clínica; ninguém faz `UPDATE`/`DELETE` (sem policy = negado).
5. Tela (gestão): filtros por tabela, usuário, período e `registro_id`; mostra `campos` alterados e o antes/depois em duas colunas; paginação de 100.
6. Retenção: nada apaga por enquanto; anotar no CLAUDE.md que a tabela cresce e que a limpeza é decisão futura.

**Regras que NÃO mudam:** profissional não vê auditoria; glosa continua só mudando status com a gestora; prontuário imutável.
**Testes (só do que foi tocado):** 1 UPDATE em `pacientes` (telefone) gera 1 linha com `campos=['telefone']`; UPDATE sem mudança não gera linha; abrir um prontuário gera `LEITURA`; usuário de perfil profissional não consegue `select` em `auditoria`; `get_advisors` (security) e `ferramentas/auditoria-rls.sql` vazios.
**Pronto quando:** testes acima passam na produção após `apply_migration`; linha no CLAUDE.md na seção Segurança; commit.
**Commit:** `auditoria: trilha genérica antes/depois + leitura de prontuário + tela da gestão (db/035)`
