// Módulo Agenda: dia (colunas = profissionais), semana (dias; 1 ou todos os profissionais), mês e listas do dia/semana, com filtros e cartão rápido.
// Salas (config.salas; padrão = última sala usada pelo profissional), agendamento em série (serie_id) e lembretes por WhatsApp (link wa.me, sem custo).
import { sb, estado, $, $$, esc, tela, toast, falha, modal, confirmar, areasDaEspecialidade, SERVICOS_DA_AREA } from '../core.js';

const SERVICOS = ['Fisioterapia', 'Nutrição', 'Psicologia', 'Palmilha / Baropodometria', 'Terapia Ocupacional', 'Avaliação'];
const STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', presente: 'Presente', atendido: 'Atendido', faltou: 'Faltou', cancelado: 'Cancelado' };
const PX_MIN = 1.4; // altura em pixels por minuto
const SALDO_AVISO = 2, DIAS_AVISO = 7; // item 31: selo laranja nas 2 sessões antes da última ou senha vencendo em ≤ 7 dias
const ICS = (t) => `https://paipxhfhwiztznvbxawz.supabase.co/functions/v1/agenda-ics?t=${t}`;
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const hm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const minDe = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const isoLocal = (dia, min) => new Date(`${dia}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`).toISOString();
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const LEMBRETE_PADRAO = 'Olá, {nome}! Aqui é da Clínica Cure. Lembrete do seu atendimento de {servico} com {profissional} {dia} às {hora}. '
  + 'Pode confirmar sua presença? Se precisar remarcar, é só responder esta mensagem.';
// Primeiro telefone do campo com DDD → formato wa.me (55 + DDD + número)
export function foneWhats(tel) {
  for (const parte of String(tel || '').split(/[\/,;|]| e /)) {
    let d = parte.replace(/\D/g, '').replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (/^55\d{10,11}$/.test(d)) return d;
  }
  return null;
}
function textoLembrete(cfg, a, nomeProf) {
  const ini = new Date(a.inicio), amanha = somaDias(hojeIso(), 1), dia = ini.toLocaleDateString('sv');
  const dm = ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const quando = dia === hojeIso() ? `hoje (${dm})` : dia === amanha ? `amanhã (${dm})`
    : `${ini.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/^(\S+)/, (w) => (/sábado|domingo/.test(w) ? 'no ' : 'na ') + w)} (${dm})`;
  return (cfg.lembrete_texto || LEMBRETE_PADRAO).replace(/\{nome\}/g, ((a.pacientes?.nome || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/^./, (c) => c.toUpperCase()))
    .replace(/\{servico\}/g, (a.servico || 'atendimento').toLowerCase()).replace(/\{profissional\}/g, nomeProf || 'nossa equipe')
    .replace(/\{dia\}/g, quando).replace(/\{hora\}/g, hm(a.inicio)).replace(/\{sala\}/g, a.sala || '');
}
const linkWhats = (cfg, a, nomeProf) => { const f = foneWhats(a.pacientes?.celular) || foneWhats(a.pacientes?.telefone); return f ? `https://wa.me/${f}?text=${encodeURIComponent(textoLembrete(cfg, a, nomeProf))}` : null; };

// Visões (15/11/2026, inspirado no ZenFisio): dia · semana (de 1 ou de todos os profissionais, em faixas lado a lado) · mês · lista do dia · lista da semana.
// Filtros no cliente (status, sala, convênio, serviço, paciente) sem nova consulta; clique no bloco abre o cartão rápido (status, iniciar atendimento, WhatsApp).
const MODOS = { dia: 'Dia', semana: 'Semana', mes: 'Mês', lista_dia: 'Lista do dia', lista_semana: 'Lista da semana' };
const FILTRO0 = { status: '', sala: '', conv: '', serv: '', pac: '' };
let vis = { dia: hojeIso(), modo: 'dia', prof: '', f: { ...FILTRO0 } };
try { const v = JSON.parse(sessionStorage.getItem('agenda_vis') || 'null'); if (v && MODOS[v.modo]) vis = { ...vis, modo: v.modo, prof: v.prof || '', f: { ...FILTRO0, ...(v.f || {}) } }; } catch { /* sem storage */ }
const guardarVis = () => { try { sessionStorage.setItem('agenda_vis', JSON.stringify({ modo: vis.modo, prof: vis.prof, f: vis.f })); } catch { /* sem storage */ } };
const segundaDe = (dia) => somaDias(dia, -((new Date(dia + 'T12:00').getDay() + 6) % 7));
let CONV = {};   // atendimento → nome do contrato (db/045, convenio_atendimentos)
const nomeConv = (a) => (a.paciente_plano_id ? (CONV[a.id] ? `Convênio (${CONV[a.id]})` : 'Convênio') : 'Particular');
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';
let pop = null;   // cartão rápido aberto
function fecharCartao() { pop?.remove(); pop = null; }
window.addEventListener('hashchange', fecharCartao);

// Faixas lado a lado para atendimentos que se sobrepõem na mesma coluna
function faixas(evs) {
  const ord = [...evs].sort((x, y) => new Date(x.inicio) - new Date(y.inicio)), r = {};
  let grupo = [], fimGrupo = 0, pistas = [];
  const fechaGrupo = () => { const n = pistas.length || 1; grupo.forEach((id) => (r[id].n = n)); grupo = []; pistas = []; };
  for (const a of ord) {
    const s = +new Date(a.inicio), e = +new Date(a.fim);
    if (grupo.length && s >= fimGrupo) fechaGrupo();
    let i = pistas.findIndex((fim) => fim <= s); if (i < 0) { i = pistas.length; pistas.push(e); } else pistas[i] = e;
    r[a.id] = { i, n: 1 }; grupo.push(a.id); fimGrupo = Math.max(fimGrupo, e);
  }
  fechaGrupo();
  return r;
}

export async function render() {
  fecharCartao();
  const souProf = estado.perfil === 'profissional';
  const c = tela('Agenda', `
    <button class="btn" id="ant">‹</button><input type="date" id="dia" value="${vis.dia}"><button class="btn" id="prox">›</button>
    <button class="btn" id="hoje">Hoje</button>
    <select id="modo">${Object.entries(MODOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    ${souProf ? '' : '<select id="prof"><option value="">Todos os profissionais</option></select>'}
    ${souProf ? '<button class="btn" id="cal">Ligar ao Google/Outlook</button>' : '<button class="btn" id="lemb">📲 Lembretes</button><button class="btn" id="relac">💬 Relacionamento</button>'}<button class="btn primario" id="novo">+ Agendamento</button>`);
  if (souProf) vis.prof = estado.profissionalId;
  // Agendar a partir da ficha (13/11/2026): contexto em sessionStorage 'agendar_para'
  let pre = null; try { pre = JSON.parse(sessionStorage.getItem('agendar_para') || 'null'); } catch { pre = null; }
  if (pre && !pre.aplicado) { if (pre.prof) { vis.prof = pre.prof; vis.modo = 'semana'; } vis.dia = /^\d{4}-\d\d-\d\d$/.test(pre.dia || '') ? pre.dia : hojeIso(); pre.aplicado = true; sessionStorage.setItem('agendar_para', JSON.stringify(pre)); }
  guardarVis();

  const cfg = estado.clinica.config || (await sb.from('clinicas').select('config').eq('id', estado.clinica.id).single()).data?.config
    || { abre: '07:30', fecha: '19:30', intervalo_min: 15, pausas: [] };
  estado.clinica.config = cfg;
  const { data: profs } = await sb.from('profissionais').select('id, nome, cor, duracao_padrao_min, agenda_token, especialidade')
    .eq('clinica_id', estado.clinica.id).eq('ativo', true).order('nome');
  if (!souProf) $('#prof').innerHTML += (profs || []).map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  $('#modo').value = vis.modo; if ($('#prof')) $('#prof').value = vis.prof;

  const ir = (n) => {
    if (vis.modo === 'mes') { const d = new Date(vis.dia + 'T12:00'); d.setDate(1); d.setMonth(d.getMonth() + n); vis.dia = d.toLocaleDateString('sv'); }
    else vis.dia = somaDias(vis.dia, n * (['semana', 'lista_semana'].includes(vis.modo) ? 7 : 1));
    render();
  };
  $('#ant').onclick = () => ir(-1); $('#prox').onclick = () => ir(1);
  $('#hoje').onclick = () => { vis.dia = hojeIso(); render(); };
  $('#dia').onchange = (e) => { vis.dia = e.target.value; render(); };
  $('#modo').onchange = (e) => { vis.modo = e.target.value; render(); };
  $('#prof')?.addEventListener('change', (e) => { vis.prof = e.target.value; render(); });
  $('#novo')?.addEventListener('click', () => editar(null, { dia: vis.dia, min: minDe(cfg.abre), prof: vis.prof }));
  $('#cal')?.addEventListener('click', () => mostrarCalendario(profs.find((p) => p.id === estado.profissionalId)));
  $('#lemb')?.addEventListener('click', () => lembretes(cfg, profs, render));
  $('#relac')?.addEventListener('click', () => import('./relacionamento.js').then((r) => r.abrir()));
  const SALAS = cfg.salas?.length ? cfg.salas : [];
  const DIAS_ABERTOS = cfg.dias || [1, 2, 3, 4, 5, 6];
  if (!profs?.length) { c.innerHTML = '<div class="cartao vazio">Cadastre profissionais para usar a agenda.</div>'; return; }

  // Período e colunas conforme a visão
  let colunas = [], de, ate;
  if (vis.modo === 'semana' || vis.modo === 'lista_semana') {
    const seg = segundaDe(vis.dia);
    const dias = Array.from({ length: 7 }, (_, i) => somaDias(seg, i)).filter((d) => DIAS_ABERTOS.includes(new Date(d + 'T12:00').getDay()));
    colunas = dias.map((d) => ({ titulo: new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }), dia: d, prof: vis.prof || null }));
    de = dias[0]; ate = dias.at(-1);
  } else if (vis.modo === 'mes') {
    const d1 = vis.dia.slice(0, 8) + '01', ult = new Date(d1 + 'T12:00'); ult.setMonth(ult.getMonth() + 1); ult.setDate(0);
    de = segundaDe(d1); ate = somaDias(segundaDe(ult.toLocaleDateString('sv')), 6);
  } else {
    const lista = vis.prof ? profs.filter((p) => p.id === vis.prof) : profs;
    colunas = lista.map((p) => ({ titulo: p.nome, dia: vis.dia, prof: p.id, cor: p.cor }));
    de = ate = vis.dia;
  }

  let q = sb.from('atendimentos').select('id, inicio, fim, status, servico, sala, observacao, profissional_id, paciente_id, paciente_plano_id, autorizacao_id, serie_id, lembrete_enviado_em, pacientes(nome, telefone, celular)')
    .eq('clinica_id', estado.clinica.id).gte('inicio', new Date(de + 'T00:00').toISOString()).lt('inicio', new Date(somaDias(ate, 1) + 'T00:00').toISOString())
    .order('inicio');
  if (vis.prof) q = q.eq('profissional_id', vis.prof);
  const { data: todos, error } = await q;
  if (error) return falha(error);
  // Item 31 (db/043): "sessão N de X" de cada atendimento ligado a senha — uma chamada para a tela inteira (fora do mês)
  const num = {};
  const ids = vis.modo === 'mes' ? [] : todos.filter((a) => a.autorizacao_id && a.status !== 'cancelado').map((a) => a.id);
  const idsConv = todos.filter((a) => a.paciente_plano_id).map((a) => a.id);
  const [rNum, rConv] = await Promise.all([
    ids.length ? sb.rpc('numeracao_sessoes', { p_atendimentos: ids }) : { data: [] },
    idsConv.length ? sb.rpc('convenio_atendimentos', { p_atendimentos: idsConv }) : { data: [] }]);
  (rNum.data || []).forEach((x) => (num[x.atendimento_id] = x));
  CONV = {}; (rConv.data || []).forEach((x) => (CONV[x.atendimento_id] = x.convenio));

  const ini = minDe(cfg.abre), fimMin = minDe(cfg.fecha), altura = (fimMin - ini) * PX_MIN;
  const horas = []; for (let m = Math.ceil(ini / 60) * 60; m < fimMin; m += 60) horas.push(m);
  const pausas = (cfg.pausas || []).map((x) => ({ de: minDe(x.de), ate: minDe(x.ate), nome: x.nome || 'Pausa' }));
  const pausasDoDia = (dia) => {
    const f = (cfg.fecha_por_dia || {})[new Date(dia + 'T12:00').getDay()];
    return f && minDe(f) < fimMin ? [...pausas.filter((x) => x.de < minDe(f)), { de: minDe(f), ate: fimMin, nome: 'Fechado' }] : pausas;
  };
  const naPausa = (min, dia) => pausasDoDia(dia).some((x) => min >= x.de && min < x.ate);
  const corDe = (pid) => profs.find((p) => p.id === pid)?.cor || '#F8781D';
  const nomeProf = (pid) => profs.find((p) => p.id === pid)?.nome || '';

  // Filtros (no cliente)
  const convs = [...new Set(todos.map(nomeConv))].sort();
  const servs = [...new Set(todos.map((a) => a.servico).filter(Boolean))].sort();
  const salasVistas = [...new Set([...SALAS, ...todos.map((a) => a.sala).filter(Boolean)])];
  const passa = (a) => {
    const f = vis.f;
    if (f.status ? a.status !== f.status : a.status === 'cancelado') return false;
    if (f.sala && a.sala !== f.sala) return false;
    if (f.conv && (f.conv === '_conv' ? !a.paciente_plano_id : nomeConv(a) !== f.conv)) return false;
    if (f.serv && a.servico !== f.serv) return false;
    if (f.pac && !String(a.pacientes?.nome || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
      .includes(f.pac.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''))) return false;
    return true;
  };
  const filtrosAtivos = Object.values(vis.f).filter(Boolean).length;

  import('./guia.js').then((g) => g.alertaSemSenha($('#alerta-senha'), render)).catch(() => {});
  c.innerHTML = `${pre ? `<div class="faixa-agendar"><span>📅 Agendando <strong>${esc(pre.nome)}</strong> · ${esc(pre.resumo || '')} — clique num horário livre</span>
    <a href="#${pre.origem === 'espera' ? 'espera' : `paciente-${pre.paciente}-autorizacoes`}" id="pre-voltar">${pre.origem === 'espera' ? 'Voltar à lista de espera' : 'Voltar à ficha'}</a><button class="btn pequeno" id="pre-canc">Cancelar</button></div>` : ''}<div id="alerta-senha"></div>
    <div class="cartao ag-filtros">
      <input id="f-pac" placeholder="🔍 Paciente" value="${esc(vis.f.pac)}">
      <select id="f-status"><option value="">Status: ativos</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      ${salasVistas.length ? `<select id="f-sala"><option value="">Sala: todas</option>${salasVistas.map((s) => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
      <select id="f-conv"><option value="">Convênio: todos</option><option value="_conv">Só convênios</option>${convs.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="f-serv"><option value="">Serviço: todos</option>${servs.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
      <button class="btn pequeno" id="f-limpar" ${filtrosAtivos ? '' : 'hidden'}>Limpar filtros</button>
      <span class="muted" id="f-cont"></span>
    </div>
    <div id="ag-corpo"></div>`;
  [['f-status', 'status'], ['f-sala', 'sala'], ['f-conv', 'conv'], ['f-serv', 'serv']].forEach(([id, k]) => {
    const el = $('#' + id); if (!el) return;
    if (vis.f[k] && ![...el.options].some((o) => o.value === vis.f[k])) el.add(new Option(vis.f[k], vis.f[k]));
    el.value = vis.f[k]; el.onchange = () => { vis.f[k] = el.value; guardarVis(); desenhar(); };
  });
  let tp; $('#f-pac').oninput = (e) => { clearTimeout(tp); tp = setTimeout(() => { vis.f.pac = e.target.value.trim(); guardarVis(); desenhar(); }, 200); };
  $('#f-limpar').onclick = () => { vis.f = { ...FILTRO0 }; guardarVis(); render(); };
  $('#pre-canc')?.addEventListener('click', () => { sessionStorage.removeItem('agendar_para'); render(); });
  $('#pre-voltar')?.addEventListener('click', () => sessionStorage.removeItem('agendar_para'));

  let ats = [];
  function desenhar() {
    fecharCartao();
    ats = todos.filter(passa);
    const n = Object.values(vis.f).filter(Boolean).length;
    $('#f-limpar').hidden = !n;
    $('#f-cont').textContent = `${ats.length} atendimento(s)${n ? ' com os filtros' : ''}`;
    const corpo = $('#ag-corpo');
    if (vis.modo === 'mes') return desenharMes(corpo);
    if (vis.modo.startsWith('lista')) return desenharLista(corpo);
    desenharGrade(corpo);
  }

  function desenharGrade(corpo) {
    const todosProfs = vis.modo === 'semana' && !vis.prof;
    corpo.innerHTML = `<div class="cartao agenda-wrap"><div class="agenda" style="grid-template-columns:56px repeat(${colunas.length}, minmax(${todosProfs ? 170 : 150}px,1fr))">
    <div></div>${colunas.map((col) => `<div class="ag-tit${col.dia === hojeIso() && vis.modo === 'semana' ? ' hoje' : ''}">${esc(col.titulo)}</div>`).join('')}
    <div class="ag-horas" style="height:${altura}px">${horas.map((m) => `<span style="top:${(m - ini) * PX_MIN}px">${String(m / 60).padStart(2, '0')}:00</span>`).join('')}</div>
    ${colunas.map((col, ci) => {
      const evs = ats.filter((a) => (!col.prof || a.profissional_id === col.prof) && new Date(a.inicio).toLocaleDateString('sv') === col.dia);
      const fx = faixas(evs);
      return `<div class="ag-col" data-ci="${ci}" style="height:${altura}px">
      ${horas.map((m) => `<i style="top:${(m - ini) * PX_MIN}px"></i>`).join('')}
      ${pausasDoDia(col.dia).map((x) => `<div class="ag-pausa" style="top:${(x.de - ini) * PX_MIN}px;height:${(x.ate - x.de) * PX_MIN}px">${esc(x.nome)}</div>`).join('')}
      ${evs.map((a) => {
        const s = new Date(a.inicio), e = new Date(a.fim), top = (s.getHours() * 60 + s.getMinutes() - ini) * PX_MIN;
        const h = Math.max(22, ((e - s) / 6e4) * PX_MIN - 2), { i, n } = fx[a.id];
        const lado = n > 1 ? `left:calc(${(i / n) * 100}% + 2px);right:auto;width:calc(${100 / n}% - 4px);` : '';
        return `<div class="ag-ev st-${a.status}" data-id="${a.id}" title="${esc(`${hm(a.inicio)}–${hm(a.fim)} ${a.pacientes?.nome || ''} · ${nomeProf(a.profissional_id)}`)}" style="top:${top}px;height:${h}px;${lado}border-left-color:${corDe(a.profissional_id)}">
          <b>${hm(a.inicio)} ${esc(a.pacientes?.nome || '')}${seloSessao(num[a.id])}</b><span>${todosProfs ? esc(primeiroNome(nomeProf(a.profissional_id))) + ' · ' : ''}${esc(a.servico || '')}${a.sala ? ' · ' + esc(a.sala) : ''} · ${STATUS[a.status]}</span></div>`;
      }).join('')}</div>`; }).join('')}
  </div></div>`;
    $$('.ag-col', corpo).forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('.ag-ev')) return;
      const col = colunas[el.dataset.ci], y = e.clientY - el.getBoundingClientRect().top;
      const passo = cfg.intervalo_min || 10, min = ini + Math.floor(y / PX_MIN / passo) * passo;
      if (naPausa(min, col.dia)) return toast('Fora do expediente. Para encaixe, use + Agendamento e ajuste a hora.');
      editar(null, { dia: col.dia, min, prof: col.prof || '', pre });
    }));
    $$('.ag-ev', corpo).forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); if (el._arrastou) { el._arrastou = false; return; } cartao(ats.find((a) => a.id === el.dataset.id), el); };
      if (!souProf) el.addEventListener('pointerdown', (e) => arrastar(e, el));
    });
  }

  // ---------- Arrastar para remarcar (dia e semana; mouse/caneta — no toque, use Detalhes) ----------
  function arrastar(e, el) {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const a = ats.find((x) => x.id === el.dataset.id);
    if (!a || travado0(a) || a.status === 'faltou') return;
    const passo = cfg.intervalo_min || 10, dur = Math.round((new Date(a.fim) - new Date(a.inicio)) / 6e4);
    const x0 = e.clientX, y0 = e.clientY, pega = e.clientY - el.getBoundingClientRect().top;
    const colOrig = el.parentElement, tituloOrig = $('b', el).innerHTML;
    let movendo = false, alvo = null;
    const mover = (ev) => {
      if (!movendo && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!movendo) { movendo = true; fecharCartao(); el.classList.add('arrastando'); el.style.pointerEvents = 'none'; }
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.ag-col');
      if (!col) return;
      const ci = Number(col.dataset.ci), r = col.getBoundingClientRect();
      let min = ini + Math.round((ev.clientY - r.top - pega) / PX_MIN / passo) * passo;
      min = Math.max(ini, Math.min(fimMin - dur, min));
      if (el.parentElement !== col) col.appendChild(el);
      Object.assign(el.style, { top: (min - ini) * PX_MIN + 'px', left: '3px', right: '3px', width: 'auto' });
      const hh = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      $('b', el).textContent = `→ ${hh} ${a.pacientes?.nome || ''}`;
      alvo = { col: colunas[ci], min, hh };
    };
    const cancelar = () => { colOrig.appendChild(el); render(); };
    const soltar = async () => {
      document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('keydown', tecla);
      if (!movendo) return;
      el._arrastou = true; setTimeout(() => (el._arrastou = false), 50);
      if (!alvo) return cancelar();
      const prof = alvo.col.prof || a.profissional_id, dia = alvo.col.dia;
      const ini2 = new Date(`${dia}T${alvo.hh}:00`), fim2 = new Date(ini2.getTime() + dur * 6e4);
      if (+ini2 === +new Date(a.inicio) && prof === a.profissional_id) { $('b', el).innerHTML = tituloOrig; return render(); }
      // Conflitos: expediente/pausa, profissional ocupado e sala ocupada por outro profissional
      const { data: ocup, error: eo } = await sb.from('atendimentos').select('id, inicio, fim, sala, profissional_id').eq('clinica_id', estado.clinica.id)
        .neq('status', 'cancelado').lt('inicio', fim2.toISOString()).gt('fim', ini2.toISOString())
        .or(`profissional_id.eq.${prof}${a.sala ? `,sala.eq."${a.sala.replace(/"/g, '')}"` : ''}`);
      if (eo) { falha(eo, 'Conflitos'); return cancelar(); }
      const outros = (ocup || []).filter((x) => x.id !== a.id), mi = alvo.min;
      const motivos = [
        ...(pausasDoDia(dia).some((x) => mi < x.ate && mi + dur > x.de) || mi + dur > fimMin ? ['fora do expediente'] : []),
        ...(outros.some((x) => x.profissional_id === prof) ? ['profissional ocupado'] : []),
        ...outros.filter((x) => a.sala && x.sala === a.sala && x.profissional_id !== prof).map((x) => `${a.sala} ocupada por ${nomeProf(x.profissional_id)}`)];
      const fmt = (d) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' ' + hm(d);
      const trocaProf = prof !== a.profissional_id;
      const ok = await confirmar(`Remarcar ${a.pacientes?.nome || 'atendimento'} de ${fmt(new Date(a.inicio))} para ${fmt(ini2)}`
        + `${trocaProf ? ` com ${nomeProf(prof)}` : ''}?${motivos.length ? ` Atenção: ${motivos.join(', ')}.` : ''}`
        + `${trocaProf && a.autorizacao_id ? ' A autorização (senha) continua a mesma; confira se ela vale para o novo profissional.' : ''}`
        + `${a.lembrete_enviado_em ? ' O lembrete já enviado fica desmarcado para você reenviar.' : ''}`, motivos.length ? 'Remarcar mesmo assim' : 'Remarcar');
      if (!ok) return render();
      const { error: e2 } = await sb.from('atendimentos').update({ inicio: ini2.toISOString(), fim: fim2.toISOString(), profissional_id: prof,
        ...(a.status === 'confirmado' ? { status: 'agendado' } : {}), lembrete_enviado_em: null, atualizado_em: new Date().toISOString() }).eq('id', a.id);
      if (e2) { falha(e2, 'Remarcar'); return render(); }
      toast(`Remarcado para ${fmt(ini2)}.${a.status === 'confirmado' ? ' Status voltou para Agendado (confirmar de novo).' : ''}`); render();
    };
    const tecla = (ev) => { if (ev.key === 'Escape' && movendo) { document.removeEventListener('pointermove', mover); document.removeEventListener('pointerup', soltar); document.removeEventListener('keydown', tecla); cancelar(); } };
    document.addEventListener('pointermove', mover); document.addEventListener('pointerup', soltar); document.addEventListener('keydown', tecla);
  }

  function desenharMes(corpo) {
    const mesRef = vis.dia.slice(0, 7), semanas = [];
    for (let d = de; d <= ate; d = somaDias(d, 7)) semanas.push(Array.from({ length: 7 }, (_, i) => somaDias(d, i)).filter((x) => DIAS_ABERTOS.includes(new Date(x + 'T12:00').getDay())));
    const porDia = {}; ats.forEach((a) => (porDia[new Date(a.inicio).toLocaleDateString('sv')] ||= []).push(a));
    const cab = semanas[0].map((d) => DIAS_SEM[new Date(d + 'T12:00').getDay()]);
    corpo.innerHTML = `<div class="cartao ag-mes" style="grid-template-columns:repeat(${cab.length},1fr)">
      ${cab.map((t) => `<div class="ag-mes-cab">${t}</div>`).join('')}
      ${semanas.flat().map((d) => { const l = porDia[d] || [];
        return `<div class="ag-mes-dia${d.slice(0, 7) !== mesRef ? ' fora' : ''}${d === hojeIso() ? ' hoje' : ''}" data-dia="${d}">
          <div class="ag-mes-n"><span>${Number(d.slice(8))}</span>${l.length ? `<em>${l.length}</em>` : ''}</div>
          ${l.slice(0, 4).map((a) => `<div class="ag-mes-ev st-${a.status}" style="border-left-color:${corDe(a.profissional_id)}">${hm(a.inicio)} ${esc(primeiroNome(a.pacientes?.nome))}</div>`).join('')}
          ${l.length > 4 ? `<div class="muted ag-mes-mais">+${l.length - 4}</div>` : ''}</div>`; }).join('')}
    </div><p class="muted">Clique num dia para abrir a visão do dia.</p>`;
    $$('.ag-mes-dia', corpo).forEach((el) => (el.onclick = () => { vis.dia = el.dataset.dia; vis.modo = 'dia'; render(); }));
  }

  function desenharLista(corpo) {
    const porDia = {}; ats.forEach((a) => (porDia[new Date(a.inicio).toLocaleDateString('sv')] ||= []).push(a));
    const dias = vis.modo === 'lista_dia' ? [vis.dia] : colunas.map((x) => x.dia);
    corpo.innerHTML = dias.map((d) => { const l = porDia[d] || [];
      if (!l.length && vis.modo === 'lista_semana') return '';
      return `<div class="cartao"><h4 class="ag-lista-dia">${new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} <span class="muted">· ${l.length} atendimento(s)</span></h4>
      ${l.length ? `<table class="tabela ag-lista"><thead><tr><th>Hora</th><th>Paciente</th><th>Profissional</th><th>Serviço · sala</th><th>Convênio</th><th>Status</th><th></th></tr></thead><tbody>
      ${l.map((a) => `<tr data-id="${a.id}"><td style="white-space:nowrap">${hm(a.inicio)}–${hm(a.fim)}</td>
        <td><a href="#paciente-${a.paciente_id}">${esc(a.pacientes?.nome || '')}</a>${seloSessao(num[a.id])}</td>
        <td><span class="ag-bolinha" style="background:${corDe(a.profissional_id)}"></span>${esc(nomeProf(a.profissional_id))}</td>
        <td>${esc(a.servico || '')}${a.sala ? ' · ' + esc(a.sala) : ''}</td><td>${esc(nomeConv(a))}</td>
        <td><span class="ag-st st-${a.status}">${STATUS[a.status]}</span></td>
        <td><button class="btn pequeno" data-abrir="${a.id}">Abrir</button></td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhum atendimento.</div>'}</div>`; }).join('')
      || '<div class="cartao vazio">Nenhum atendimento nesta semana com os filtros escolhidos.</div>';
    $$('[data-abrir]', corpo).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); cartao(ats.find((a) => a.id === b.dataset.abrir), b); }));
  }

  // ---------- Cartão rápido (clique no atendimento) ----------
  function cartao(a, el) {
    fecharCartao();
    if (!a) return;
    const meu = a.profissional_id === estado.profissionalId, aberto = !['atendido', 'cancelado', 'faltou'].includes(a.status);
    const wpp = !souProf && ['agendado', 'confirmado'].includes(a.status) ? linkWhats(cfg, a, nomeProf(a.profissional_id)) : null;
    const tel = a.pacientes?.celular || a.pacientes?.telefone;
    pop = document.createElement('div'); pop.className = 'ag-pop'; pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<button class="ag-pop-x" aria-label="Fechar">×</button>
      <div class="ag-pop-h" style="border-left-color:${corDe(a.profissional_id)}"><b>${hm(a.inicio)}–${hm(a.fim)}</b> · ${new Date(a.inicio).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
      <dl>
        <dt>Paciente</dt><dd><a href="#paciente-${a.paciente_id}">${esc(a.pacientes?.nome || '')}</a></dd>
        ${tel ? `<dt>Celular</dt><dd>${esc(tel)}</dd>` : ''}
        <dt>Profissional</dt><dd>${esc(nomeProf(a.profissional_id))}</dd>
        <dt>Serviço</dt><dd>${esc(a.servico || '—')}${a.sala ? ' · ' + esc(a.sala) : ''}</dd>
        <dt>Convênio</dt><dd>${esc(nomeConv(a))}</dd>
        <dt>Status</dt><dd><span class="ag-st st-${a.status}">${STATUS[a.status]}</span>${a.lembrete_enviado_em ? ' <span class="selo ok">lembrete enviado</span>' : ''}</dd>
        ${a.observacao ? `<dt>Obs.</dt><dd>${esc(a.observacao)}</dd>` : ''}
      </dl>${linhaSessao(num[a.id])}
      ${!souProf && aberto ? `<div class="ag-pop-st">${['confirmado', 'presente', 'faltou'].filter((k) => k !== a.status).map((k) => `<button class="btn pequeno" data-pst="${k}">${k === 'presente' ? 'Chegou' : STATUS[k]}</button>`).join('')}</div>` : ''}
      <div class="ag-pop-acoes">
        ${meu && aberto ? '<button class="btn pequeno primario" data-pa="iniciar">▶ Iniciar atendimento</button>' : ''}
        ${a.status !== 'atendido' && a.status !== 'cancelado' ? '<button class="btn pequeno" data-pa="atendido">✓ Atendido</button>' : ''}
        ${meu && a.status === 'atendido' ? '<button class="btn pequeno" data-pa="evoluir">Evoluir</button>' : ''}
        ${wpp ? `<a class="btn pequeno" target="_blank" rel="noopener" href="${esc(wpp)}" data-pa="wpp">📲 WhatsApp</a>` : ''}
        <button class="btn pequeno" data-pa="editar">✎ Detalhes</button>
      </div>`;
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let left = r.right + 8; if (left + w > innerWidth - 8) left = Math.max(8, r.left - w - 8);
    pop.style.left = left + 'px'; pop.style.top = Math.max(8, Math.min(r.top, innerHeight - h - 8)) + 'px';
    const fora = (e) => { if (pop && !pop.contains(e.target)) { fecharCartao(); document.removeEventListener('mousedown', fora); } };
    setTimeout(() => document.addEventListener('mousedown', fora), 0);
    pop.onkeydown = (e) => { if (e.key === 'Escape') fecharCartao(); };
    $('.ag-pop-x', pop).onclick = fecharCartao;
    $$('[data-pst]', pop).forEach((b) => (b.onclick = async () => {
      const { error: e } = await sb.from('atendimentos').update({ status: b.dataset.pst, atualizado_em: new Date().toISOString() }).eq('id', a.id);
      if (e) return falha(e); toast(`Status: ${STATUS[b.dataset.pst]}.`); render();
    }));
    $$('[data-pa]', pop).forEach((b) => (b.onclick = async () => {
      const acao = b.dataset.pa;
      if (acao === 'editar') { fecharCartao(); return editar(a); }
      if (acao === 'wpp') { await sb.from('atendimentos').update({ lembrete_enviado_em: new Date().toISOString() }).eq('id', a.id); return setTimeout(render, 800); }
      if (acao === 'atendido') { fecharCartao(); const { fecharAtendimento } = await import('./guia.js'); return fecharAtendimento(a, render); }
      if (acao === 'iniciar' && ['agendado', 'confirmado'].includes(a.status)) {
        const { error: e } = await sb.from('atendimentos').update({ status: 'presente', atualizado_em: new Date().toISOString() }).eq('id', a.id);
        if (e) return falha(e);
      }
      fecharCartao(); location.hash = `#paciente-${a.paciente_id}-prontuario:${a.id}`;   // iniciar/evoluir: abre o registro ligado ao atendimento
    }));
  }

  desenhar();

  // ---------- Modal de agendamento ----------
  function editar(a, novo = {}) {
    const p = a ? profs.find((x) => x.id === a.profissional_id) : profs.find((x) => x.id === novo.prof) || profs[0];
    const dia = a ? new Date(a.inicio).toLocaleDateString('sv') : novo.dia;
    const hora = a ? hm(a.inicio) : `${String(Math.floor(novo.min / 60)).padStart(2, '0')}:${String(novo.min % 60).padStart(2, '0')}`;
    const dur = a ? Math.round((new Date(a.fim) - new Date(a.inicio)) / 6e4) : p?.duracao_padrao_min || 45;
    let pacienteId = a?.paciente_id || novo.pre?.paciente || null;
    // Profissional: agenda só para si e só nos serviços da sua área; agendamento existente continua só leitura (exceto observação/status)
    const bloq = souProf && !!a;
    const eu = profs.find((x) => x.id === estado.profissionalId);
    const meusServ = souProf ? [...new Set(areasDaEspecialidade(eu?.especialidade).flatMap((k) => SERVICOS_DA_AREA[k] || []))] : SERVICOS;
    const servOpcoes = [...new Set([...(meusServ.length ? meusServ : SERVICOS), ...(a?.servico ? [a.servico] : [])])];
    modal(`<h3>${a ? 'Agendamento' : 'Novo agendamento'}</h3>${a ? linhaSessao(num[a.id]) : ''}
      ${a ? `<div class="linha-acoes" style="justify-content:flex-start;margin:0 0 12px">${Object.entries(STATUS).filter(([k]) => k !== 'cancelado')
        .map(([k, v]) => `<button class="btn pequeno ${a.status === k ? 'primario' : ''}" data-st="${k}">${v}</button>`).join('')}</div>` : ''}
      <form class="grade-form" id="f">
        <label style="grid-column:1/-1">Paciente${bloq ? `<input value="${esc(a?.pacientes?.nome)}" disabled>` : `
          <input id="pbusca" placeholder="Digite o nome" value="${esc(a?.pacientes?.nome || novo.pre?.nome || '')}" autocomplete="off"><div id="psug" class="sugestoes"></div>`}</label>
        <label>Profissional<select name="profissional_id" ${souProf ? 'disabled' : ''}>${(souProf && !a ? profs.filter((x) => x.id === estado.profissionalId) : profs).map((x) => `<option value="${x.id}" ${x.id === (souProf && !a ? estado.profissionalId : p?.id) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Serviço<select name="servico" ${bloq ? 'disabled' : ''}>${servOpcoes.map((s) => `<option ${s === (a?.servico || p?.especialidade) ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Data<input type="date" name="dia" value="${dia}" ${bloq ? 'disabled' : ''}></label>
        <label>Hora<input type="time" name="hora" value="${hora}" step="300" ${bloq ? 'disabled' : ''}></label>
        <label>Duração (min)<input type="number" name="dur" value="${dur}" min="5" step="5" ${bloq ? 'disabled' : ''}></label>
        <label>Sala<select name="sala" ${bloq ? 'disabled' : ''}><option value="">—</option>
          ${[...new Set([...SALAS, ...(a?.sala ? [a.sala] : [])])].map((s) => `<option ${s === a?.sala ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        ${!a ? `<div style="grid-column:1/-1" class="serie-box">
          <label><span><input type="checkbox" id="rep"> Repetir — agendamento em série</span></label>
          <div id="rep-op" hidden>
            <div class="linha-acoes" style="justify-content:flex-start;margin:6px 0">${DIAS_SEM.map((d, i) => (cfg.dias || [1, 2, 3, 4, 5, 6]).includes(i)
              ? `<label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" class="rep-dia" value="${i}" ${i === new Date(dia + 'T12:00').getDay() ? 'checked' : ''}>${d}</label>` : '').join('')}</div>
            <label>Nº de sessões (contando a primeira)<input type="number" id="rep-n" min="2" max="60" value="10"></label>
            <small class="muted">Mesmo horário, sala e profissional. Datas com conflito ou fora do expediente são puladas e listadas. Com convênio, o total é limitado ao saldo da senha.</small>
          </div></div>` : ''}
        <label style="grid-column:1/-1">Observação<input name="observacao" value="${esc(a?.observacao || '')}"></label>
      </form>
      <div id="conv"></div>
      ${a && !souProf && ['agendado', 'confirmado'].includes(a.status) ? (() => { const l = linkWhats(cfg, a, profs.find((x) => x.id === a.profissional_id)?.nome);
        return `<p>${l ? `<a class="btn pequeno" id="wpp" href="${esc(l)}" target="_blank" rel="noopener">📲 Enviar lembrete no WhatsApp</a>` : '<span class="muted">Sem celular válido com DDD para lembrete.</span>'}
          ${a.lembrete_enviado_em ? ` <span class="selo ok">lembrete enviado ${new Date(a.lembrete_enviado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>` : ''}</p>`; })() : ''}
      ${a && !a.paciente_plano_id && a.status !== 'cancelado' && (!souProf || a.profissional_id === estado.profissionalId)
        ? '<p><button class="btn pequeno" id="pgto">💲 Pagamento (particular)</button> <span id="pgto-st"></span></p>' : ''}
      ${a ? `<p class="muted">${(a.pacientes?.celular || a.pacientes?.telefone) ? 'Telefone: ' + esc(a.pacientes.celular || a.pacientes.telefone) + ' · ' : ''}<a href="#paciente-${a.paciente_id}" data-fechar>Abrir ficha do paciente →</a>${a.profissional_id === estado.profissionalId ? ` · <a href="#paciente-${a.paciente_id}-prontuario:${a.id}" data-fechar>Evoluir no prontuário →</a>` : ''}</p>` : ''}
      <div class="linha-acoes">${a && !souProf ? '<button class="btn escuro" id="canc">Cancelar agendamento</button>' : ''}${a?.serie_id && !souProf && !travado0(a) ? '<button class="btn escuro" id="canc-serie">Cancelar esta e as próximas da série</button>' : ''}
        <button class="btn" data-fechar>Fechar</button><button class="btn primario" id="s">Salvar</button></div>`,
    (m, fechar) => {
      const busca = $('#pbusca', m), sug = $('#psug', m); let t;
      // Sala padrão: a do agendamento; senão a última usada pelo profissional; senão config.sala_padrao
      const selSala = $('[name=sala]', m), selProf = $('[name=profissional_id]', m); let salaMexida = !!a;
      selSala?.addEventListener('change', () => (salaMexida = true));
      async function salaPadrao() {
        if (salaMexida || !selSala) return;
        const pid = selProf.value;
        const { data: ult } = await sb.from('atendimentos').select('sala').eq('profissional_id', pid).not('sala', 'is', null).order('inicio', { ascending: false }).limit(1);
        if (salaMexida || selProf.value !== pid) return;
        const s = ult?.[0]?.sala || (cfg.sala_padrao || {})[pid] || SALAS[0] || '';
        if (s && ![...selSala.options].some((o) => o.value === s)) selSala.add(new Option(s, s));
        selSala.value = s;
      }
      if (!a) { salaPadrao(); selProf?.addEventListener('change', salaPadrao); }
      $('#rep', m)?.addEventListener('change', (e) => ($('#rep-op', m).hidden = !e.target.checked));
      if ($('#pgto', m)) (async () => {
        const P = await import('./particular.js');
        const { data: rs } = await sb.from('recebimentos').select('*').eq('atendimento_id', a.id).order('criado_em').limit(1);
        const rec = rs?.[0] || null;
        $('#pgto-st', m).innerHTML = P.seloPagamento(rec);
        $('#pgto', m).onclick = () => P.registrarPagamento(a, render, rec);
      })();
      $('#wpp', m)?.addEventListener('click', async () => {
        await sb.from('atendimentos').update({ lembrete_enviado_em: new Date().toISOString() }).eq('id', a.id);
      });
      $('#canc-serie', m)?.addEventListener('click', async () => {
        if (!(await confirmar('Cancelar este agendamento e todos os próximos desta série (os já atendidos não mudam)?', 'Cancelar série'))) return;
        const { data: cs, error: e } = await sb.from('atendimentos').update({ status: 'cancelado', atualizado_em: new Date().toISOString() })
          .eq('serie_id', a.serie_id).gte('inicio', a.inicio).in('status', ['agendado', 'confirmado']).select('id');
        if (e) return falha(e); toast(`${cs.length} agendamento(s) cancelado(s).`); render();
      });
      // Convênio e autorização: agendar convênio exige vínculo com autorização (existente ou solicitação pendente)
      const conv = $('#conv', m); let planos = [], planoId = a?.paciente_plano_id || novo.pre?.plano || '', autId = a?.autorizacao_id || novo.pre?.aut || '';
      const travado = a && ['atendido', 'cancelado'].includes(a.status); let carregado = false;
      async function carregarConv() {
        if (!pacienteId) { conv.innerHTML = ''; return; }
        const { data: ps, error: e } = await sb.rpc('autorizacoes_paciente', { p_paciente: pacienteId });
        if (e) return falha(e, 'Convênios');
        planos = ps || []; carregado = true;
        // sócio no modo profissional: o banco devolve tudo (perfil real é gestão) → mostra só as senhas da sua área
        if (souProf) { const minhas = areasDaEspecialidade(eu?.especialidade);
          planos.forEach((pl) => (pl.autorizacoes = (pl.autorizacoes || []).filter((x) => !x.area || minhas.includes(x.area) || x.id === autId))); }
        if (!a && !planoId) planoId = '';
        desenharConv();
      }
      function desenharConv() {
        const pl = planos.find((x) => x.id === planoId);
        const saldo = (x) => Number(x.qtd) - Number(x.usadas) - Number(x.agendadas) + (a && a.autorizacao_id === x.id ? 1 : 0);
        conv.innerHTML = `<div class="grade-form" style="margin-top:12px">
          <label style="grid-column:1/-1">Convênio<select id="c-plano" ${bloq || travado ? 'disabled' : ''}><option value="">Particular / sem convênio</option>
            ${planos.map((x) => `<option value="${x.id}" ${x.id === planoId ? 'selected' : ''}>${esc(x.contrato)} · cart. ${esc(x.carteirinha)}</option>`).join('')}</select>
            ${!planos.length ? '<small class="muted">Paciente sem convênio vinculado. Vincule na ficha do paciente.</small>' : ''}</label>
          ${pl && pl.exige ? `<label style="grid-column:1/-1">Autorização (senha)<select id="c-aut" ${bloq || travado ? 'disabled' : ''}>
            <option value="">Escolha…</option>
            ${pl.autorizacoes.map((x) => `<option value="${x.id}" ${x.id === autId ? 'selected' : ''} ${saldo(x) <= 0 && x.id !== autId ? 'disabled' : ''}>
              ${x.status === 'pendente' ? '⏳ PENDENTE' : 'senha ' + esc(x.senha)} · ${esc(x.codigo)} · ${x.usadas} feitas + ${x.agendadas} agendadas de ${x.qtd}${x.validade ? ' · val. ' + new Date(x.validade + 'T12:00').toLocaleDateString('pt-BR') : ''}</option>`).join('')}
            <option value="nova" ${autId === 'nova' ? 'selected' : ''}>+ Nova solicitação de autorização</option></select></label>
          ${autId === 'nova' ? `<label style="grid-column:1/-1">Procedimento<select id="c-proc">${[...pl.procedimentos].sort((x, y) => x.codigo.localeCompare(y.codigo))
              .map((x) => `<option value="${x.id}">${esc(x.codigo)} — ${esc(x.descricao)}</option>`).join('')}</select></label>
            <label>Sessões solicitadas<input id="c-qtd" type="number" min="1" value="10"></label>
            <label>Senha (se já tiver)<input id="c-senha"></label>
            <label>Data da autorização<input id="c-data" type="date"></label>
            <label>Validade<input id="c-val" type="date"></label>
            <p class="muted" style="grid-column:1/-1">Sem senha, a solicitação fica <strong>pendente</strong> e vira tarefa "Autorizar guia" para recepção, gestão e o profissional.</p>` : ''}`
          : pl ? '<p class="muted" style="grid-column:1/-1">Este contrato não exige senha.</p>' : ''}</div>`;
        if (autId === 'nova' && novo.pre?.proc && $('#c-proc', conv)) { $('#c-proc', conv).value = novo.pre.proc; if (novo.pre.porSessao && $('#c-qtd', conv)) $('#c-qtd', conv).value = 1; }
        $('#c-plano', conv)?.addEventListener('change', (e) => { planoId = e.target.value; autId = ''; desenharConv(); });
        $('#c-aut', conv)?.addEventListener('change', (e) => { autId = e.target.value; desenharConv(); });
      }
      if (pacienteId) carregarConv();
      if (busca) busca.oninput = () => {
        pacienteId = null; clearTimeout(t); conv.innerHTML = '';
        t = setTimeout(async () => {
          if (busca.value.trim().length < 2) return (sug.innerHTML = '');
          const { data: ps } = await sb.from('pacientes').select('id, nome, telefone, celular, alerta').eq('clinica_id', estado.clinica.id).eq('ativo', true)
            .ilike('nome', `%${busca.value.trim()}%`).order('nome').limit(8);
          sug.innerHTML = (ps || []).map((x) => `<div data-id="${x.id}">${x.alerta ? '⚠️ ' : ''}${esc(x.nome)} <span class="muted">${esc(x.celular || x.telefone || '')}</span></div>`).join('')
            || '<div class="muted">Nenhum paciente — cadastre em Pacientes.</div>';
          $$('[data-id]', sug).forEach((d) => (d.onclick = () => { pacienteId = d.dataset.id; const px = ps.find((x) => x.id === d.dataset.id); busca.value = px.nome; if (px.alerta) toast('⚠️ Alerta do paciente: ' + px.alerta, true); sug.innerHTML = ''; planoId = ''; autId = ''; carregarConv(); }));
        }, 250);
      };
      $$('[data-st]', m).forEach((b) => (b.onclick = async () => {
        if (b.dataset.st === 'atendido' && a.status !== 'atendido') {
          const { fecharAtendimento } = await import('./guia.js');
          return fecharAtendimento(a, render);
        }
        const { error: e } = await sb.from('atendimentos').update({ status: b.dataset.st, atualizado_em: new Date().toISOString() }).eq('id', a.id);
        if (e) return falha(e); fechar(); render();
      }));
      $('#canc', m)?.addEventListener('click', async () => {
        if (!(await confirmar('Cancelar este agendamento?', 'Cancelar agendamento'))) return;
        const { error: e } = await sb.from('atendimentos').update({ status: 'cancelado', atualizado_em: new Date().toISOString() }).eq('id', a.id);
        if (e) return falha(e); toast('Agendamento cancelado.'); render();
        // Lista de espera (item 13): vaga futura que abriu → oferece para quem espera esse profissional/serviço
        if (new Date(a.inicio) > new Date()) try {
          const { candidatosParaVaga } = await import('./espera.js');
          const cs = await candidatosParaVaga({ profissionalId: a.profissional_id, inicio: a.inicio, servico: a.servico, pacienteId: a.paciente_id });
          if (cs.length && await confirmar(`${cs.length} pessoa(s) na lista de espera podem ficar com este horário. Abrir a lista de espera agora?`, 'Abrir lista de espera')) location.hash = 'espera';
        } catch { /* lista de espera indisponível: o cancelamento já foi feito */ }
      });
      $('#s', m)?.addEventListener('click', async () => {
        const f = Object.fromEntries(new FormData($('#f', m)));
        if (souProf && !a) f.profissional_id = estado.profissionalId;   // select desabilitado não entra no FormData
        if (souProf && a) {
          const { error: e } = await sb.from('atendimentos').update({ observacao: f.observacao || null, atualizado_em: new Date().toISOString() }).eq('id', a.id);
          if (e) return falha(e); fechar(); return render();
        }
        if (!pacienteId) return toast('Escolha o paciente na lista.', true);
        // Lê tudo do formulário ANTES de qualquer confirmar() (ele troca o conteúdo do modal)
        const dur = Number(f.dur), sala = f.sala || null;
        const serie = !a && $('#rep', m)?.checked;
        const diasSel = serie ? $$('.rep-dia:checked', m).map((x) => Number(x.value)) : [];
        let nSessoes = serie ? Math.max(2, Math.min(60, parseInt($('#rep-n', m).value) || 2)) : 1;
        if (serie && !diasSel.length) return toast('Marque ao menos um dia da semana para a série.', true);
        const pl = planos.find((x) => x.id === planoId);
        if (pl?.exige && !autId) return toast('Convênio exige autorização: escolha uma ou crie nova solicitação.', true);
        const nova = autId === 'nova' ? { senha: $('#c-senha', m).value.trim(), dAut: $('#c-data', m).value || null,
          qtd: Math.max(1, parseInt($('#c-qtd', m).value) || 1), proc: $('#c-proc', m).value, val: $('#c-val', m).value || null } : null;
        if (nova?.senha && !nova.dAut) return toast('Informe a data da autorização junto com a senha.', true);
        let aviso = '';
        const porSessao = !!pl?.senha_por_sessao;   // Amil: 1 senha por atendimento
        if (nova && porSessao) nova.qtd = 1;
        if (pl?.exige && !a && !porSessao) {
          const x = pl.autorizacoes.find((y) => y.id === autId);
          const saldo = nova ? nova.qtd : x ? Number(x.qtd) - Number(x.usadas) - Number(x.agendadas) : nSessoes;
          if (nSessoes > saldo) { aviso = `A senha tem saldo de ${saldo} sessão(ões): a série foi limitada a ${saldo}. `; nSessoes = saldo; }
          if (nSessoes < 1) return toast('Autorização sem saldo de sessões.', true);
        }
        // Datas
        const datas = [];
        if (serie) {
          for (let d = f.dia, k = 0; datas.length < nSessoes && k < 400; d = somaDias(d, 1), k++)
            if (diasSel.includes(new Date(d + 'T12:00').getDay())) datas.push(d);
        } else datas.push(f.dia);
        const ocorr = datas.map((d) => { const ini = new Date(`${d}T${f.hora}:00`); return { dia: d, ini, fim: new Date(ini.getTime() + dur * 6e4) }; });
        // Conflitos de profissional e de sala (uma consulta para o período todo)
        // Profissional não lê a agenda dos colegas: a ocupação de sala/horário vem de ocupacao_agenda (sem dados do paciente)
        const { data: ocup, error: eo } = souProf
          ? await sb.rpc('ocupacao_agenda', { p_clinica: estado.clinica.id, p_de: ocorr[0].ini.toISOString(), p_ate: ocorr.at(-1).fim.toISOString() })
          : await sb.from('atendimentos').select('id, inicio, fim, sala, profissional_id').eq('clinica_id', estado.clinica.id)
          .neq('status', 'cancelado').lt('inicio', ocorr.at(-1).fim.toISOString()).gt('fim', ocorr[0].ini.toISOString())
          .or(`profissional_id.eq.${f.profissional_id}${sala ? `,sala.eq."${sala.replace(/"/g, '')}"` : ''}`);
        if (eo) return falha(eo, 'Conflitos');
        const outros = (ocup || []).filter((x) => x.id !== a?.id);
        const nomeP = (pid) => profs.find((x) => x.id === pid)?.nome || 'outro profissional';
        for (const o of ocorr) {
          const mi = o.ini.getHours() * 60 + o.ini.getMinutes();
          const sob = outros.filter((x) => new Date(x.inicio) < o.fim && new Date(x.fim) > o.ini);
          o.motivos = [
            ...(pausasDoDia(o.dia).some((x) => mi < x.ate && mi + dur > x.de) ? ['fora do expediente'] : []),
            ...(sob.some((x) => x.profissional_id === f.profissional_id) ? ['profissional ocupado'] : []),
            ...sob.filter((x) => sala && x.sala === sala && x.profissional_id !== f.profissional_id).map((x) => `${sala} ocupada por ${nomeP(x.profissional_id)}`)];
        }
        let criar = ocorr;
        if (serie) {
          const ok = ocorr.filter((o) => !o.motivos.length), pul = ocorr.filter((o) => o.motivos.length);
          if (!ok.length) return toast('Nenhuma data livre na série. Revise horário, dias ou sala.', true);
          const fmt = (o) => o.ini.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
          if (!(await confirmar(`${aviso}Serão criados ${ok.length} agendamentos às ${f.hora}: ${ok.map(fmt).join(', ')}.`
            + (porSessao && pl?.exige && ok.length > 1 ? ` Este convênio exige 1 senha por sessão: as outras ${ok.length - 1} sessões ficam com pedido de senha pendente (tarefa "Autorizar guia").` : '')
            + (pul.length ? ` Pulados (${pul.length}): ${pul.map((o) => `${fmt(o)} — ${o.motivos.join(', ')}`).join('; ')}. Encaixe esses individualmente se quiser.` : ''),
            `Criar ${ok.length}`))) return;
          criar = ok;
        } else if (ocorr[0].motivos.length && !(await confirmar(`Atenção: ${ocorr[0].motivos.join(', ')}. Agendar mesmo assim (encaixe)?`, 'Agendar'))) return;
        let autFinal = pl?.exige ? autId : null;
        if (nova) {
          const { data: nv, error: e1 } = await sb.from('autorizacoes').insert({ clinica_id: estado.clinica.id, paciente_plano_id: pl.id,
            profissional_id: f.profissional_id, procedimento_id: nova.proc, qtd_autorizada: nova.qtd, qtd_solicitada: nova.qtd,
            status: nova.senha ? 'autorizada' : 'pendente', senha: nova.senha || null, data_autorizacao: nova.dAut, validade: nova.val }).select('id').single();
          if (e1) return falha(e1, 'Autorização');
          autFinal = nv.id; autId = nv.id;
        }
        const base = { ...(carregado && !travado ? { paciente_plano_id: planoId || null, autorizacao_id: autFinal || null } : {}), paciente_id: pacienteId,
          profissional_id: f.profissional_id, servico: f.servico, sala, observacao: f.observacao || null, atualizado_em: new Date().toISOString() };
        // 1 senha por sessão: a 1ª ocorrência usa a autorização escolhida; as demais ganham solicitação pendente própria
        let autDe = criar.map(() => autFinal || null);
        if (serie && porSessao && pl?.exige && criar.length > 1) {
          const x = pl.autorizacoes.find((y) => y.id === autId);
          const modelo = { procedimento_id: x?.procedimento_id || nova?.proc, solicitante_id: x?.solicitante_id || null,
            encaminhamento_id: x?.encaminhamento_id || null, area: x?.area || null };
          if (!modelo.procedimento_id) return toast('Não achei o procedimento da autorização para repetir nas sessões.', true);
          const { data: nvs, error: e2 } = await sb.from('autorizacoes').insert(criar.slice(1).map(() => ({ clinica_id: estado.clinica.id,
            paciente_plano_id: pl.id, profissional_id: f.profissional_id, ...modelo, qtd_autorizada: 1, qtd_solicitada: 1, status: 'pendente',
            observacao: '1 senha por sessão — pedir no portal no dia' }))).select('id');
          if (e2) return falha(e2, 'Autorizações da série');
          autDe = [autFinal, ...nvs.map((z) => z.id)];
        }
        const serieId = serie ? crypto.randomUUID() : null;
        const { error: e } = a ? await sb.from('atendimentos').update({ ...base, inicio: ocorr[0].ini.toISOString(), fim: ocorr[0].fim.toISOString() }).eq('id', a.id)
          : await sb.from('atendimentos').insert(criar.map((o, i) => ({ ...base, ...(serie && porSessao && pl?.exige ? { autorizacao_id: autDe[i] } : {}),
            clinica_id: estado.clinica.id, status: 'agendado', serie_id: serieId,
            inicio: o.ini.toISOString(), fim: o.fim.toISOString() })));
        if (e) return falha(e); fechar(); toast(serie ? `${criar.length} agendamentos criados.` : 'Agendamento salvo.'); vis.dia = f.dia;
        if (!a && novo.pre) toast('Agendado. A faixa continua para marcar outra sessão; use "Voltar à ficha" quando terminar.');
        render();
      });
    });
  }
}

const travado0 = (a) => ['atendido', 'cancelado'].includes(a.status);

// Lembretes do dia escolhido (padrão: próximo dia de atendimento) — envio manual pelo WhatsApp da clínica
function proximoDiaAberto(cfg) {
  let d = somaDias(hojeIso(), 1);
  for (let k = 0; k < 7 && !(cfg.dias || [1, 2, 3, 4, 5, 6]).includes(new Date(d + 'T12:00').getDay()); k++) d = somaDias(d, 1);
  return d;
}
function lembretes(cfg, profs, aoFechar) {
  let dia = proximoDiaAberto(cfg);
  const nomeP = (pid) => profs.find((x) => x.id === pid)?.nome;
  modal(`<h3>📲 Lembretes de atendimento</h3>
    <div class="linha-acoes" style="justify-content:flex-start"><label>Dia <input type="date" id="ld" value="${dia}"></label></div>
    <p class="muted">Cada botão abre o WhatsApp (no computador ou celular onde está o WhatsApp da Cure) com a mensagem pronta. Depois de enviar,
      marque "Confirmou" quando o paciente responder. Lembrete de consulta agendada faz parte do atendimento (LGPD art. 7º, V); o campo "Aceita lembretes"
      do cadastro vale para divulgação e campanhas.</p>
    <div id="ll" class="vazio">Carregando…</div>
    <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button></div>`, (m, fechar) => {
    m.classList.add('largo');
    const caixa = $('#modal');
    caixa.onclick = (e) => { if (e.target === caixa) { fechar(); aoFechar(); } };
    $$('[data-fechar]', m).forEach((b) => (b.onclick = () => { fechar(); aoFechar(); }));
    async function carregar() {
      const { data: ats, error } = await sb.from('atendimentos').select('id, inicio, fim, status, servico, sala, profissional_id, lembrete_enviado_em, pacientes(nome, telefone, celular)')
        .eq('clinica_id', estado.clinica.id).gte('inicio', new Date(dia + 'T00:00').toISOString()).lt('inicio', new Date(somaDias(dia, 1) + 'T00:00').toISOString())
        .in('status', ['agendado', 'confirmado']).order('inicio');
      if (error) return falha(error);
      const pend = (ats || []).filter((x) => !x.lembrete_enviado_em && x.status === 'agendado').length;
      $('#ll', m).className = '';
      $('#ll', m).innerHTML = !ats?.length ? '<div class="vazio">Nenhum atendimento agendado neste dia.</div>' : `
        <p><strong>${ats.length}</strong> atendimento(s) · <strong>${pend}</strong> sem lembrete</p>
        <table class="tabela"><thead><tr><th>Hora</th><th>Paciente</th><th>Profissional</th><th>Sala</th><th></th></tr></thead><tbody>
        ${ats.map((x) => { const l = linkWhats(cfg, x, nomeP(x.profissional_id));
          return `<tr><td>${hm(x.inicio)}</td><td>${esc(x.pacientes?.nome || '')}<br><small class="muted">${esc(x.pacientes?.celular || x.pacientes?.telefone || 'sem telefone')}</small></td>
            <td>${esc(nomeP(x.profissional_id) || '')}<br><small class="muted">${esc(x.servico || '')}</small></td><td>${esc(x.sala || '—')}</td>
            <td style="white-space:nowrap">${l ? `<a class="btn pequeno ${x.lembrete_enviado_em ? '' : 'primario'}" target="_blank" rel="noopener" href="${esc(l)}" data-env="${x.id}">${x.lembrete_enviado_em ? '✓ Reenviar' : 'WhatsApp'}</a>` : '<span class="muted">sem celular</span>'}
              ${x.status === 'confirmado' ? '<span class="selo ok">confirmado</span>' : `<button class="btn pequeno" data-conf="${x.id}">Confirmou</button>`}</td></tr>`; }).join('')}
        </tbody></table>`;
      $$('[data-env]', m).forEach((b) => b.addEventListener('click', async () => {
        await sb.from('atendimentos').update({ lembrete_enviado_em: new Date().toISOString() }).eq('id', b.dataset.env);
        setTimeout(carregar, 800);
      }));
      $$('[data-conf]', m).forEach((b) => (b.onclick = async () => {
        const { error: e } = await sb.from('atendimentos').update({ status: 'confirmado', atualizado_em: new Date().toISOString() }).eq('id', b.dataset.conf);
        if (e) return falha(e); carregar();
      }));
    }
    $('#ld', m).onchange = (e) => { dia = e.target.value; carregar(); };
    carregar();
  });
}

export function mostrarCalendario(p) {
  if (!p) return toast('Profissional não encontrado.', true);
  const url = ICS(p.agenda_token);
  modal(`<h3>Agenda de ${esc(p.nome)} no Google ou Outlook</h3>
    <p>Este link mostra os atendimentos no calendário do celular. Aparecem só as <strong>iniciais</strong> do paciente.</p>
    <label>Link do calendário<input id="lnk" readonly value="${esc(url)}"></label>
    <div class="linha-acoes" style="justify-content:flex-start"><button class="btn primario" id="cp">Copiar link</button></div>
    <div class="dica"><strong>Google Agenda (no computador):</strong> calendar.google.com → ao lado de "Outras agendas" clique em <b>+</b> →
      <b>Do URL</b> → cole o link → <b>Adicionar agenda</b>. Aparece no celular automaticamente.</div>
    <div class="dica"><strong>Outlook:</strong> outlook.com → Calendário → <b>Adicionar calendário</b> → <b>Assinar da Web</b> → cole o link → Importar.</div>
    <p class="muted">O Google atualiza calendários assinados a cada algumas horas (o Outlook, em geral mais rápido). Para mudanças de última hora, vale o Cure OS.
      Não compartilhe o link: quem tiver o link vê a agenda.</p>
    <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button></div>`, (m) => {
    $('#cp', m).onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copiado.'); } catch { $('#lnk', m).select(); toast('Selecione e copie com Ctrl+C.'); } };
  });
}

// Item 31: selo da sessão (cinza normal · laranja acabando · vermelho última/vencida)
function nivelSessao(x, dia) {
  if (!x || !x.n) return '';
  const vence = x.validade ? Math.round((new Date(x.validade + 'T12:00') - new Date((dia || new Date().toLocaleDateString('sv')) + 'T12:00')) / 864e5) : null;
  if ((x.total && x.n >= x.total) || (vence !== null && vence < 0)) return 'fim';
  if ((x.total && x.total - x.n <= SALDO_AVISO) || (vence !== null && vence <= DIAS_AVISO)) return 'acabando'; // pela posição: série toda agendada não pinta tudo de laranja
  return 'ok';
}
function seloSessao(x) {
  if (!x || !x.n) return '';
  return ` <em class="ses ses-${nivelSessao(x)}" title="${x.base === 'encaminhamento' ? 'Sessão do encaminhamento (1 senha por sessão)' : 'Sessão da senha'}">S ${x.n}${x.total ? '/' + x.total : ''}</em>`;
}
function linhaSessao(x, senha) {
  if (!x || !x.n) return '';
  const val = x.validade ? ' · vence ' + new Date(x.validade + 'T12:00').toLocaleDateString('pt-BR') : '';
  const resta = x.restam !== null && x.total ? ` · restam ${x.restam}` : '';
  return `<p class="ses-linha ses-${nivelSessao(x)}">${senha ? 'Senha ' + esc(senha) + ' · ' : ''}${x.base === 'encaminhamento' ? 'sessão do encaminhamento ' : 'sessão '}${x.n}${x.total ? ' de ' + x.total : ''}${resta}${val}</p>`;
}
