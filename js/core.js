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
