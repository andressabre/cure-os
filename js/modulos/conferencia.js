// Conferência de pagamento (gestão): relatório mensal do profissional × Demonstrativo de Pagamento da operadora, cruzados pela senha.
// Tudo roda no navegador: os arquivos não sobem para o servidor e nada é gravado. Resultado = tela + CSV. A gestora confere antes de pagar o profissional.
import { $, $$, esc, brl, data, tela, toast } from '../core.js';
import { lerDemonstrativoAmil, lerRelatorioProfissional, cruzar, resumo, csv, linhasDeItens, SITUACOES } from './conferencia-pagamento.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const COR = { pago: 'ok', glosa_parcial: 'alerta', glosado: 'erro', aguardando: 'outra', atrasado: 'alerta' };

async function linhasDoPdf(arquivo) {
  const pdfjs = await import(PDFJS + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const linhas = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const t = await (await doc.getPage(p)).getTextContent();
    linhas.push(...linhasDeItens(t.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }))));
  }
  return linhas;
}
async function linhasDaPlanilha(arquivo) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: false });
  return wb.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).map((r) => r.join('   ')));
}
const linhasDe = (f) => (/\.pdf$/i.test(f.name) ? linhasDoPdf(f) : /\.(xlsx|xls)$/i.test(f.name) ? linhasDaPlanilha(f) : f.text().then((t) => t.split(/\r?\n/).map((l) => l.replace(/[;\t]/g, '   '))));

export async function render() {
  const c = tela('Conferência de pagamento');
  c.innerHTML = `<div class="cartao"><p class="muted" style="margin-top:0">Cruza o relatório mensal do profissional com o Demonstrativo de Pagamento da operadora pela <strong>senha</strong>.
      Os arquivos são lidos aqui no navegador, não são enviados nem guardados. A guia que não aparece ainda pode só não ter sido paga.</p>
    <div class="grade-form">
      <label>Demonstrativos de Pagamento da Amil (PDF, pode escolher vários)<input type="file" id="f-amil" accept=".pdf" multiple></label>
      <label>Relatório do profissional (PDF, Excel ou CSV)<input type="file" id="f-rel" accept=".pdf,.xlsx,.xls,.csv,.txt" multiple></label>
      <label>Alertar atraso após (dias do atendimento)<input type="number" id="prazo" min="1" value="60"></label></div>
    <div class="linha-acoes"><button class="btn primario" id="conferir">Conferir</button></div></div><div id="res"></div>`;
  let linhas = [], guias = [], filtro = 'todos';
  const pinta = () => {
    const por = (s) => linhas.filter((l) => l.situacao === s), vis = filtro === 'todos' ? linhas : por(filtro), r = resumo(linhas, guias);
    const chip = (k, n, q) => `<button class="btn pequeno ${filtro === k ? 'primario' : ''}" data-f="${k}">${n} (${q})</button>`;
    $('#res', c).innerHTML = `<div class="kpis">
      <div class="kpi"><div class="rotulo">Repasse a pagar (confirmado pela operadora)</div><div class="valor">${brl(r.repasseAPagar)}</div></div>
      <div class="kpi"><div class="rotulo">Ainda sem retorno (aguardando/atrasado)</div><div class="valor">${brl(r.repasseNaoPago)}</div></div>
      <div class="kpi"><div class="rotulo">Guias da operadora de outros profissionais</div><div class="valor">${r.guiasDeOutros}</div></div></div>
      <p style="margin:12px 0">${chip('todos', 'Todos', linhas.length)} ${Object.entries(SITUACOES).map(([k, n]) => chip(k, n, por(k).length)).join(' ')}
        <button class="btn pequeno" id="baixar">Baixar CSV</button></p>
      <p class="muted">Glosa total desconta 100% do repasse do item; glosa parcial desconta na proporção do que a operadora pagou. Confirme antes de pagar.</p>
      <div class="cartao tabela-rolagem"><table><thead><tr><th>Origem</th><th>Nome</th><th>Data</th><th>Senha</th><th>Situação</th><th class="num">Valor no relatório</th><th class="num">Repasse a pagar</th><th>Pagamento da operadora</th><th>Avisos</th></tr></thead><tbody>
      ${vis.map((l) => `<tr><td>${esc(l.origem)}</td><td>${esc(l.nome)}</td><td>${l.data ? data(l.data) : ''}</td><td>${esc(l.senha)}</td>
        <td><span class="selo ${COR[l.situacao]}">${SITUACOES[l.situacao]}</span></td><td class="num">${brl(l.valor)}</td><td class="num">${l.repasse == null ? '—' : brl(l.repasse)}</td>
        <td>${l.pagamento ? data(l.pagamento) : ''}</td><td>${esc([l.obs, ...l.avisos].filter(Boolean).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nada nesta situação.</td></tr>'}</tbody></table></div>`;
    $$('[data-f]', c).forEach((b) => (b.onclick = () => { filtro = b.dataset.f; pinta(); }));
    $('#baixar', c).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(linhas)], { type: 'text/csv;charset=utf-8' })); a.download = 'conferencia-pagamento.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  };
  $('#conferir', c).onclick = async () => {
    const fa = [...$('#f-amil', c).files], fr = [...$('#f-rel', c).files];
    if (!fa.length || !fr.length) return toast('Escolha os demonstrativos da operadora e o relatório do profissional.', true);
    $('#conferir', c).disabled = true; $('#res', c).innerHTML = '<div class="vazio">Lendo arquivos…</div>';
    try {
      guias = []; const itens = [], avisos = [];
      for (const f of fa) { const g = lerDemonstrativoAmil(await linhasDe(f)); if (!g.length) avisos.push(`Nenhuma guia lida em ${f.name} (é o Demonstrativo de Pagamento?)`); guias.push(...g); }
      for (const f of fr) { const r = lerRelatorioProfissional(await linhasDe(f), f.name.replace(/\.[^.]+$/, '')); if (!r.itens.length) avisos.push(`Nenhuma linha lida em ${f.name}`); if (r.naoLidas.length) avisos.push(`${r.naoLidas.length} linha(s) de ${f.name} com senha, mas fora do formato`); itens.push(...r.itens); }
      linhas = cruzar(itens, guias, { prazoDias: Number($('#prazo', c).value) || 60 }); filtro = 'todos'; pinta();
      if (avisos.length) $('#res', c).insertAdjacentHTML('afterbegin', `<div class="cartao"><strong>Atenção</strong><br>${avisos.map(esc).join('<br>')}</div>`);
    } catch (e) { $('#res', c).innerHTML = ''; toast('Não consegui ler os arquivos: ' + (e.message || e), true); }
    $('#conferir', c).disabled = false;
  };
}
