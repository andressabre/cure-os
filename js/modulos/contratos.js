// Módulo Convênios e contratos (lista): CNPJs de faturamento (minimizado), contratos com filtro/ordenação e operadoras.
// A edição do contrato fica na página própria #contrato-<id> (contrato.js).
import { sb, estado, $, $$, esc, tela, toast, falha, modal, confirmar } from '../core.js';

const TIPO = { proprio: 'Próprio', intermediario: 'Intermediário', outro: 'Outro' };

const COLS = [['op', 'Operadora'], ['cnpj', 'Faturado pelo CNPJ'], ['cod', 'Cód. prestador'], ['tiss', 'TISS'], ['prazo', 'Prazos (envio / recurso)']];
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export async function render() {
  const c = tela('Convênios e contratos', `<button class="btn" id="n-cnpj">+ CNPJ</button>
    <a class="btn primario" href="#contrato-novo">+ Contrato</a>`);
  const cid = estado.clinica.id;
  const flt = { q: '', op: '', cnpj: '', ativo: 'ativos', ord: 'op', dir: 1, ...JSON.parse(sessionStorage.getItem('ct_filtro') || '{}') };
  const [{ data: cnpjs }, { data: ops }, { data: cts, error }] = await Promise.all([
    sb.from('cnpjs_faturamento').select('*').eq('clinica_id', cid).order('ordem'),
    sb.from('operadoras').select('id, nome').eq('clinica_id', cid).order('nome'),
    sb.from('contratos').select('id, nome, ativo, operadora_id, cnpj_faturamento_id, codigo_prestador_operadora, versao_tiss, prazo_envio_dias, prazo_recurso_dias, operadoras(nome), cnpjs_faturamento(razao_social, tipo, ordem)').eq('clinica_id', cid).order('nome'),
  ]);
  if (error) return falha(error);

  c.innerHTML = `
    <details class="cartao" id="sec-cnpjs"><summary><strong>CNPJs de faturamento</strong> <span class="dica-inline">— ${cnpjs.length} cadastrados · clique para abrir</span></summary>
      <div class="dica" style="margin-top:12px">A ordem define a sugestão no cadastro do contrato: 1 = CNPJ da Cure, 2 e 3 = intermediários.</div>
      <table><thead><tr><th>Ordem</th><th>Razão social</th><th>CNPJ</th><th>CNES</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${cnpjs.map((x) => `<tr><td>${x.ordem}</td><td>${esc(x.razao_social)}</td><td>${esc(x.cnpj)}</td><td>${esc(x.cnes)}</td>
        <td>${TIPO[x.tipo]}</td><td><button class="btn pequeno" data-ed-cnpj="${x.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum CNPJ</td></tr>'}
      </tbody></table></details>
    <div class="cartao"><h3>Contratos</h3>
      <div class="filtros-ct">
        <input type="search" id="f-q" placeholder="Buscar operadora, contrato, código…" value="${esc(flt.q)}">
        <select id="f-op"><option value="">Todas as operadoras</option>${ops.map((o) => `<option value="${o.id}" ${flt.op === o.id ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select>
        <select id="f-cnpj"><option value="">Todos os CNPJs</option>${cnpjs.map((x) => `<option value="${x.id}" ${flt.cnpj === x.id ? 'selected' : ''}>${x.ordem}. ${esc(x.razao_social)}</option>`).join('')}</select>
        <select id="f-ativo">${[['ativos', 'Só ativos'], ['inativos', 'Só inativos'], ['todos', 'Todos']].map(([v, n]) => `<option value="${v}" ${flt.ativo === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span class="dica-inline" id="f-cont"></span>
      </div>
      <div class="tabela-rolagem"><table class="tab-uma-linha"><thead><tr>
        ${COLS.map(([k, n]) => `<th class="ord" data-ord="${k}">${n}<span class="seta"></span></th>`).join('')}<th>Tabelas</th><th></th></tr></thead>
        <tbody id="ct-corpo"></tbody></table></div></div>`;

  const valor = { op: (k) => k.operadoras?.nome, cnpj: (k) => `${k.cnpjs_faturamento?.ordem ?? ''}. ${k.cnpjs_faturamento?.razao_social ?? ''}`,
    cod: (k) => k.codigo_prestador_operadora, tiss: (k) => k.versao_tiss, prazo: (k) => k.prazo_envio_dias ?? -1 };
  const chave = (k) => `${k.operadora_id}|${k.cnpj_faturamento_id}`;
  const contagem = {}; cts.forEach((k) => (contagem[chave(k)] = (contagem[chave(k)] || 0) + 1));
  const repetido = new Set(Object.keys(contagem).filter((x) => contagem[x] > 1));   // mesmo operadora + CNPJ em 2+ contratos: mostra o nome para diferenciar
  const pintar = () => {
    const q = norm(flt.q);
    let lista = cts.filter((k) => (flt.ativo === 'todos' || (flt.ativo === 'ativos') === (k.ativo !== false))
      && (!flt.op || k.operadora_id === flt.op) && (!flt.cnpj || k.cnpj_faturamento_id === flt.cnpj)
      && (!q || norm([k.nome, k.operadoras?.nome, k.codigo_prestador_operadora, k.cnpjs_faturamento?.razao_social].join(' ')).includes(q)));
    const f = valor[flt.ord] || valor.op;
    lista = [...lista].sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR')) * flt.dir || String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
    $('#ct-corpo', c).innerHTML = lista.map((k) => `<tr class="${k.ativo === false ? 'inativo' : ''}"><td><strong>${esc(k.operadoras?.nome)}</strong>${repetido.has(chave(k)) ? ` <span class="dica-inline">${esc(k.nome)}</span>` : ''}</td>
      <td class="corta" title="${esc(k.cnpjs_faturamento?.razao_social)}">${k.cnpjs_faturamento?.ordem}. ${esc(k.cnpjs_faturamento?.razao_social)}</td><td>${esc(k.codigo_prestador_operadora)}</td>
      <td>${esc(k.versao_tiss)}</td><td>${k.prazo_envio_dias ?? '—'} / ${k.prazo_recurso_dias ?? '—'} dias</td>
      <td><a class="btn pequeno" href="#contrato-${k.id}-tabelas">Tabelas</a></td>
      <td><a class="btn pequeno icone" href="#contrato-${k.id}" title="Editar contrato" aria-label="Editar contrato">✏️</a></td></tr>`).join('')
      || '<tr><td colspan="7" class="vazio">Nenhum contrato com esses filtros</td></tr>';
    $('#f-cont', c).textContent = `${lista.length} de ${cts.length}`;
    $$('th.ord', c).forEach((th) => { th.querySelector('.seta').textContent = th.dataset.ord === flt.ord ? (flt.dir > 0 ? ' ▲' : ' ▼') : ''; });
    sessionStorage.setItem('ct_filtro', JSON.stringify(flt));
  };
  $('#f-q', c).oninput = (e) => { flt.q = e.target.value; pintar(); };
  $('#f-op', c).onchange = (e) => { flt.op = e.target.value; pintar(); };
  $('#f-cnpj', c).onchange = (e) => { flt.cnpj = e.target.value; pintar(); };
  $('#f-ativo', c).onchange = (e) => { flt.ativo = e.target.value; pintar(); };
  $$('th.ord', c).forEach((th) => (th.onclick = () => { flt.dir = flt.ord === th.dataset.ord ? -flt.dir : 1; flt.ord = th.dataset.ord; pintar(); }));
  pintar();

  const salvar = async (tabela, obj, id, fechar) => {
    const q = id ? sb.from(tabela).update(obj).eq('id', id) : sb.from(tabela).insert({ ...obj, clinica_id: cid });
    const { error: e } = await q; if (e) return falha(e); fechar(); toast('Salvo.'); render();
  };

  const formCnpj = (x = {}) => modal(`<h3>${x.id ? 'Editar' : 'Novo'} CNPJ de faturamento</h3><form class="grade-form" id="f">
    <label>Razão social<input name="razao_social" required value="${esc(x.razao_social)}"></label>
    <label>CNPJ<input name="cnpj" required value="${esc(x.cnpj)}"></label>
    <label>CNES<input name="cnes" value="${esc(x.cnes)}"></label>
    <label>Tipo<select name="tipo">${Object.entries(TIPO).map(([k, v]) => `<option value="${k}" ${x.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Ordem<select name="ordem">${[1, 2, 3].map((n) => `<option ${x.ordem === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
  (m, fechar) => ($('#s', m).onclick = () => {
    const f = Object.fromEntries(new FormData($('#f', m))); f.ordem = Number(f.ordem);
    if (!f.razao_social || !f.cnpj) return toast('Preencha razão social e CNPJ.', true);
    salvar('cnpjs_faturamento', f, x.id, fechar);
  }));

  $('#n-cnpj').onclick = () => formCnpj();
  $$('[data-ed-cnpj]', c).forEach((b) => (b.onclick = () => formCnpj(cnpjs.find((x) => x.id === b.dataset.edCnpj))));
}
