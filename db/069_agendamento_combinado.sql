-- 069 — Agendamento combinado (23/11/2026): vários procedimentos na MESMA sessão (ex.: consulta + bioimpedância; sessão + eletroterapia).
-- Cada procedimento segue sendo 1 atendimento com a sua autorização (saldo, guia e repasse não mudam); os atendimentos da mesma sessão
-- compartilham `combo_id`. A agenda mostra um bloco só; o gatilho abaixo replica entre os irmãos horário, profissional, sala, observação,
-- lembrete e status (exceto "atendido", que cada procedimento fecha com a própria guia).

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
     set inicio = new.inicio, fim = new.fim, profissional_id = new.profissional_id, sala = new.sala,
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
