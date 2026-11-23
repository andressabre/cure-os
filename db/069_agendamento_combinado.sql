-- 069 — Sessão combinada (23/11/2026): vários procedimentos na MESMA sessão (ex.: consulta + bioimpedância; sessão + eletroterapia).
-- Cada procedimento segue sendo 1 atendimento com a sua autorização (saldo e repasse não mudam); os atendimentos da mesma sessão
-- compartilham `combo_id` e ficam com 1 minuto de diferença no início (faturamento não aceita dois códigos no mesmo horário).
-- 1) gatilho: mover/confirmar/faltar/cancelar um replica nos irmãos (horários por DESLOCAMENTO, preservando o minuto de diferença);
--    "atendido" nunca é replicado — é fechado por `fechar_combo`.
-- 2) fechar_combo: fecha a sessão numa guia só (itens de todos os procedimentos), marca os irmãos como atendidos e passa cada item
--    para o atendimento do seu procedimento (a hora de cada procedimento na guia/XML vem do próprio atendimento).

alter table public.atendimentos add column if not exists combo_id uuid;
create index if not exists atendimentos_combo_idx on public.atendimentos (combo_id) where combo_id is not null;

create or replace function public.sincroniza_combo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.combo_id is null or pg_trigger_depth() > 1 then return null; end if;
  if new.inicio is not distinct from old.inicio and new.fim is not distinct from old.fim
     and new.profissional_id is not distinct from old.profissional_id and new.sala is not distinct from old.sala
     and new.observacao is not distinct from old.observacao and new.lembrete_enviado_em is not distinct from old.lembrete_enviado_em
     and (new.status is not distinct from old.status or new.status = 'atendido') then
    return null;
  end if;
  update atendimentos s
     set inicio = s.inicio + (new.inicio - old.inicio), fim = s.fim + (new.fim - old.fim),
         profissional_id = new.profissional_id, sala = new.sala,
         observacao = new.observacao, lembrete_enviado_em = new.lembrete_enviado_em,
         status = case when new.status = 'atendido' then s.status else new.status end,
         atualizado_em = now()
   where s.combo_id = new.combo_id and s.id <> new.id and s.clinica_id = new.clinica_id and s.paciente_id = new.paciente_id
     and s.status <> 'atendido';
  return null;
end $$;

revoke execute on function public.sincroniza_combo() from public, anon, authenticated;

drop trigger if exists sincroniza_combo on public.atendimentos;
create trigger sincroniza_combo
  after update on public.atendimentos
  for each row execute function public.sincroniza_combo();

create or replace function public.fechar_combo(p_atendimento uuid, p_plano uuid, p_autorizacao uuid, p_itens jsonb, p_dados jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a atendimentos; r jsonb; m record; v_guias uuid[]; v_proc uuid; v_proc_base uuid; v_item uuid;
begin
  select * into a from atendimentos where id = p_atendimento;
  if a.id is null then raise exception 'Atendimento não encontrado'; end if;
  if a.combo_id is null then raise exception 'Atendimento não faz parte de uma sessão combinada'; end if;
  if meu_perfil(a.clinica_id) is null then raise exception 'Sem permissão'; end if;

  r := guia_atendimento(p_atendimento, p_plano, p_autorizacao, p_itens, true, p_dados);   -- mesmas regras e bloqueios da guia comum
  if not coalesce((r->>'gravado')::boolean, false) then return r; end if;

  select array_agg((g->>'id')::uuid) into v_guias from jsonb_array_elements(coalesce(r->'guias', '[]'::jsonb)) g;
  select procedimento_id into v_proc_base from autorizacoes where id = coalesce(p_autorizacao, a.autorizacao_id);

  for m in select s.id, s.autorizacao_id from atendimentos s
            where s.combo_id = a.combo_id and s.id <> a.id and s.clinica_id = a.clinica_id and s.paciente_id = a.paciente_id
              and s.status not in ('atendido', 'cancelado') order by s.inicio, s.id loop
    update atendimentos set status = 'atendido', paciente_plano_id = p_plano, atualizado_em = now() where id = m.id;
    select procedimento_id into v_proc from autorizacoes where id = m.autorizacao_id;
    if v_proc is not null and v_proc is distinct from v_proc_base and v_guias is not null then
      select i.id into v_item from guia_itens i
       where i.guia_id = any (v_guias) and i.procedimento_id = v_proc and i.atendimento_id = p_atendimento
       order by i.sequencial desc limit 1;
      if v_item is not null then update guia_itens set atendimento_id = m.id where id = v_item; end if;
    end if;
  end loop;
  return r || jsonb_build_object('combo', true);
end $$;

revoke all on function public.fechar_combo(uuid, uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.fechar_combo(uuid, uuid, uuid, jsonb, jsonb) to authenticated;
