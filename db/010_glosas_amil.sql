-- 010 — Catálogo ANS de glosas com inativação/substituição (DexPara) e glosas internas por operadora.
-- Fonte: comunicado Amil "Inativação de Códigos Glosas Padrão TISS (11/2025)", vigente a partir de 01/12/2025.
-- Aplicada direto no Supabase em 08/11/2026.
alter table motivos_glosa add column if not exists ativo boolean not null default true,
  add column if not exists substituido_por text, add column if not exists inativo_desde date;

insert into motivos_glosa (codigo, descricao) values
 ('1402', 'Procedimento não autorizado'),
 ('1415', 'Procedimento não autorizado para o beneficiário'),
 ('1430', 'Procedimento odontológico não autorizado'),
 ('1613', 'Consulta não autorizada'),
 ('2015', 'Material não autorizado'),
 ('1702', 'Cobrança de procedimento em duplicidade'),
 ('1426', 'Não autorizado pela auditoria'),
 ('1403', 'Não existe informação sobre a senha de autorização do procedimento'),
 ('2206', 'OPME informado não autorizado'),
 ('1816', 'Cobrança de procedimento em quantidade incompatível com o procedimento/evolução clínica')
on conflict (codigo) do nothing;

update motivos_glosa m set ativo = false, inativo_desde = '2025-12-01', substituido_por = d.para
from (values ('1402','1426'), ('1415','1403'), ('2015','2206'), ('1702','1816'), ('1430',null), ('1613',null)) d(de, para)
where m.codigo = d.de;

-- Glosas internas da operadora, ligadas ao código ANS correspondente
create table if not exists glosas_operadora (
  id uuid primary key default gen_random_uuid(),
  clinica_id uuid not null references clinicas on delete cascade,
  operadora_id uuid not null references operadoras on delete cascade,
  codigo text not null,
  descricao text not null,
  codigo_ans text references motivos_glosa(codigo),
  unique (operadora_id, codigo)
);
alter table glosas_operadora enable row level security;
create policy ler_glosas_operadora on glosas_operadora for select to authenticated using (meu_perfil(clinica_id) is not null);
create policy gestao_glosas_operadora on glosas_operadora for all to authenticated
  using (meu_perfil(clinica_id) in ('gestor','financeiro')) with check (meu_perfil(clinica_id) in ('gestor','financeiro'));

insert into glosas_operadora (clinica_id, operadora_id, codigo, descricao, codigo_ans)
select o.clinica_id, o.id, g.cod, g.descr, g.ans
from operadoras o, (values
  ('864',  'Autorização prévia negada', '1426'),
  ('870',  'Procedimento sem autorização prévia', '1426'),
  ('871',  'AP informada não pertence ao beneficiário', '1403'),
  ('4069', 'Material ou valor de OPME não autorizado', '2206'),
  ('4176', 'Material ou valor de OPME não autorizado (PI)', '2206'),
  ('4163', 'Excesso de procedimentos ou procedimento sem justificativa (CTV)', '1816')) g(cod, descr, ans)
where o.nome = 'Amil'
on conflict (operadora_id, codigo) do nothing;

-- Dados da Amil (portal do credenciado): ANS 326305, CNPJ 29.309.127/0001-79; entrega dia 1 a 5 (dias úteis), pagamento 30 dias corridos
update operadoras set registro_ans = '326305', cnpj = '29.309.127/0001-79' where nome = 'Amil';
update contratos set regras = regras || jsonb_build_object(
  'entrega', 'Contas entregues do 1º ao 5º dia útil; pagamento 30 dias corridos após a entrega.',
  'recurso_glosa', 'Desde 01/12/2025 a Amil usa o novo catálogo ANS: conferir o DexPara antes do recurso (erro 5007 = código antigo).')
where nome like 'Amil%';
