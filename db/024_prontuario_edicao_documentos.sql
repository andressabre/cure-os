-- =====================================================================
-- CURE OS — Migração 024
-- (a) Gestora (09/11/2026): liberar edição de registro ASSINADO por enquanto.
--     Mantém rastreabilidade: cada edição de registro assinado guarda a versão
--     anterior em prontuario_versoes (só o autor lê; ninguém altera/apaga).
--     Apagar registro assinado continua bloqueado.
-- (b) Documentos emitidos (atestado, declaração, orientação de alta, relatório…)
--     com timbrado, código de verificação e modelos próprios por profissional.
-- =====================================================================

alter table prontuario_registros add column if not exists editado_em timestamptz;

create table if not exists prontuario_versoes (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references prontuario_registros on delete restrict,
  clinica_id uuid not null references clinicas on delete restrict,
  profissional_id uuid not null references profissionais on delete restrict,
  data_registro date, conteudo jsonb, hash_assinatura text, assinado_em timestamptz,
  substituido_em timestamptz not null default now()
);
alter table prontuario_versoes enable row level security;
drop policy if exists pv_ler on prontuario_versoes;
create policy pv_ler on prontuario_versoes for select to authenticated using (profissional_id = meu_profissional(clinica_id));

create or replace function prontuario_trava() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'assinado' then raise exception 'Registro assinado não pode ser apagado (guarda legal de 20 anos).'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.clinica_id <> old.clinica_id or new.paciente_id <> old.paciente_id or new.profissional_id <> old.profissional_id then
      raise exception 'Não é permitido trocar paciente, profissional ou clínica do registro.'; end if;
    if old.status = 'assinado' then
      if new.conteudo is distinct from old.conteudo or new.data_registro is distinct from old.data_registro then
        insert into prontuario_versoes (registro_id, clinica_id, profissional_id, data_registro, conteudo, hash_assinatura, assinado_em)
        values (old.id, old.clinica_id, old.profissional_id, old.data_registro, old.conteudo, old.hash_assinatura, old.assinado_em);
        new.editado_em := now();
      end if;
      new.status := 'assinado';            -- assinado não volta a rascunho
      new.assinado_em := old.assinado_em;   -- data da assinatura original
      new.hash_assinatura := encode(sha256(convert_to(
        new.paciente_id::text || '|' || new.profissional_id::text || '|' || new.data_registro::text || '|' || new.modelo || '|' || new.conteudo::text, 'UTF8')), 'hex');
      new.atualizado_em := now();
      return new;
    end if;
  end if;
  new.atualizado_em := now();
  if new.status = 'assinado' then
    new.assinado_em := now();
    new.hash_assinatura := encode(sha256(convert_to(
      new.paciente_id::text || '|' || new.profissional_id::text || '|' || new.data_registro::text || '|' || new.modelo || '|' || new.conteudo::text, 'UTF8')), 'hex');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- documentos
create table if not exists documento_modelos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  profissional_id uuid references profissionais on delete cascade,   -- null = modelo da clínica
  tipo text not null,
  titulo text not null,
  corpo text not null,
  criado_em timestamptz not null default now()
);
create table if not exists documentos_emitidos (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete restrict,
  paciente_id uuid not null references pacientes on delete restrict,
  profissional_id uuid references profissionais on delete restrict,   -- quem assina (null = emitido pela recepção)
  emitido_por uuid not null default auth.uid(),
  atendimento_id uuid references atendimentos on delete set null,
  tipo text not null check (tipo in ('atestado','comparecimento','acompanhante','alta','relatorio','orientacoes','livre')),
  titulo text not null,
  corpo text not null,
  codigo text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  emitido_em timestamptz not null default now()
);
create index if not exists documentos_emitidos_pac on documentos_emitidos (paciente_id, emitido_em desc);
alter table documento_modelos enable row level security;
alter table documentos_emitidos enable row level security;

-- Modelos: o profissional gerencia os seus; todos da clínica leem os da clínica
drop policy if exists dm_ler on documento_modelos;
create policy dm_ler on documento_modelos for select to authenticated
  using (meu_perfil(clinica_id) is not null and (profissional_id is null or profissional_id = meu_profissional(clinica_id)));
drop policy if exists dm_proprio on documento_modelos;
create policy dm_proprio on documento_modelos for all to authenticated
  using (profissional_id = meu_profissional(clinica_id)) with check (profissional_id = meu_profissional(clinica_id));
drop policy if exists dm_clinica on documento_modelos;
create policy dm_clinica on documento_modelos for all to authenticated
  using (profissional_id is null and meu_perfil(clinica_id) = 'gestor') with check (profissional_id is null and meu_perfil(clinica_id) = 'gestor');

-- Emitidos: conteúdo clínico (atestado, alta, relatório, orientações) só o autor.
-- Declarações de comparecimento/acompanhante (sem dado clínico) também recepção e gestão.
drop policy if exists de_autor on documentos_emitidos;
create policy de_autor on documentos_emitidos for select to authenticated
  using (profissional_id = meu_profissional(clinica_id));
drop policy if exists de_recepcao on documentos_emitidos;
create policy de_recepcao on documentos_emitidos for select to authenticated
  using (tipo in ('comparecimento','acompanhante') and meu_perfil(clinica_id) in ('gestor','recepcao','financeiro'));
drop policy if exists de_criar on documentos_emitidos;
create policy de_criar on documentos_emitidos for insert to authenticated
  with check (emitido_por = auth.uid() and (
    profissional_id = meu_profissional(clinica_id)
    or (tipo in ('comparecimento','acompanhante') and meu_perfil(clinica_id) in ('gestor','recepcao','financeiro')
        and (profissional_id is null or exists (select 1 from profissionais pr where pr.id = profissional_id and pr.clinica_id = documentos_emitidos.clinica_id)))));
-- sem update/delete: documento emitido não muda (reemitir gera outro código)

-- Verificação pública de autenticidade pelo código (sem login): só confirma que existe, tipo, data e profissional — nada clínico
create or replace function verificar_documento(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('valido', true, 'tipo', d.titulo, 'emitido_em', d.emitido_em,
    'profissional', pr.nome, 'conselho', pr.conselho || ' ' || pr.numero_conselho,
    'paciente_iniciais', (select string_agg(left(w, 1), '') from regexp_split_to_table(p.nome, '\s+') w where length(w) > 2))
  from documentos_emitidos d join pacientes p on p.id = d.paciente_id left join profissionais pr on pr.id = d.profissional_id
  where d.codigo = upper(trim(p_codigo));
$$;
grant execute on function verificar_documento(text) to anon, authenticated;

-- Dados do timbrado (editáveis depois em clinicas.config.timbrado)
update clinicas set config = config || jsonb_build_object('timbrado', jsonb_build_object(
  'razao_social', 'Cure Saúde e Desempenho Ltda', 'cnpj', '31.167.694/0001-80',
  'endereco', 'Rua Blumenau, 178 – Centro – Joinville/SC', 'telefone', '(47) 3801-2376 (WhatsApp)',
  'email', 'clinicacureadm@gmail.com', 'site', 'curesaudeedesempenho.com', 'instagram', '@clinica_cure'))
where id = 'c0000000-0000-4000-8000-000000000001' and not (config ? 'timbrado');
