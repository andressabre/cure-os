-- 071 — Profissional independente registra, edita e exclui as PRÓPRIAS autorizações (23/11/2026), com as mesmas regras da gestão:
--  • só autorização em seu nome e na sua área (mesma regra do cadastro, db/052);
--  • não edita nem exclui guia já enviada ao plano (guia em lote fechado/enviado/protocolado/retornado) — vale também para a gestão na exclusão;
--  • não exclui com atendimento realizado; agendamentos ainda abertos ficam sem autorização (convênio pede de novo).
create or replace function public.autorizacao_travada(p_aut uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from guias g join lotes l on l.id = g.lote_id
                  where g.autorizacao_id = p_aut and l.status::text <> 'aberto');
$$;
revoke all on function public.autorizacao_travada(uuid) from public, anon;
grant execute on function public.autorizacao_travada(uuid) to authenticated;

-- ids travados entre os informados (a tela esconde Editar/Excluir; o banco continua sendo a barreira)
create or replace function public.autorizacoes_travadas(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(a.id), '{}'::uuid[]) from autorizacoes a
   where a.id = any (p_ids) and meu_perfil(a.clinica_id) is not null and autorizacao_travada(a.id);
$$;
revoke all on function public.autorizacoes_travadas(uuid[]) from public, anon;
grant execute on function public.autorizacoes_travadas(uuid[]) to authenticated;

drop policy if exists prof_edita_autorizacoes on public.autorizacoes;
create policy prof_edita_autorizacoes on public.autorizacoes for update to authenticated
  using (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id)
         and (area is null or area = any (minhas_areas(clinica_id))) and not autorizacao_travada(id))
  with check (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id)
         and (area is null or area = any (minhas_areas(clinica_id))));

drop policy if exists prof_exclui_autorizacoes on public.autorizacoes;
create policy prof_exclui_autorizacoes on public.autorizacoes for delete to authenticated
  using (meu_perfil(clinica_id) = 'profissional' and profissional_id = meu_profissional(clinica_id)
         and (area is null or area = any (minhas_areas(clinica_id))) and not autorizacao_travada(id));

-- Exclusão (qualquer perfil): barra guia enviada e atendimento realizado; solta os agendamentos abertos (o profissional não tem UPDATE na agenda)
create or replace function public.antes_excluir_autorizacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if autorizacao_travada(old.id) then
    raise exception 'Esta guia já foi enviada ao plano de saúde: não pode ser excluída.' using errcode = 'P0001';
  end if;
  if exists (select 1 from atendimentos where autorizacao_id = old.id and status = 'atendido') then
    raise exception 'Há atendimento realizado nesta autorização: não dá para excluir.' using errcode = 'P0001';
  end if;
  update atendimentos set autorizacao_id = null where autorizacao_id = old.id;
  return old;
end $$;
revoke execute on function public.antes_excluir_autorizacao() from public, anon, authenticated;

drop trigger if exists antes_excluir_autorizacao on public.autorizacoes;
create trigger antes_excluir_autorizacao before delete on public.autorizacoes
  for each row execute function public.antes_excluir_autorizacao();
