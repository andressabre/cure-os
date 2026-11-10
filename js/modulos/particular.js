// Recebimento do particular (db/030): procedimento da tabela particular, desconto (o profissional decide), forma de pagamento,
// nº da NFS-e (emitida no Emissor Nacional gov.br) — o gatilho no banco lança no caixa/DRE do Financeiro.
import { sb, estado, $, esc, brl, toast, falha, modal, confirmar } from '../core.js';

export const FORMAS = { pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito à vista', credito_parcelado: 'Crédito parcelado', transferencia: 'Transferência', outro: 'Outro' };
export const EMISSOR_NFSE = 'https://www.nfse.gov.br/EmissorNacional';
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

// Itens da tabela do contrato "Particular" vigente (tipo_guia PARTICULAR)
async function tabelaParticular() {
  const { data } = await sb.from('contrato_tabela').select('valor, procedimentos(id, codigo, descricao), contratos!inner(clinica_id, regras, nome)')
    .eq('contratos.clinica_id', estado.clinica.id).eq('tipo_guia', 'PARTICULAR').is('vigencia_fim', null);
  return (data || []).map((t) => ({ id: t.procedimentos.id, codigo: t.procedimentos.codigo, descricao: t.procedimentos.descricao, valor: Number(t.valor) }))
    .sort((a, b) => a.descricao.localeCompare(b.descricao));
}

// at: { id, paciente_id, profissional_id, servico } ; rec: recebimento existente (editar NF/valores)
export async function registrarPagamento(at, aoSalvar, rec = null) {
  const itens = await tabelaParticular();
  const r = rec || {};
  modal(`<h3>💲 ${rec ? 'Pagamento registrado' : 'Registrar pagamento'} — particular</h3>
    <form class="grade-form" id="fp">
      <label style="grid-column:1/-1">Procedimento<select name="procedimento_id" id="pp"><option value="">— outro (valor livre) —</option>
        ${itens.map((i) => `<option value="${i.id}" data-v="${i.valor}" ${i.id === r.procedimento_id ? 'selected' : ''}>${esc(i.descricao)} · ${brl(i.valor)}</option>`).join('')}</select></label>
      <label>Valor de tabela<input type="number" step="0.01" min="0" name="valor_tabela" id="pv" value="${r.valor_tabela ?? ''}"></label>
      <label>Desconto (R$)<input type="number" step="0.01" min="0" name="desconto" id="pd" value="${r.desconto ?? 0}"></label>
      <label>Desconto (%)<input type="number" step="0.1" min="0" max="100" id="ppct" placeholder="opcional"></label>
      <label>Valor pago<input type="number" step="0.01" min="0" name="valor_pago" id="ppago" value="${r.valor_pago ?? ''}" required></label>
      <label>Forma<select name="forma" id="pf">${Object.entries(FORMAS).map(([k, n]) => `<option value="${k}" ${k === (r.forma || 'pix') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Parcelas<input type="number" name="parcelas" id="ppar" min="1" max="24" value="${r.parcelas || 1}"></label>
      <label>Pago em<input type="date" name="pago_em" value="${r.pago_em || hoje()}"></label>
      <label style="grid-column:1/-1">Descrição (se "outro")<input name="descricao" value="${esc(r.descricao || '')}" placeholder="ex.: consulta de nutrição"></label>
      <label>Nº da NFS-e<input name="nf_numero" value="${esc(r.nf_numero || '')}" placeholder="pode preencher depois"></label>
      <label>Emitida em<input type="date" name="nf_emitida_em" value="${r.nf_emitida_em || ''}"></label>
      <label style="grid-column:1/-1">Observação<input name="observacao" value="${esc(r.observacao || '')}"></label>
    </form>
    <p class="muted">Desconto é decisão do profissional. A nota é emitida no <a href="${EMISSOR_NFSE}" target="_blank" rel="noopener">Emissor Nacional de NFS-e (gov.br)</a>;
      aqui fica só o número. O pagamento entra sozinho no caixa do Financeiro.</p>
    <div class="linha-acoes">${rec ? '<button class="btn escuro" id="pdel">Excluir pagamento</button>' : ''}<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="pok">Salvar</button></div>`,
  (m, fechar) => {
    const v = $('#pv', m), d = $('#pd', m), pct = $('#ppct', m), pago = $('#ppago', m);
    const recalc = () => { const t = Number(v.value) || 0, ds = Number(d.value) || 0; if (t) pago.value = Math.max(0, t - ds).toFixed(2); };
    $('#pp', m).onchange = (e) => { const o = e.target.selectedOptions[0]; if (o?.dataset.v) { v.value = o.dataset.v; recalc(); } };
    d.oninput = () => { pct.value = ''; recalc(); };
    pct.oninput = () => { const t = Number(v.value) || 0; d.value = (t * (Number(pct.value) || 0) / 100).toFixed(2); recalc(); };
    $('#pf', m).onchange = (e) => { if (e.target.value !== 'credito_parcelado') $('#ppar', m).value = 1; };
    if (!rec && $('#pp', m).value === '' && at.servico) {   // sugere pelo serviço
      const o = [...$('#pp', m).options].find((x) => x.text.toLowerCase().includes(at.servico.toLowerCase().split(' ')[0]));
      if (o) { $('#pp', m).value = o.value; $('#pp', m).onchange({ target: $('#pp', m) }); }
    }
    $('#pdel', m)?.addEventListener('click', async () => {
      if (!(await confirmar('Excluir este pagamento? O lançamento no caixa fica como cancelado.', 'Excluir'))) return;
      const { error } = await sb.from('recebimentos').delete().eq('id', rec.id);
      if (error) return falha(error); toast('Pagamento excluído.'); aoSalvar?.();
    });
    $('#pok', m).onclick = async () => {
      const f = Object.fromEntries(new FormData($('#fp', m)));
      if (!(Number(f.valor_pago) >= 0) || f.valor_pago === '') return toast('Informe o valor pago.', true);
      if (!f.procedimento_id && !f.descricao.trim()) return toast('Escolha o procedimento ou descreva o serviço.', true);
      const reg = { procedimento_id: f.procedimento_id || null, descricao: f.descricao.trim() || null, valor_tabela: f.valor_tabela ? Number(f.valor_tabela) : null,
        desconto: Number(f.desconto) || 0, valor_pago: Number(f.valor_pago), forma: f.forma, parcelas: Math.max(1, parseInt(f.parcelas) || 1),
        pago_em: f.pago_em, nf_numero: f.nf_numero.trim() || null, nf_emitida_em: f.nf_emitida_em || null, observacao: f.observacao || null };
      const { error } = rec ? await sb.from('recebimentos').update(reg).eq('id', rec.id)
        : await sb.from('recebimentos').insert({ ...reg, clinica_id: estado.clinica.id, atendimento_id: at.id || null, paciente_id: at.paciente_id, profissional_id: at.profissional_id });
      if (error) return falha(error, 'Pagamento');
      fechar(); toast(reg.nf_numero ? 'Pagamento salvo.' : 'Pagamento salvo — NFS-e pendente.'); aoSalvar?.();
    };
  });
}

export const seloPagamento = (r) => !r ? '<span class="selo pendente">a receber</span>'
  : `<span class="selo ok">pago ${brl(r.valor_pago)}</span>${Number(r.desconto) ? ` <span class="muted">(desc. ${brl(r.desconto)})</span>` : ''}
     ${r.nf_numero ? `<span class="selo clinica">NF ${esc(r.nf_numero)}</span>` : '<span class="selo alerta">NF pendente</span>'}`;
