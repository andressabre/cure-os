// Núcleo compartilhado: conexão, estado da sessão e utilitários de interface.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const sb = createClient(
  'https://paipxhfhwiztznvbxawz.supabase.co',
  'sb_publishable_S_s0TbvaOmGDH0y1x56WYw_4pqe5_PO'
);

export const estado = { user: null, clinica: null, perfil: null, profissionalId: null };

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const data = (d) => d ? new Date(d + (String(d).length === 10 ? 'T12:00' : '')).toLocaleDateString('pt-BR') : '—';

export function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (erro ? ' erro' : ''); t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 4000);
}

export function falha(error, contexto = '') {
  console.error(contexto, error);
  toast(`${contexto ? contexto + ': ' : ''}${error?.message || error}`, true);
}

export function modal(html, aoMontar) {
  const m = $('#modal'), c = $('#modal-caixa');
  c.className = 'modal-caixa'; c.innerHTML = html; m.hidden = false;
  const fechar = () => { m.hidden = true; c.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m) fechar(); };
  $$('[data-fechar]', c).forEach((b) => (b.onclick = fechar));
  aoMontar?.(c, fechar);
  return fechar;
}

// Confirmação dentro da página (confirm() nativo não é confiável em todos os navegadores embutidos)
export function confirmar(texto, rotuloOk = 'Confirmar') {
  return new Promise((res) => {
    modal(`<h3>Confirmar</h3><p>${esc(texto)}</p>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button>
      <button class="btn primario" id="ok">${esc(rotuloOk)}</button></div>`,
    (c, fechar) => {
      $('#ok', c).onclick = () => { fechar(); res(true); };
      $$('[data-fechar]', c).forEach((b) => (b.onclick = () => { fechar(); res(false); }));
    });
  });
}

export function tela(titulo, acoesHtml = '') {
  $('#titulo-tela').textContent = titulo;
  $('#acoes-tela').innerHTML = acoesHtml;
  const c = $('#conteudo');
  c.innerHTML = '<div class="vazio">Carregando…</div>';
  return c;
}

export const podeGerir = () => ['gestor', 'financeiro'].includes(estado.perfil);

// Telefones: grava só dígitos com 55 na frente; mostra +55 (DD) 9XXXX-XXXX. Exige DDD.
export const foneDig = (v) => { let d = String(v || '').replace(/\D/g, '').replace(/^0+/, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d; };
export const foneFmt = (v) => { const d = foneDig(v); const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : String(v || ''); };
export const foneValido = (v, cel = false) => { const d = foneDig(v); return !d || (cel ? /^55\d{2}9\d{8}$/ : /^55\d{10,11}$/).test(d); };
export function mascaraFone(inp) {
  if (!inp) return;
  // O "+55" que a própria máscara escreve não pode ser lido como dígito digitado (bug "55…" de 13/11/2026)
  const aplica = () => { const v = inp.value.trim();
    const d = (v.startsWith('+55') ? v.slice(3).replace(/\D/g, '') : v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')).replace(/^0+/, '').slice(0, 11);
    inp.value = !d ? '' : d.length <= 2 ? `+55 (${d}` : d.length <= 6 ? `+55 (${d.slice(0, 2)}) ${d.slice(2)}`
      : `+55 (${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`; };
  inp.addEventListener('input', aplica); inp.inputMode = 'numeric'; inp.placeholder = '+55 (47) 99999-9999';
  if (inp.value) { inp.value = inp.value.replace(/\D/g, '').length >= 10 ? foneFmt(inp.value) : inp.value; }
}
// Campo só números (carteirinha, CNS…)
export function soNumeros(inp) { if (inp) { inp.inputMode = 'numeric'; inp.addEventListener('input', () => (inp.value = inp.value.replace(/\D/g, ''))); } }

// CID-10 (DATASUS, lista local em dados/cid10.json — carregada só quando usada)
let _cid = null;
export async function descricaoCid(cod) {
  _cid ||= fetch('dados/cid10.json').then((r) => r.json()).catch(() => ({}));
  const t = await _cid, c = normCid(cod);
  return t[c] || t[c.slice(0, 3)] || '';
}
export const normCid = (v) => { const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return c.length > 3 ? c.slice(0, 3) + '.' + c.slice(3, 4) : c; };
