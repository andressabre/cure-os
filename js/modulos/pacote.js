// Pacote do particular (db/063): autorização do contrato Particular com valor negociado (qtd × valor unitário − desconto),
// pagamentos ligados (entrada + saldo) e NFS-e (nº + PDF anexo). A tabela de referência só sugere o valor; o profissional negocia o pacote dele.
import { sb, estado, $, esc, brl, toast, falha, modal } from '../core.js';
import { FORMAS, fazerNota } from './particular.js';
import { enviarArquivo, abrirArquivo } from './documentos.js';

const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const dBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

export const totalPacote = (a) => Math.max(0, n2(n2(a.qtd_autorizada) * n2(a.valor_unitario) - n2(a.desconto)));
export const pagoPacote = (recs, a) => n2((recs || []).filter((r) => r.autorizacao_id === a.id).reduce((s, r) => s + Number(r.valor_pago), 0));
export const temValor = (a) => a.valor_unitario != null;

// Valor vigente na tabela do contrato do plano (sugestão; nunca é alterado por aqui)
export async function valorTabela(contratoId, procId) {
  if (!contratoId || !procId) return null;
  const { data } = await sb.from('contrato_tabela').select('valor').eq('contrato_id', contratoId).eq('procedimento_id', procId).is('vigencia_fim', null).limit(1).maybeSingle();
  return data ? Number(data.valor) : null;
}

// Linha de resumo para a sanfona da autorização
export function resumoPacote(a, recs) {
  if (!temValor(a)) return '<span class="selo pendente">sem valor</span>';
  const tot = totalPacote(a), pago = pagoPacote(recs, a), saldo = n2(tot - pago);
  const nfPend = a.quer_nota && (recs || []).some((r) => r.autorizacao_id === a.id && !r.nf_numero && !r.nf_arquivo);
  const abaixo = a.valor_tabela != null && n2(a.valor_unitario) < n2(a.valor_tabela);
  return `<span>${a.qtd_autorizada} × ${brl(a.valor_unitario)}${n2(a.desconto) ? ` − ${brl(a.desconto)}` : ''} = <strong>${brl(tot)}</strong></span>
    <span class="selo ${saldo <= 0 ? 'ok' : pago > 0 ? 'pendente' : 'alerta'}">${saldo <= 0 ? 'pago' : pago > 0 ? `pago ${brl(pago)} · falta ${brl(saldo)}` : 'a receber'}</span>
    ${a.quer_nota ? (nfPend ? '<span class="selo alerta">NF pendente</span>' : '') : '<span class="selo outra">sem nota</span>'}
    ${abaixo ? '<span class="selo outra" title="Valor negociado abaixo da tabela vigente">abaixo da tabela</span>' : ''}`;
}

// ctx: { pacienteId, pac:{nome,cpf}, podeAnexar, contratoId }
export async function abrirPacote(a, ctx, aoSalvar) {
  const tabela = a.valor_tabela ?? (await valorTabela(ctx.contratoId, a.procedimento_id));
  let recs = [];
  const carregar = async () => { const { data } = await sb.from('recebimentos').select('*').eq('autorizacao_id', a.id).order('pago_em'); recs = data || []; };
  await carregar();
  modal('<div id="pct"></div>', (m, fechar) => {
    m.classList.add('largo');
    const raiz = $('#pct', m);
    let edit = null, delArm = null;

    const desenhar = () => {
      const tot = totalPacote(a), pago = pagoPacote(recs, a), saldo = n2(tot - pago), r = edit || {};
      raiz.innerHTML = `<h3>📦 Pacote particular — ${esc(a.procedimentos?.descricao || 'serviço')}</h3>
        <form class="grade-form" id="pf1">
          <label class="estreita">Qtd. sessões<input type="number" name="qtd" min="1" value="${a.qtd_autorizada || 1}"></label>
          <label>Valor por sessão (R$)<input type="number" step="0.01" min="0" name="unit" value="${a.valor_unitario ?? tabela ?? 0}"></label>
          <label>Desconto no pacote (R$)<input type="number" step="0.01" min="0" name="desc" value="${n2(a.desconto)}"></label>
          <label style="align-self:end"><input type="checkbox" name="nota" ${a.quer_nota ? 'checked' : ''}> Paciente quer nota</label>
        </form>
        <p class="muted" style="margin:4px 0">${tabela != null ? `Tabela vigente: <strong>${brl(tabela)}</strong> por sessão · <a href="#" id="usartab">usar valor da tabela</a>` : 'Serviço sem valor na tabela vigente — informe o valor negociado.'}
          O valor negociado vale só para este pacote.</p>
        <div class="linha-acoes" style="justify-content:space-between;align-items:center">
          <span>Total <strong id="ptot">${brl(tot)}</strong> · pago <strong>${brl(pago)}</strong> · <strong>${saldo > 0 ? 'falta ' + brl(saldo) : 'quitado'}</strong></span>
          <button class="btn primario" id="psalvar">Salvar pacote</button></div>
        <h4 style="margin:14px 0 6px">Pagamentos</h4>
        ${recs.length ? `<table class="sub-ats"><thead><tr><th>Data</th><th class="num">Valor</th><th>Forma</th><th>Nota</th><th></th></tr></thead><tbody>
          ${recs.map((x) => `<tr><td>${dBR(x.pago_em)}</td><td class="num">${brl(x.valor_pago)}</td><td>${esc(FORMAS[x.forma] || x.forma)}${x.parcelas > 1 ? ' ' + x.parcelas + 'x' : ''}</td>
            <td>${x.nf_numero ? `<span class="selo clinica">NF ${esc(x.nf_numero)}</span>` : x.quer_nota ? '<span class="selo alerta">pendente</span>' : '<span class="selo outra">sem nota</span>'}
              ${x.nf_arquivo ? `<button class="btn pequeno" data-nfopen="${esc(x.nf_arquivo)}">📎 PDF</button>` : ''}</td>
            <td style="white-space:nowrap"><button class="btn pequeno" data-ed="${x.id}">Editar</button> <button class="btn pequeno" data-fn="${x.id}" title="Copia os dados e abre o Emissor Nacional">📄 Fazer nota</button>
              <button class="btn pequeno escuro" data-del="${x.id}">${delArm === x.id ? 'Confirmar exclusão' : 'Excluir'}</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum pagamento registrado.</p>'}
        <form class="grade-form" id="pf2" style="margin-top:10px">
          <label>Valor pago (R$)<input type="number" step="0.01" min="0.01" name="valor" value="${r.valor_pago ?? (saldo > 0 ? saldo : '')}"></label>
          <label>Forma<select name="forma">${Object.entries(FORMAS).map(([k, nm]) => `<option value="${k}" ${k === (r.forma || 'pix') ? 'selected' : ''}>${nm}</option>`).join('')}</select></label>
          <label class="estreita">Parcelas<input type="number" name="parcelas" min="1" max="24" value="${r.parcelas || 1}"></label>
          <label>Pago em<input type="date" name="pago_em" value="${r.pago_em || hoje()}"></label>
          <label>Nº da NFS-e<input name="nf_numero" value="${esc(r.nf_numero || '')}" placeholder="depois de emitir"></label>
          <label>Emitida em<input type="date" name="nf_emitida_em" value="${r.nf_emitida_em || ''}"></label>
          ${ctx.podeAnexar ? `<label class="larga">PDF da NFS-e<input type="file" name="nf_pdf" accept=".pdf,.jpg,.jpeg,.png">${r.nf_arquivo_nome ? `<span class="muted">atual: ${esc(r.nf_arquivo_nome)}</span>` : ''}</label>` : ''}
          <label class="larga">Observação<input name="obs" value="${esc(r.observacao || '')}"></label>
        </form>
        <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button>${edit ? '<button class="btn" id="pcanc">Cancelar edição</button>' : ''}
          <button class="btn primario" id="pgsalvar">${edit ? 'Salvar pagamento' : '＋ Registrar pagamento'}</button></div>
        <p class="muted">Pagamento entra sozinho no caixa do Financeiro pelo valor pago. A nota é emitida no gov.br; cole o número e anexe o PDF aqui.</p>`;
      ligar();
    };

    const ligar = () => {
      m.querySelectorAll('[data-fechar]').forEach((b) => (b.onclick = () => { fechar(); aoSalvar?.(true); }));
      const f1 = $('#pf1', m), f2 = $('#pf2', m);
      const pacoteForm = () => ({ qtd: parseInt(f1.qtd.value) || 0, unit: n2(f1.unit.value), desc: n2(f1.desc.value), nota: f1.nota.checked });
      const refTotal = () => { const p = pacoteForm(); $('#ptot', m).textContent = brl(Math.max(0, p.qtd * p.unit - p.desc)); };
      ['qtd', 'unit', 'desc'].forEach((k) => (f1[k].oninput = refTotal));
      $('#usartab', m)?.addEventListener('click', (ev) => { ev.preventDefault(); f1.unit.value = tabela.toFixed(2); refTotal(); });
      $('#psalvar', m).onclick = async () => {
        const p = pacoteForm();
        const { error } = await sb.rpc('salvar_pacote_particular', { p_aut: a.id, p_qtd: p.qtd, p_valor_unit: p.unit, p_desconto: p.desc, p_quer_nota: p.nota });
        if (error) return falha(error, 'Salvar pacote');
        if (a.valor_tabela == null && tabela != null) await sb.from('autorizacoes').update({ valor_tabela: tabela }).eq('id', a.id).then(() => {}, () => {});
        Object.assign(a, { qtd_autorizada: p.qtd, qtd_solicitada: p.qtd, valor_unitario: p.unit, desconto: p.desc, quer_nota: p.nota }); toast('Pacote salvo.'); desenhar(); aoSalvar?.(false);
      };
      m.querySelectorAll('[data-nfopen]').forEach((b) => (b.onclick = () => abrirArquivo(b.dataset.nfopen)));
      m.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => { edit = recs.find((x) => x.id === b.dataset.ed); delArm = null; desenhar(); }));
      m.querySelectorAll('[data-fn]').forEach((b) => (b.onclick = () => { const x = recs.find((k) => k.id === b.dataset.fn);
        fazerNota({ itens: [{ descricao: `${a.procedimentos?.descricao || 'Pacote'} (pacote de ${a.qtd_autorizada} sessões)`, qtd: 1, valor: x.valor_pago }], valor_pago: x.valor_pago, desconto: 0 }, ctx.pac || {}); }));
      m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
        if (delArm !== b.dataset.del) { delArm = b.dataset.del; return desenhar(); }
        const { error } = await sb.from('recebimentos').delete().eq('id', b.dataset.del);
        if (error) return falha(error); delArm = null; toast('Pagamento excluído.'); await carregar(); desenhar(); aoSalvar?.(false); }));
      $('#pcanc', m)?.addEventListener('click', () => { edit = null; desenhar(); });
      $('#pgsalvar', m).onclick = async () => {
        const f = Object.fromEntries(new FormData(f2)), valor = n2(f.valor);
        if (!(valor > 0)) return toast('Informe o valor pago.', true);
        let up = {};
        try { const arq = f.nf_pdf; if (arq && arq.size) up = await enviarArquivo(arq, `pacientes/${ctx.pacienteId}/notas`); } catch (e) { return falha(e, 'Anexo da nota'); }
        const reg = { valor_pago: valor, valor_tabela: valor, desconto: 0, forma: f.forma, parcelas: Math.max(1, parseInt(f.parcelas) || 1), pago_em: f.pago_em,
          nf_numero: (f.nf_numero || '').trim() || null, nf_emitida_em: f.nf_emitida_em || ((f.nf_numero || '').trim() ? hoje() : null), observacao: f.obs || null,
          quer_nota: a.quer_nota, ...(up.arquivo ? { nf_arquivo: up.arquivo, nf_arquivo_nome: up.arquivo_nome } : {}) };
        const { error } = edit ? await sb.from('recebimentos').update(reg).eq('id', edit.id)
          : await sb.from('recebimentos').insert({ ...reg, clinica_id: estado.clinica.id, autorizacao_id: a.id, paciente_id: ctx.pacienteId,
            profissional_id: estado.profissionalId || a.profissional_id || null, procedimento_id: a.procedimento_id,
            descricao: `Pacote ${a.qtd_autorizada}× ${a.procedimentos?.descricao || ''}`.slice(0, 200) });
        if (error) return falha(error, 'Pagamento');
        edit = null; toast('Pagamento salvo.'); await carregar(); desenhar(); aoSalvar?.(false);
      };
    };
    desenhar();
  });
}
