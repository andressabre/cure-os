-- 063 — Pacote do particular = autorização do contrato Particular com valor negociado + pagamentos ligados + NFS-e anexa.
-- autorizacoes: valor_unitario (negociado), valor_tabela (sugestão da tabela vigente no momento), desconto (R$ no pacote), quer_nota.
-- recebimentos: autorizacao_id (pagamento do pacote; vários por pacote = entrada + saldo), quer_nota, nf_arquivo/nf_arquivo_nome (PDF/XML da NFS-e, bucket documentos).
-- salvar_pacote_particular: gestão/recepção/financeiro OU o profissional dono (área/nome) — só em autorização de contrato Particular, só campos do pacote.
-- Valor negociado nunca altera a tabela de referência (contrato_tabela, só gestor/financeiro). O caixa/DRE usa o valor pago (recebimentos), não o da tabela.
alter table autorizacoes add column if not exists valor_unitario numeric(10,2) check (valor_unitario >= 0);
alter table autorizacoes add column if not exists valor_tabela numeric(10,2);
alter table autorizacoes add column if not exists desconto numeric(10,2) not null default 0 check (desconto >= 0);
alter table autorizacoes add column if not exists quer_nota boolean not null default true;
alter table recebimentos add column if not exists autorizacao_id uuid references autorizacoes on delete set null;
alter table recebimentos add column if not exists quer_nota boolean not null default true;
alter table recebimentos add column if not exists nf_arquivo text;
alter table recebimentos add column if not exists nf_arquivo_nome text;
create index if not exists recebimentos_autorizacao on recebimentos (autorizacao_id) where autorizacao_id is not null;

create or replace function salvar_pacote_particular(p_aut uuid, p_qtd int, p_valor_unit numeric, p_desconto numeric, p_quer_nota boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a autorizacoes; v_perfil text; v_usadas int; v_particular boolean;
begin
  select * into a from autorizacoes where id = p_aut;
  if a.id is null then raise exception 'Pacote não encontrado.'; end if;
  v_perfil := coalesce(meu_perfil(a.clinica_id)::text, '');
  select exists (select 1 from paciente_planos pl join contratos c on c.id = pl.contrato_id where pl.id = a.paciente_plano_id and c.nome ilike '%particular%') into v_particular;
  if not v_particular then raise exception 'Valor de pacote só em autorização do contrato Particular.'; end if;
  if v_perfil not in ('gestor', 'recepcao', 'financeiro')
     and not (v_perfil = 'profissional' and (a.profissional_id = meu_profissional(a.clinica_id) or a.area = any (minhas_areas(a.clinica_id)))) then
    raise exception 'Sem permissão'; end if;
  if p_qtd is null or p_qtd < 1 then raise exception 'Quantidade inválida.'; end if;
  if p_valor_unit is null or p_valor_unit < 0 then raise exception 'Valor inválido.'; end if;
  if coalesce(p_desconto, 0) < 0 or coalesce(p_desconto, 0) > p_qtd * p_valor_unit then raise exception 'Desconto maior que o total do pacote.'; end if;
  select count(*) into v_usadas from atendimentos x where x.autorizacao_id = a.id and x.status not in ('cancelado');
  if p_qtd < v_usadas then raise exception 'Já há % sessões usadas/agendadas neste pacote; a quantidade não pode ser menor.', v_usadas; end if;
  update autorizacoes set qtd_autorizada = p_qtd, qtd_solicitada = p_qtd, valor_unitario = round(p_valor_unit, 2),
    desconto = round(coalesce(p_desconto, 0), 2), quer_nota = coalesce(p_quer_nota, true) where id = a.id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function salvar_pacote_particular(uuid, int, numeric, numeric, boolean) from public, anon;
grant execute on function salvar_pacote_particular(uuid, int, numeric, numeric, boolean) to authenticated;
