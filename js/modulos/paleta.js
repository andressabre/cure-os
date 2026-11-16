// Paleta de comandos (Ctrl+K / Cmd+K): pular para uma tela, achar paciente, ações rápidas.
// Elemento próprio no <body> (não usa o modal() do core). Não guarda nome de paciente em lugar nenhum;
// só os ids das últimas telas usadas (localStorage) para ordenar.
import { sb, estado, esc, data } from '../core.js';

const CHAVE_RECENTES = 'cureos_paleta_recentes';
let getRotas = () => [];
let iniciada = false;
let aberta = false;
let el = null;            // { fundo, caixa, campo, lista, estado, dica }
let itens = [];           // opções navegáveis na ordem da tela
let ativo = 0;
let texto = '';
let seq = 0;              // descarta respostas atrasadas da busca de pacientes
let timer = null;
let pacientes = [];       // resultado atual da busca
let situacaoBusca = '';   // '', 'buscando', 'erro'
let voltarFoco = null;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function recentes() { try { return JSON.parse(localStorage.getItem(CHAVE_RECENTES) || '[]').filter((x) => typeof x === 'string'); } catch { return []; } }
function lembrarTela(id) {
  try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify([id, ...recentes().filter((x) => x !== id)].slice(0, 6))); } catch { /* sem armazenamento */ }
}

export function iniciarPaleta({ rotas } = {}) {
  if (typeof rotas === 'function') getRotas = rotas;
  if (iniciada) return;
  iniciada = true;
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      aberta ? fecharPaleta() : abrirPaleta();
    }
  }, true);
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace(/^#/, '').split(/[-?]/)[0];
    if (id && rotasAtuais().some((r) => r.id === id)) lembrarTela(id);
  });
}

function rotasAtuais() { try { return (getRotas() || []).filter((r) => r && r.id); } catch { return []; } }

function montar() {
  const fundo = document.createElement('div');
  fundo.className = 'paleta-fundo';
  fundo.innerHTML = `<div class="paleta" role="dialog" aria-modal="true" aria-label="Buscar no Cure OS">
      <div class="paleta-topo"><input class="paleta-campo" type="text" role="combobox" aria-expanded="true" aria-controls="paleta-lista"
        aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Buscar tela, paciente ou ação…" aria-label="Buscar"></div>
      <div class="paleta-lista" id="paleta-lista" role="listbox" aria-label="Resultados"></div>
      <div class="paleta-estado" role="status" aria-live="polite"></div>
      <div class="paleta-dica"><span><kbd>↑</kbd> <kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> abrir</span>
        <span class="so-pac"><kbd>Shift</kbd>+<kbd>Enter</kbd> prontuário do paciente</span><span><kbd>Esc</kbd> fechar</span></div>
    </div>`;
  document.body.appendChild(fundo);
  const q = (s) => fundo.querySelector(s);
  el = { fundo, caixa: q('.paleta'), campo: q('.paleta-campo'), lista: q('.paleta-lista'), estado: q('.paleta-estado'), dica: q('.paleta-dica') };

  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) { e.preventDefault(); fecharPaleta(); } });
  el.campo.addEventListener('input', () => { texto = el.campo.value; ativo = 0; buscar(); desenhar(); });
  el.campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
    else if (e.key === 'Home' && !el.campo.value) { e.preventDefault(); ativo = 0; marcar(); }
    else if (e.key === 'Enter') { e.preventDefault(); escolher(itens[ativo], e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecharPaleta(); }
    else if (e.key === 'Tab') { e.preventDefault(); } // foco preso no campo
  });
  el.lista.addEventListener('mousemove', (e) => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== ativo) { ativo = Number(li.dataset.i); marcar(false); } });
  el.lista.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) escolher(itens[Number(li.dataset.i)], e.shiftKey); });
  el.lista.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o foco do campo
}

export function abrirPaleta() {
  if (aberta) { el?.campo.focus(); return; }
  if (!el) montar();
  voltarFoco = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  aberta = true; texto = ''; ativo = 0; pacientes = []; situacaoBusca = ''; seq++; clearTimeout(timer);
  el.campo.value = '';
  el.fundo.hidden = false;
  desenhar();
  el.campo.focus();
}

export function fecharPaleta() {
  if (!aberta) return;
  aberta = false; seq++; clearTimeout(timer);
  el.fundo.hidden = true;
  const f = voltarFoco; voltarFoco = null;
  if (f && document.contains(f)) f.focus();
}

function acoes(rotas) {
  const tem = (id) => rotas.some((r) => r.id === id);
  const l = [];
  if (tem('agenda')) l.push({ tipo: 'acao', nome: 'Novo agendamento', dica: 'Abre a Agenda', palavras: 'novo agendamento marcar consulta agendar', ir: () => { location.hash = 'agenda'; } });
  if (tem('hoje')) l.push({ tipo: 'acao', nome: 'Hoje', dica: 'Resumo do dia', palavras: 'hoje dia', ir: () => { location.hash = 'hoje'; } });
  l.push({ tipo: 'acao', nome: 'Alterar senha', dica: 'Trocar a senha de acesso', palavras: 'alterar senha trocar', ir: () => document.getElementById('btn-senha')?.click() });
  return l;
}

function montarItens() {
  const t = norm(texto);
  const rotas = rotasAtuais();
  const rec = recentes();
  const acs = acoes(rotas).filter((a) => !t || norm(a.nome).includes(t) || norm(a.palavras).split(' ').some((w) => w.startsWith(t)));
  let telas = rotas.map((r) => ({ tipo: 'tela', id: r.id, nome: r.nome || r.id, dica: '' }));
  if (t) telas = telas.filter((r) => norm(r.nome).includes(t));
  else telas.sort((a, b) => { const ia = rec.indexOf(a.id), ib = rec.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  telas.forEach((r) => { r.ir = () => { lembrarTela(r.id); location.hash = r.id; }; });
  const pacs = pacientes.map((p) => ({ tipo: 'paciente', id: p.id, nome: p.nome, dica: p.data_nascimento ? 'Nasc. ' + data(p.data_nascimento) : '' }));
  return [['Ações rápidas', acs], ['Telas', telas], ['Pacientes', pacs]].filter(([, l]) => l.length);
}

function desenhar() {
  const grupos = montarItens();
  itens = grupos.flatMap(([, l]) => l);
  if (ativo >= itens.length) ativo = Math.max(0, itens.length - 1);
  let i = 0;
  el.lista.innerHTML = grupos.map(([nome, l]) => `<div class="paleta-grupo" role="presentation">${esc(nome)}</div>`
    + l.map((it) => `<div class="paleta-item${it.tipo === 'paciente' ? ' pac' : ''}" role="option" id="paleta-op-${i}" data-i="${i++}" aria-selected="false">
        <span class="paleta-nome">${esc(it.nome)}</span>${it.dica ? `<span class="paleta-sub">${esc(it.dica)}</span>` : ''}</div>`).join('')).join('');
  const t = norm(texto);
  const querPac = t.length >= 2;
  let msg = '';
  if (situacaoBusca === 'buscando') msg = 'Buscando pacientes…';
  else if (situacaoBusca === 'erro') msg = 'Não foi possível buscar pacientes agora.';
  else if (!itens.length) msg = t ? (querPac ? 'Nada encontrado. Tente outro nome, CPF ou telefone.' : 'Nada encontrado.') : 'Digite para buscar.';
  else if (!t) msg = 'Digite 2 letras ou mais para buscar pacientes.';
  el.estado.textContent = msg; el.estado.hidden = !msg;
  marcar();
}

function marcar(rolar = true) {
  el.lista.querySelectorAll('[role=option]').forEach((n) => n.setAttribute('aria-selected', String(Number(n.dataset.i) === ativo)));
  const op = itens.length ? el.lista.querySelector(`#paleta-op-${ativo}`) : null;
  if (op) { el.campo.setAttribute('aria-activedescendant', op.id); if (rolar) op.scrollIntoView({ block: 'nearest' }); } else el.campo.removeAttribute('aria-activedescendant');
  el.dica.classList.toggle('sem-pac', itens[ativo]?.tipo !== 'paciente');
}

function mover(d) { if (!itens.length) return; ativo = (ativo + d + itens.length) % itens.length; marcar(); }

function escolher(it, shift) {
  if (!it) return;
  fecharPaleta();
  if (it.tipo === 'paciente') location.hash = `paciente-${it.id}${shift ? '-prontuario' : ''}`;
  else it.ir();
}

// Mesma estratégia da lista de Pacientes: ativos da clínica, nome com ilike %texto% (o banco é sensível a acento),
// só dígitos (≥ 4) busca CPF/telefone/celular. Resposta atrasada é descartada.
function buscar() {
  clearTimeout(timer);
  const q = texto.trim();
  const meu = ++seq;
  if (q.length < 2) { pacientes = []; situacaoBusca = ''; return; }
  situacaoBusca = 'buscando';
  timer = setTimeout(async () => {
    try {
      let c = sb.from('pacientes').select('id, nome, data_nascimento').eq('clinica_id', estado.clinica?.id).eq('ativo', true).order('nome').limit(8);
      const soDigitos = /^[\d\s.\-()+]+$/.test(q), dig = q.replace(/\D/g, '');
      c = soDigitos && dig.length >= 4 ? c.or(`cpf.ilike.%${dig}%,telefone.ilike.%${dig}%,celular.ilike.%${dig}%`) : c.ilike('nome', `%${q}%`);
      const { data: ps, error } = await c;
      if (meu !== seq || !aberta) return;
      if (error) { pacientes = []; situacaoBusca = 'erro'; } else { pacientes = ps || []; situacaoBusca = ''; }
    } catch {
      if (meu !== seq || !aberta) return;
      pacientes = []; situacaoBusca = 'erro';
    }
    desenhar();
  }, 200);
}
