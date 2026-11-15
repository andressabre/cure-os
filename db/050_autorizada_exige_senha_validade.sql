-- 050 — Autorização "autorizada" exige senha, data da autorização e validade (achado do 1º teste da autorização automática, 12/11/2026).
-- Vale para qualquer caminho de gravação (ficha, agenda, "Autorizar guia", automação nos portais).
-- Isento: contrato que não exige senha (contrato_exige_senha = false → Particular, sem_tiss, exige_autorizacao=false).
-- Só checa quando a linha vira/é gravada como 'autorizada' mexendo em status, senha, data ou validade (registros antigos não travam outras edições).

create or replace function public.trava_autorizada_sem_senha()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_contrato uuid;
begin
  if new.status is distinct from 'autorizada' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'autorizada'
     and new.senha is not distinct from old.senha and new.validade is not distinct from old.validade
     and new.data_autorizacao is not distinct from old.data_autorizacao then
    return new;
  end if;
  select pp.contrato_id into v_contrato from paciente_planos pp where pp.id = new.paciente_plano_id;
  if v_contrato is null or not coalesce(contrato_exige_senha(v_contrato), false) then return new; end if;
  new.senha := nullif(trim(new.senha), '');
  if new.senha is null then
    raise exception 'Autorizada precisa de senha. Sem senha, deixe como pendente.' using errcode = 'P0001';
  end if;
  if new.data_autorizacao is null then
    raise exception 'Autorizada precisa da data da autorização.' using errcode = 'P0001';
  end if;
  if new.validade is null then
    raise exception 'Autorizada precisa da validade da senha.' using errcode = 'P0001';
  end if;
  if new.validade < new.data_autorizacao then
    raise exception 'Validade da senha é anterior à data da autorização.' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function public.trava_autorizada_sem_senha() from public, anon, authenticated;

drop trigger if exists trava_autorizada_sem_senha on public.autorizacoes;
create trigger trava_autorizada_sem_senha
  before insert or update on public.autorizacoes
  for each row execute function public.trava_autorizada_sem_senha();
