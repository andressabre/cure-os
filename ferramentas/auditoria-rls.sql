-- =============================================================================
-- Auditoria de segurança RLS e funções (Cure OS)
-- Somente leitura. Nenhum bloco altera o banco.
-- Regra: após toda migração, get_advisors (security) e este arquivo devem
-- voltar SEM linhas. Cada bloco pode ser rodado sozinho ou em sequência.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Funções em public com EXECUTE para anon ou public (exceto verificar_documento)
-- Uma linha = a função pode ser chamada por visitante anônimo (ou por PUBLIC,
-- que inclui anon). Função de uso interno ou com RLS própria não deve aparecer.
-- Correção esperada: REVOKE EXECUTE ... FROM anon, public (em migração própria).
-- -----------------------------------------------------------------------------
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       CASE WHEN a.grantee = 0 THEN 'public' ELSE r.rolname END AS papel
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
LEFT JOIN pg_roles r ON r.oid = a.grantee
WHERE a.privilege_type = 'EXECUTE'
  AND (a.grantee = 0 OR r.rolname = 'anon')
  AND p.proname <> 'verificar_documento';


-- -----------------------------------------------------------------------------
-- 2. Funções SECURITY DEFINER em public sem SET search_path
-- Uma linha = a função roda com privilégios do dono e sem search_path fixo,
-- o que permite sequestro de nomes por objetos em outro schema.
-- Correção esperada: ALTER FUNCTION ... SET search_path = public.
-- -----------------------------------------------------------------------------
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS argumentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%'
      );


-- -----------------------------------------------------------------------------
-- 3. Tabelas em public com RLS desligada OU sem nenhuma policy
-- Uma linha = a tabela fica exposta pela API (ou, com RLS ligada e sem policy,
-- fechada para todos, o que também quebra o app). 'politicas' mostra quantas
-- policies existem. Tabelas de apoio sem dados sensíveis precisam de justificativa.
-- -----------------------------------------------------------------------------
SELECT c.relname,
       c.relrowsecurity AS rls_ligada,
       (SELECT count(*) FROM pg_policies pol
          WHERE pol.schemaname = 'public' AND pol.tablename = c.relname) AS politicas
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND (
        NOT c.relrowsecurity
        OR NOT EXISTS (
             SELECT 1 FROM pg_policies pol
             WHERE pol.schemaname = 'public' AND pol.tablename = c.relname)
      );


-- -----------------------------------------------------------------------------
-- 4. Policies (public e storage) cujo roles não é exatamente {authenticated}
-- Uma linha = a policy vale para outro papel (anon, public ou um conjunto
-- diferente). Regra do projeto: políticas sempre TO authenticated.
-- -----------------------------------------------------------------------------
SELECT schemaname,
       tablename,
       policyname,
       roles
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND NOT (roles = ARRAY['authenticated']::name[]);


-- -----------------------------------------------------------------------------
-- 5. Buckets do Storage com public = true
-- Uma linha = qualquer pessoa com a URL lê os arquivos do bucket, sem login.
-- Documentos clínicos e financeiros devem ficar em buckets privados.
-- -----------------------------------------------------------------------------
SELECT id,
       name,
       public
FROM storage.buckets
WHERE public = true;


-- -----------------------------------------------------------------------------
-- 6. Funções de uso interno com EXECUTE para authenticated
-- Funções: calcular_repasse, situacao_guia_lote, contrato_exige_senha.
-- Uma linha = usuário logado pode chamar diretamente uma função que só deve
-- rodar dentro do banco (gatilhos e outras funções). Correção esperada:
-- REVOKE EXECUTE ... FROM authenticated.
-- -----------------------------------------------------------------------------
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS argumentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE a.privilege_type = 'EXECUTE'
  AND r.rolname = 'authenticated'
  AND p.proname IN ('calcular_repasse', 'situacao_guia_lote', 'contrato_exige_senha');


-- -----------------------------------------------------------------------------
-- 7. Views em public sem security_invoker ligado
-- Uma linha = a view roda com o dono da view e ignora a RLS de quem consulta,
-- podendo expor linhas de outras clínicas. Correção esperada:
-- ALTER VIEW ... SET (security_invoker = true).
-- Materialized views não suportam essa opção e não entram aqui.
-- -----------------------------------------------------------------------------
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
  AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(c.reloptions, '{}'::text[])) o
        WHERE o IN ('security_invoker=true', 'security_invoker=on')
      );
