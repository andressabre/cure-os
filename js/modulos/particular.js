// Recebimento do particular (db/030 + 031): itens (procedimento, qtd, valor), desconto (o profissional decide), forma de pagamento,
// total e nº da NFS-e. A nota é emitida no Emissor Nacional (gov.br): o botão "Fazer a nota" copia os dados e abre o emissor.
// O gatilho no banco lança o recebimento no caixa/DRE do Financeiro.
import { sb, estado, $, $$, esc, brl, toast, falha, modal, confirmar } from '../core.js';

export const FORMAS = { pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito à vista', credito_parcelado: 'Crédito parcelado', transferencia: 'Transferência', outro: 'Outro' };
export const EMISSOR_NFSE = 'https://www.nfse.gov.br/EmissorNacional';
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function tabelaParticular() {
  const { data } = await sb.from('contrato_tabela').select('valor, procedimentos(id, codigo, descricao), contratos!inner(clinica_id)')
    .eq('contratos.clinica_id', estado.clinica.id).eq('tipo_guia', 'PARTICULAR').is('vigencia_fim', null);
  return (data || []).map((t) => ({ id: t.procedimentos.id, codigo: t.procedimentos.codigo, descricao: t.procedimentos.descricao, valor: Number(t.valor) }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao));
}

// Itens gravados (db/031) ou, em registro antigo, o procedimento único
export const itensDe = (r) => (r?.itens?.length ? r.itens
  : r ? [{ procedimento_id: r.procedimento_id, descricao: r.descricao || '', qtd: 1, valor: Number(r.valor_tabela ?? r.valor_pago) }] : []);
export const resumoItens = (r) => itensDe(r).map((i) => `${i.descricao || 'item'}${Number(i.qtd) > 1 ? ' ×' + i.qtd : ''}`).join(' + ');

// at: { id, paciente_id, profissional_id, servico } · rec: recebimento existente · pac: { nome, cpf } para a nota
export async function registrarPagamento(at, aoSalvar, rec = null, pac = null) {
  const tab = await tabelaParticular();
  let itens = itensDe(rec).map((i) => ({ ...i }));
  if (!itens.length) {   // sugere o 1º item pelo serviço do agendamento
    const s = (at.servico || '').toLowerCase().split(/[ /]/)[0];
    const t = s && tab.find((x) => x.descricao.toLowerCase().includes(s));
    itens = [t ? { procedimento_id: t.id, descricao: t.descricao, qtd: 1, valor: t.valor } : { procedimento_id: null, descricao: '', qtd: 1, valor: 0 }];
  }
  const r = rec || {};
  modal(`<h3>💲 Pagamento — particular</h3>
    <table class="itens-pg"><thead><tr><th>Procedimento</th><th class="num">Qtd</th><th class="num">Valor</th><th class="num">Total</th><th></th></tr></thead><tbody id="ilist"></tbody></table>
    <button class="btn pequeno" id="iadd">+ item</button>
    <form class="grade-form" id="fp" style="margin-top:10px">
      <label>Desconto (R$)<input type="number" step="0.01" min="0" id="pd" value="${r.desconto ?? 0}"></label>
      <label>Desconto (%)<input type="number" step="0.1" min="0" max="100" id="ppct" placeholder="opcional"></label>
      <label>Forma de pagamento<select name="forma" id="pf">${Object.entries(FORMAS).map(([k, nm]) => `<option value="${k}" ${k === (r.forma || 'pix') ? 'selected' : ''}>${nm}</option>`).join('')}</select></label>
      <label>Parcelas<input type="number" name="parcelas" id="ppar" min="1" max="24" value="${r.parcelas || 1}"></label>
      <label>Pago em<input type="date" name="pago_em" value="${r.pago_em || hoje()}"></label>
      <label>Nº da NFS-e<input name="nf_numero" value="${esc(r.nf_numero || '')}" placeholder="depois de emitir"></label>
      <label>Emitida em<input type="date" name="nf_emitida_em" value="${r.nf_emitida_em || ''}"></label>
      <label style="grid-column:1/-1">Observação<input name="observacao" value="${esc(r.observacao || '')}"></label>
    </form>
    <div class="linha-acoes" style="justify-content:space-between;align-items:center">
      <span>Subtotal <strong id="tsub"></strong> · desconto <strong id="tdesc"></strong> · <span style="font-size:1.15em">Total <strong id="ttot"></strong></span></span>
      <button class="btn" id="pnota" title="Copia os dados e abre o Emissor Nacional (gov.br)">📄 Fazer a nota</button></div>
    <p class="muted">Desconto é decisão do profissional. Depois de emitir a nota no gov.br, cole o número aqui. O pagamento entra sozinho no caixa do Financeiro.</p>
    <div class="linha-acoes">${rec ? '<button class="btn escuro" id="pdel">Excluir pagamento</button>' : ''}<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="pok">Salvar</button></div>`,
  (m, fechar) => {
    m.classList.add('largo');
    const d = $('#pd', m), pct = $('#ppct', m);
    const subtotal = () => n2(itens.reduce((s, i) => s + n2(i.qtd) * n2(i.valor), 0));
    const total = () => Math.max(0, n2(subtotal() - n2(d.value)));
    const totais = () => { $('#tsub', m).textContent = brl(subtotal()); $('#tdesc', m).textContent = brl(d.value); $('#ttot', m).textContent = brl(total()); };
    function desenhar() {
      $('#ilist', m).innerHTML = itens.map((i, k) => `<tr>
        <td><select data-k="${k}" class="i-proc" style="max-width:340px"><option value="">— outro (descrever) —</option>
          ${tab.map((t) => `<option value="${t.id}" ${t.id === i.procedimento_id ? 'selected' : ''}>${esc(t.descricao)}</option>`).join('')}</select>
          ${i.procedimento_id ? '' : `<input data-k="${k}" class="i-desc" placeholder="ex.: consulta de nutrição" value="${esc(i.descricao)}">`}</td>
        <td class="num"><input data-k="${k}" class="i-qtd" type="number" min="1" step="1" value="${i.qtd}" style="width:60px"></td>
        <td class="num"><input data-k="${k}" class="i-val" type="number" min="0" step="0.01" value="${i.valor}" style="width:90px"></td>
        <td class="num">${brl(n2(i.qtd) * n2(i.valor))}</td>
        <td>${itens.length > 1 ? `<button class="btn pequeno" data-rm="${k}">✕</button>` : ''}</td></tr>`).join('');
      $$('.i-proc', m).forEach((s) => (s.onchange = () => { const t = tab.find((x) => x.id === s.value), i = itens[s.dataset.k];
        i.procedimento_id = t?.id || null; i.descricao = t?.descricao || ''; if (t) i.valor = t.valor; desenhar(); }));
      $$('.i-desc', m).forEach((x) => (x.oninput = () => (itens[x.dataset.k].descricao = x.value)));
      $$('.i-qtd', m).forEach((x) => (x.onchange = () => { itens[x.dataset.k].qtd = Math.max(1, parseInt(x.value) || 1); desenhar(); }));
      $$('.i-val', m).forEach((x) => (x.onchange = () => { itens[x.dataset.k].valor = n2(x.value); desenhar(); }));
      $$('[data-rm]', m).forEach((b) => (b.onclick = () => { itens.splice(Number(b.dataset.rm), 1); desenhar(); }));
      if (pct.value) d.value = (subtotal() * (Number(pct.value) || 0) / 100).toFixed(2);
      totais();
    }
    $('#iadd', m).onclick = () => { itens.push({ procedimento_id: null, descricao: '', qtd: 1, valor: 0 }); desenhar(); };
    d.oninput = () => { pct.value = ''; totais(); };
    pct.oninput = () => { d.value = (subtotal() * (Number(pct.value) || 0) / 100).toFixed(2); totais(); };
    $('#pf', m).onchange = (e) => { if (e.target.value !== 'credito_parcelado') $('#ppar', m).value = 1; };
    desenhar();

    $('#pnota', m).onclick = () => fazerNota({ itens, valor_pago: total(), desconto: n2(d.value) }, pac || at.pacientes || {});
    $('#pdel', m)?.addEventListener('click', async () => { if (await excluirPagamento(rec)) { fechar(); aoSalvar?.(); } });
    $('#pok', m).onclick = async () => {
      const f = Object.fromEntries(new FormData($('#fp', m)));
      if (itens.some((i) => !i.procedimento_id && !i.descricao.trim())) return toast('Descreva o item "outro".', true);
      if (n2(d.value) > subtotal()) return toast('Desconto maior que o subtotal.', true);
      const reg = { itens: itens.map((i) => ({ procedimento_id: i.procedimento_id, descricao: i.descricao.trim(), qtd: n2(i.qtd), valor: n2(i.valor) })),
        procedimento_id: itens.find((i) => i.procedimento_id)?.procedimento_id || null, descricao: resumoItens({ itens }).slice(0, 200),
        valor_tabela: subtotal(), desconto: n2(d.value), valor_pago: total(), forma: f.forma, parcelas: Math.max(1, parseInt(f.parcelas) || 1),
        pago_em: f.pago_em, nf_numero: f.nf_numero.trim() || null, nf_emitida_em: f.nf_emitida_em || (f.nf_numero.trim() ? hoje() : null), observacao: f.observacao || null };
      const { error } = rec ? await sb.from('recebimentos').update(reg).eq('id', rec.id)
        : await sb.from('recebimentos').insert({ ...reg, clinica_id: estado.clinica.id, atendimento_id: at.id || null, paciente_id: at.paciente_id, profissional_id: at.profissional_id });
      if (error) return falha(error, 'Pagamento');
      fechar(); toast(reg.nf_numero ? 'Pagamento salvo.' : 'Pagamento salvo — NFS-e pendente.'); aoSalvar?.();
    };
  });
}

export async function excluirPagamento(rec) {
  if (!rec || !(await confirmar('Excluir este pagamento? O lançamento no caixa fica como cancelado.', 'Excluir pagamento'))) return false;
  const { error } = await sb.from('recebimentos').delete().eq('id', rec.id);
  if (error) { falha(error); return false; }
  toast('Pagamento excluído.'); return true;
}

// Sem API de NFS-e (exigiria certificado/serviço pago): copia os dados do serviço e abre o Emissor Nacional
export async function fazerNota(r, pac) {
  const its = itensDe(r);
  const texto = [`Tomador: ${pac.nome || ''}${pac.cpf ? ' · CPF ' + pac.cpf : ''}`,
    `Serviço: ${its.map((i) => `${i.descricao}${Number(i.qtd) > 1 ? ' (' + i.qtd + 'x)' : ''}`).join('; ')}`,
    `Valor: ${brl(r.valor_pago)}${Number(r.desconto) ? ` (desconto de ${brl(r.desconto)} já aplicado)` : ''}`].join('\n');
  const janela = window.open(EMISSOR_NFSE, '_blank', 'noopener');
  try { await navigator.clipboard.writeText(texto); toast('Dados da nota copiados — cole no Emissor Nacional.' + (janela ? '' : ' Abra: ' + EMISSOR_NFSE)); }
  catch { modal(`<h3>Dados para a nota</h3><textarea rows="5" style="width:100%">${esc(texto)}</textarea>
    <p><a href="${EMISSOR_NFSE}" target="_blank" rel="noopener">Abrir o Emissor Nacional</a></p><div class="linha-acoes"><button class="btn" data-fechar>Fechar</button></div>`); }
  if (!pac.cpf) toast('Paciente sem CPF no cadastro: a nota precisa do CPF do tomador.', true);
}

// Resumo de uma linha para tabelas: itens · forma · total · NF
export const seloPagamento = (r) => !r ? '<span class="selo pendente">a receber</span>'
  : `<span class="muted">${esc(resumoItens(r))} · ${esc(FORMAS[r.forma] || r.forma)}${r.parcelas > 1 ? ' ' + r.parcelas + 'x' : ''}</span>
     <span class="selo ok">${brl(r.valor_pago)}</span>${Number(r.desconto) ? ` <span class="muted">(desc. ${brl(r.desconto)})</span>` : ''}
     ${r.nf_numero ? `<span class="selo clinica">NF ${esc(r.nf_numero)}</span>` : '<span class="selo alerta">NF pendente</span>'}`;
