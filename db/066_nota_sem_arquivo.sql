-- 066 — Nota fiscal do profissional sem anexo: guarda só os dados para consultar no site do governo (chave de acesso da NFS-e).
-- Motivo: arquivos pesam no plano gratuito do Supabase. Tabela estava vazia na aplicação (23/11/2026).
-- Remove o bucket privado `notas-prof`, suas políticas e a função de pasta (criados na 065).

drop policy if exists notas_prof_ler on storage.objects;
drop policy if exists notas_prof_enviar on storage.objects;
drop policy if exists notas_prof_apagar on storage.objects;
drop function if exists pasta_nota_prof_ok(text);
do $$ begin
  delete from storage.buckets where id = 'notas-prof';
exception when others then
  raise notice 'bucket notas-prof mantido vazio (remoção direta bloqueada): %', sqlerrm;
end $$;

alter table notas_profissional drop column if exists arquivo;
alter table notas_profissional
  add column if not exists chave_acesso text check (chave_acesso is null or length(chave_acesso) <= 80),
  add column if not exists data_emissao date;
create unique index if not exists notas_profissional_chave_unica
  on notas_profissional (clinica_id, chave_acesso) where chave_acesso is not null;
