-- 068 — Nutrição sem senha (23/11/2026): em autorização da área 'nutricao', se a senha vier vazia e houver nº da guia da operadora,
-- o nº da guia passa a valer como identificador (senha := nº da guia). Assim a trava da 050, a liberação para faturamento (037),
-- o agrupamento da ficha e o lote seguem funcionando sem o "0" digitado à mão. Outras áreas continuam exigindo senha.
-- O gatilho se chama "antes_..." para rodar ANTES de "trava_autorizada_sem_senha" (ordem alfabética dos gatilhos BEFORE).

create or replace function public.nutricao_guia_vale_senha()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.area = 'nutricao' and nullif(trim(coalesce(new.senha, '')), '') is null
     and nullif(trim(coalesce(new.numero_guia_operadora, '')), '') is not null then
    new.senha := trim(new.numero_guia_operadora);
  end if;
  return new;
end $$;

revoke execute on function public.nutricao_guia_vale_senha() from public, anon, authenticated;

drop trigger if exists antes_nutricao_guia_vale_senha on public.autorizacoes;
create trigger antes_nutricao_guia_vale_senha
  before insert or update on public.autorizacoes
  for each row execute function public.nutricao_guia_vale_senha();
