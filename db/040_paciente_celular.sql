-- 040: celular separado do telefone fixo (lembretes por WhatsApp usam o celular primeiro).
-- Telefones novos são gravados só com dígitos e 55 na frente (o front formata +55 (DD) …).
alter table public.pacientes add column if not exists celular text;

-- Telefone antigo que é um único celular com DDD (11 dígitos, 9 após o DDD, com ou sem 55) passa para o campo celular.
update public.pacientes
   set celular = '55' || right(regexp_replace(telefone, '\D', '', 'g'), 11), telefone = null
 where celular is null
   and regexp_replace(telefone, '\D', '', 'g') ~ '^(55)?\d{2}9\d{8}$';

-- Lembretes de relacionamento (aniversário, reavaliação) usam o celular primeiro.
do $$ begin
  execute replace(pg_get_functiondef('public.relacionamento(uuid, integer)'::regprocedure), '''telefone'', p.telefone', '''telefone'', coalesce(p.celular, p.telefone)');
end $$;
