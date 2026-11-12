-- 039 — Prontuário sem etapa de assinatura (primeira fase) + editar/apagar documentos emitidos.
-- NÃO aplicada automaticamente: revisar antes de rodar. Idempotente (create or replace / drop policy if exists).
--
-- PRONTUÁRIO
-- Decisão: o status 'assinado' continua sendo o status "final" gravado pela tela (adendos, impressão, backup e importador
-- dependem dele). A tela deixa de falar em assinatura; o hash continua sendo calculado internamente como selo de integridade.
-- Mudanças em relação à db/025:
--   1. UPDATE permitido em qualquer status (a RLS pr_editar já restringe ao autor).
--   2. Antes de todo UPDATE que muda conteudo ou data_registro, a versão anterior vai para prontuario_versoes
--      (trilha de alteração; só o autor lê, ninguém altera/apaga) e editado_em recebe now().
--   3. DELETE continua bloqueado para registro que não seja rascunho (guarda legal) — igual à db/025.
--   4. assinado_em preserva a data da primeira gravação; o hash é recalculado a cada alteração (reflete a versão atual).
create or replace function prontuario_trava() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'assinado' then raise exception 'Registro finalizado não pode ser apagado (guarda legal de 20 anos).'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.clinica_id <> old.clinica_id or new.paciente_id <> old.paciente_id or new.profissional_id <> old.profissional_id then
      raise exception 'Não é permitido trocar paciente, profissional ou clínica do registro.'; end if;
    if new.conteudo is distinct from old.conteudo or new.data_registro is distinct from old.data_registro then
      insert into prontuario_versoes (registro_id, clinica_id, profissional_id, data_registro, conteudo, hash_assinatura, assinado_em)
      values (old.id, old.clinica_id, old.profissional_id, old.data_registro, old.conteudo, old.hash_assinatura, old.assinado_em);
      new.editado_em := now();
    end if;
  end if;
  new.atualizado_em := now();
  if new.status = 'assinado' then
    new.assinado_em := coalesce(case when tg_op = 'UPDATE' then old.assinado_em end, now());
    new.hash_assinatura := encode(sha256(convert_to(
      new.paciente_id::text || '|' || new.profissional_id::text || '|' || new.data_registro::text || '|' || new.modelo || '|' || new.conteudo::text, 'UTF8')), 'hex');
  end if;
  return new;
end $$;
revoke execute on function prontuario_trava() from public, anon, authenticated;

-- ---------------------------------------------------------------- DOCUMENTOS EMITIDOS: editar e excluir
-- Hoje só há SELECT e INSERT. Quem pode editar/excluir = quem pode ver o documento:
-- o profissional autor, ou (declarações de comparecimento/acompanhante) gestão/recepção/financeiro.
drop policy if exists de_editar on documentos_emitidos;
create policy de_editar on documentos_emitidos for update to authenticated
  using ((profissional_id = meu_profissional(clinica_id))
    or (tipo in ('comparecimento', 'acompanhante') and meu_perfil(clinica_id) in ('gestor', 'recepcao', 'financeiro')))
  with check ((profissional_id = meu_profissional(clinica_id))
    or (tipo in ('comparecimento', 'acompanhante') and meu_perfil(clinica_id) in ('gestor', 'recepcao', 'financeiro')));

drop policy if exists de_apagar on documentos_emitidos;
create policy de_apagar on documentos_emitidos for delete to authenticated
  using ((profissional_id = meu_profissional(clinica_id))
    or (tipo in ('comparecimento', 'acompanhante') and meu_perfil(clinica_id) in ('gestor', 'recepcao', 'financeiro')));

-- Na edição só mudam título e texto: código de verificação, paciente, autor, tipo e data de emissão ficam fixos.
create or replace function documentos_emitidos_trava() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.codigo <> old.codigo or new.paciente_id <> old.paciente_id or new.clinica_id <> old.clinica_id
     or new.profissional_id is distinct from old.profissional_id or new.emitido_por <> old.emitido_por
     or new.tipo <> old.tipo or new.emitido_em <> old.emitido_em then
    raise exception 'Só o título e o texto do documento podem ser alterados.';
  end if;
  return new;
end $$;
revoke execute on function documentos_emitidos_trava() from public, anon, authenticated;
drop trigger if exists documentos_emitidos_trava on documentos_emitidos;
create trigger documentos_emitidos_trava before update on documentos_emitidos
  for each row execute function documentos_emitidos_trava();
