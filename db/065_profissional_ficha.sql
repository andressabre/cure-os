-- 065 — Ficha completa do profissional: dados de pagamento (fixos; troca por solicitação) e notas fiscais mensais.
-- Só estrutura e regras de acesso: nenhum dado real vai neste arquivo (repositório público).
-- Quem vê o quê:
--   profissional_pagamento           gestor e financeiro leem; só o gestor grava; o profissional lê só o próprio.
--   profissional_pagamento_solicitacoes  o profissional abre pedido de troca; só o gestor resolve.
--   notas_profissional + bucket notas-prof  gestor/financeiro e o próprio profissional enviam e leem; recepção não vê.

create table if not exists profissional_pagamento (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  profissional_id uuid not null unique references profissionais on delete cascade,
  titular text,
  documento_titular text,
  banco text,
  agencia text,
  conta text,
  tipo_conta text check (tipo_conta in ('corrente','poupanca','pagamento')),
  pix_tipo text check (pix_tipo in ('cpf','cnpj','email','celular','aleatoria')),
  pix_chave text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table profissional_pagamento enable row level security;
drop policy if exists ler_prof_pagamento on profissional_pagamento;
create policy ler_prof_pagamento on profissional_pagamento for select to authenticated
  using (meu_perfil(clinica_id) in ('gestor','financeiro') or profissional_id = meu_profissional(clinica_id));
drop policy if exists gestor_prof_pagamento on profissional_pagamento;
create policy gestor_prof_pagamento on profissional_pagamento for all to authenticated
  using (meu_perfil(clinica_id) = 'gestor') with check (meu_perfil(clinica_id) = 'gestor');
grant select, insert, update, delete on profissional_pagamento to authenticated;

create or replace function prof_pagamento_carimbo() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.atualizado_em := now(); new.atualizado_por := auth.uid(); return new; end $$;
revoke execute on function prof_pagamento_carimbo() from public, anon, authenticated;
drop trigger if exists prof_pagamento_carimbo on profissional_pagamento;
create trigger prof_pagamento_carimbo before update on profissional_pagamento
  for each row execute function prof_pagamento_carimbo();

create table if not exists profissional_pagamento_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  profissional_id uuid not null references profissionais on delete cascade,
  mensagem text not null check (length(btrim(mensagem)) > 0 and length(mensagem) <= 1000),
  situacao text not null default 'aberta' check (situacao in ('aberta','atendida','recusada')),
  resposta text,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid
);
alter table profissional_pagamento_solicitacoes enable row level security;
drop policy if exists ler_prof_pag_solic on profissional_pagamento_solicitacoes;
create policy ler_prof_pag_solic on profissional_pagamento_solicitacoes for select to authenticated
  using (meu_perfil(clinica_id) in ('gestor','financeiro') or profissional_id = meu_profissional(clinica_id));
drop policy if exists abrir_prof_pag_solic on profissional_pagamento_solicitacoes;
create policy abrir_prof_pag_solic on profissional_pagamento_solicitacoes for insert to authenticated
  with check (profissional_id = meu_profissional(clinica_id) and situacao = 'aberta' and resolvido_em is null);
drop policy if exists gestor_prof_pag_solic on profissional_pagamento_solicitacoes;
create policy gestor_prof_pag_solic on profissional_pagamento_solicitacoes for all to authenticated
  using (meu_perfil(clinica_id) = 'gestor') with check (meu_perfil(clinica_id) = 'gestor');
grant select, insert, update on profissional_pagamento_solicitacoes to authenticated;

create table if not exists notas_profissional (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  profissional_id uuid not null references profissionais on delete cascade,
  competencia date not null check (competencia = date_trunc('month', competencia)::date),
  numero text,
  valor numeric(12,2),
  arquivo text not null,
  enviado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists notas_profissional_prof_comp on notas_profissional (profissional_id, competencia);
alter table notas_profissional enable row level security;
drop policy if exists ler_notas_prof on notas_profissional;
create policy ler_notas_prof on notas_profissional for select to authenticated
  using (meu_perfil(clinica_id) in ('gestor','financeiro') or profissional_id = meu_profissional(clinica_id));
drop policy if exists enviar_notas_prof on notas_profissional;
create policy enviar_notas_prof on notas_profissional for insert to authenticated
  with check (meu_perfil(clinica_id) in ('gestor','financeiro') or profissional_id = meu_profissional(clinica_id));
drop policy if exists apagar_notas_prof on notas_profissional;
create policy apagar_notas_prof on notas_profissional for delete to authenticated
  using (meu_perfil(clinica_id) = 'gestor' or profissional_id = meu_profissional(clinica_id));
grant select, insert, delete on notas_profissional to authenticated;

-- Storage privado: <clinica>/<profissional>/<AAAA-MM>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas-prof', 'notas-prof', false, 5242880,
        array['application/pdf','image/jpeg','image/png','application/xml','text/xml'])
on conflict (id) do nothing;
create or replace function pasta_nota_prof_ok(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f-]{36}$' then coalesce(
    meu_perfil(split_part(p_nome, '/', 1)::uuid)::text in ('gestor','financeiro')
    or split_part(p_nome, '/', 2) = meu_profissional(split_part(p_nome, '/', 1)::uuid)::text, false) else false end;
$$;
revoke execute on function pasta_nota_prof_ok(text) from public, anon;
grant execute on function pasta_nota_prof_ok(text) to authenticated;
drop policy if exists notas_prof_ler on storage.objects;
create policy notas_prof_ler on storage.objects for select to authenticated
  using (bucket_id = 'notas-prof' and pasta_nota_prof_ok(name));
drop policy if exists notas_prof_enviar on storage.objects;
create policy notas_prof_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'notas-prof' and pasta_nota_prof_ok(name));
drop policy if exists notas_prof_apagar on storage.objects;
create policy notas_prof_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'notas-prof' and pasta_nota_prof_ok(name));

-- Auditoria genérica (quem trocou dado de pagamento e quando; a tela #auditoria é só da gestão)
do $$
declare t text;
begin
  foreach t in array array['profissional_pagamento','profissional_pagamento_solicitacoes','notas_profissional'] loop
    execute format('drop trigger if exists auditoria_%1$s on %1$I', t);
    execute format('create trigger auditoria_%1$s after insert or update or delete on %1$I
      for each row execute function auditar()', t);
  end loop;
end $$;
