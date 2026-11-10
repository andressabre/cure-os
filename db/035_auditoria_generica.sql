-- 035 — Trilha de auditoria genérica (quem/quando/antes/depois) + leitura de prontuário.
-- Reaproveita a tabela `auditoria` (clinica_id, user_id, tabela, registro_id, acao, dados, em).
-- Idempotente. Nenhuma mudança de comportamento para o usuário.
-- Retenção: nada apaga a auditoria por enquanto (a tabela cresce; limpeza é decisão futura).

-- ---------------------------------------------------------------------
-- 1. Função do gatilho (só trigger a chama)
-- ---------------------------------------------------------------------
create or replace function auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_campos jsonb := '[]'::jsonb;
  v_antes jsonb;
  v_depois jsonb;
  v_ignorar text[] := array['atualizado_em','arquivo_xml'];  -- ruído e campo grande (XML do lote)
  k text;
begin
  -- remove ignorados e qualquer valor textual grande (> 2000 caracteres)
  if v_old is not null then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_old
      from jsonb_each(v_old) where key <> all (v_ignorar) and length(value::text) <= 2000;
  end if;
  if v_new is not null then
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_new
      from jsonb_each(v_new) where key <> all (v_ignorar) and length(value::text) <= 2000;
  end if;

  if tg_op = 'UPDATE' then
    -- só as colunas que mudaram
    for k in select key from jsonb_each(v_new) union select key from jsonb_each(v_old) loop
      if (v_new -> k) is distinct from (v_old -> k) then v_campos := v_campos || to_jsonb(k); end if;
    end loop;
    if jsonb_array_length(v_campos) = 0 then return null; end if;   -- nada relevante mudou
    select jsonb_object_agg(key, value) into v_antes  from jsonb_each(v_old) where v_campos ? key;
    select jsonb_object_agg(key, value) into v_depois from jsonb_each(v_new) where v_campos ? key;
  elsif tg_op = 'INSERT' then
    v_depois := v_new;
  else
    v_antes := v_old;
  end if;

  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
  values (
    (coalesce(v_new, v_old) ->> 'clinica_id')::uuid,   -- as 14 tabelas têm clinica_id
    auth.uid(), tg_table_name, coalesce(v_new, v_old) ->> 'id', tg_op,
    jsonb_build_object('antes', v_antes, 'depois', v_depois, 'campos', v_campos)
  );
  return null;
end $$;

revoke execute on function auditar() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Triggers (todas as 14 tabelas têm `id` uuid e `clinica_id`, verificado na produção em 10/11/2026)
--    NÃO em prontuario* (conteúdo clínico fora da auditoria).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['guias','guia_itens','atendimentos','autorizacoes','lancamentos','recebimentos',
    'pacientes','paciente_planos','contratos','contrato_tabela','regras_repasse','lotes','retornos','glosas'] loop
    execute format('drop trigger if exists auditoria_%1$s on %1$I', t);
    execute format('create trigger auditoria_%1$s after insert or update or delete on %1$I
      for each row execute function auditar()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Leitura de prontuário (nunca grava texto clínico)
--    Só registra se o chamador é o autor do registro (mesma regra da RLS do prontuário).
-- ---------------------------------------------------------------------
create or replace function registrar_leitura_prontuario(p_registro uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_clinica uuid;
begin
  select clinica_id into v_clinica from prontuario_registros
   where id = p_registro and profissional_id = meu_profissional(clinica_id);
  if v_clinica is null then return; end if;
  insert into auditoria (clinica_id, user_id, tabela, registro_id, acao, dados)
  values (v_clinica, auth.uid(), 'prontuario', p_registro::text, 'LEITURA', '{}'::jsonb);
end $$;

revoke execute on function registrar_leitura_prontuario(uuid) from public, anon;
grant execute on function registrar_leitura_prontuario(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS da auditoria: SELECT só gestão da própria clínica; sem policy de escrita = negado
-- ---------------------------------------------------------------------
alter table auditoria enable row level security;
drop policy if exists gestor_auditoria on auditoria;
create policy gestor_auditoria on auditoria for select to authenticated
  using (meu_perfil(clinica_id) = 'gestor'::perfil_usuario);
revoke insert, update, delete, truncate on auditoria from anon, authenticated;

create index if not exists auditoria_tabela_reg on auditoria (clinica_id, tabela, registro_id);
create index if not exists auditoria_em on auditoria (clinica_id, em desc);

-- ---------------------------------------------------------------------
-- 5. TESTES (rodar após aplicar; cada um deve dar o resultado indicado)
-- ---------------------------------------------------------------------
-- T1: UPDATE em pacientes (telefone) gera 1 linha com campos = ["telefone"]
--   begin;
--   update pacientes set telefone = telefone || '0' where id = '<id de teste>';
--   select acao, dados->'campos' from auditoria where tabela='pacientes' and registro_id='<id de teste>' order by id desc limit 1;
--   -- esperado: UPDATE | ["telefone"]
--   rollback;   -- (ou restaurar o telefone original; neste caso a linha de auditoria também deve sumir/ser anotada)
-- T2: UPDATE sem mudança não gera linha
--   select count(*) from auditoria;   -- anotar N
--   update pacientes set telefone = telefone where id = '<id de teste>';
--   select count(*) from auditoria;   -- esperado: N (igual)
-- T3: abrir um prontuário gera LEITURA (pela tela, como autor) ou, no SQL, simulando o usuário autor:
--   select registrar_leitura_prontuario('<registro do autor>');
--   select acao, tabela, dados from auditoria where tabela='prontuario' order by id desc limit 1;  -- esperado: LEITURA | prontuario | {}
-- T4: profissional não lê a auditoria (simular com role authenticated + sub do usuário profissional)
--   begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"<uuid profissional>"}',true);
--   select count(*) from auditoria;   -- esperado: 0
--   rollback;
-- T5: segurança
--   get_advisors(security) -> sem achados novos;  ferramentas/auditoria-rls.sql -> zero linhas
--   (auditar() e registrar_leitura_prontuario: confirmar que auditar() não tem EXECUTE para anon/authenticated)
