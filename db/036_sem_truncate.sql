-- 036 — Remove de anon/authenticated os privilégios de tabela que o app não usa (padrão do Supabase).
-- TRUNCATE ignora RLS; TRIGGER e REFERENCES não têm uso pelo cliente. Achado no Card 1 (10/11/2026).
-- Sem mudança de comportamento: SELECT/INSERT/UPDATE/DELETE continuam controlados pela RLS.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
  end loop;
end $$;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
