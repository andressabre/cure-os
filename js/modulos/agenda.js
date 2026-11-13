// Módulo Agenda: visão do dia (colunas = profissionais) e da semana (colunas = dias de um profissional).
// Salas (config.salas; padrão = última sala usada pelo profissional), agendamento em série (serie_id) e lembretes por WhatsApp (link wa.me, sem custo).
import { sb, estado, $, $$, esc, tela, toast, falha, modal, confirmar } from '../core.js';

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

let vis = { dia: hojeIso(), modo: 'dia', prof: '' };

export async function render() {
  const souProf = estado.perfil === 'profissional';
  const c = tela('Agenda', `
    <button class="btn" id="ant">‹</button><input type="date" id="dia" value="${vis.dia}"><button class="btn" id="prox">›</button>
    <button class="btn" id="hoje">Hoje</button>
    <select id="modo"><option value="dia">Dia</option><option value="semana">Semana</option></select>
    ${souProf ? '' : '<select id="prof"><option value="">Todos os profissionais</option></select>'}
    ${souProf ? '<button class="btn" id="cal">Ligar ao Google/Outlook</button>' : '<button class="btn" id="lemb">📲 Lembretes</button><button class="btn" id="relac">💬 Relacionamento</button><button class="btn primario" id="novo">+ Agendamento</button>'}`);
  if (souProf) vis.prof = estado.profissionalId;

  const cfg = estado.clinica.config || (await sb.from('clinicas').select('config').eq('id', estado.clinica.id).single()).data?.config
    || { abre: '07:30', fecha: '19:30', intervalo_min: 15, pausas: [] };
  estado.clinica.config = cfg;
  const { data: profs } = await sb.from('profissionais').select('id, nome, cor, duracao_padrao_min, agenda_token, especialidade')
    .eq('clinica_id', estado.clinica.id).eq('ativo', true).order('nome');
  if (!souProf) $('#prof').innerHTML += (profs || []).map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  $('#modo').value = vis.modo; if ($('#prof')) $('#prof').value = vis.prof;

  const ir = (n) => { vis.dia = somaDias(vis.dia, n * (vis.modo === 'semana' ? 7 : 1)); render(); };
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

  // Colunas
  let colunas, de, ate;
  if (vis.modo === 'semana') {
    if (!vis.prof) { c.innerHTML = '<div class="cartao vazio">Escolha um profissional para ver a semana.</div>'; return; }
    const d0 = new Date(vis.dia + 'T12:00'); const seg = somaDias(vis.dia, -((d0.getDay() + 6) % 7));
    colunas = Array.from({ length: 7 }, (_, i) => somaDias(seg, i)).filter((d) => (cfg.dias || [1, 2, 3, 4, 5, 6]).includes(new Date(d + 'T12:00').getDay()))
      .map((d) => ({ titulo: new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }), dia: d, prof: vis.prof }));
    de = colunas[0].dia; ate = colunas.at(-1).dia;
  } else {
    const lista = vis.prof ? profs.filter((p) => p.id === vis.prof) : profs;
    colunas = lista.map((p) => ({ titulo: p.nome, dia: vis.dia, prof: p.id, cor: p.cor }));
    de = ate = vis.dia;
  }
  if (!colunas.length) { c.innerHTML = '<div class="cartao vazio">Cadastre profissionais para usar a agenda.</div>'; return; }

  let q = sb.from('atendimentos').select('id, inicio, fim, status, servico, sala, observacao, profissional_id, paciente_id, paciente_plano_id, autorizacao_id, serie_id, lembrete_enviado_em, pacientes(nome, telefone, celular)')
    .eq('clinica_id', estado.clinica.id).gte('inicio', new Date(de + 'T00:00').toISOString()).lt('inicio', new Date(somaDias(ate, 1) + 'T00:00').toISOString())
    .neq('status', 'cancelado').order('inicio');
  if (vis.prof) q = q.eq('profissional_id', vis.prof);
  const { data: ats, error } = await q;
  if (error) return falha(error);
  // Item 31 (db/043): "sessão N de X" de cada atendimento ligado a senha — uma chamada para a tela inteira
  const ids = ats.filter((a) => a.autorizacao_id).map((a) => a.id), num = {};
  if (ids.length) { const { data: ns } = await sb.rpc('numeracao_sessoes', { p_atendimentos: ids }); (ns || []).forEach((x) => (num[x.atendimento_id] = x)); }

  const ini = minDe(cfg.abre), fimMin = minDe(cfg.fecha), altura = (fimMin - ini) * PX_MIN;
  const horas = []; for (let m = Math.ceil(ini / 60) * 60; m < fimMin; m += 60) horas.push(m);
  const pausas = (cfg.pausas || []).map((x) => ({ de: minDe(x.de), ate: minDe(x.ate), nome: x.nome || 'Pausa' }));
  const pausasDoDia = (dia) => {
    const f = (cfg.fecha_por_dia || {})[new Date(dia + 'T12:00').getDay()];
    return f && minDe(f) < fimMin ? [...pausas.filter((x) => x.de < minDe(f)), { de: minDe(f), ate: fimMin, nome: 'Fechado' }] : pausas;
  };
  const naPausa = (min, dia) => pausasDoDia(dia).some((x) => min >= x.de && min < x.ate);
  const corDe = (pid) => profs.find((p) => p.id === pid)?.cor || '#F8781D';

  import('./guia.js').then((g) => g.alertaSemSenha($('#alerta-senha'), render)).catch(() => {});
  c.innerHTML = `<div id="alerta-senha"></div><div class="cartao agenda-wrap"><div class="agenda" style="grid-template-columns:56px repeat(${colunas.length}, minmax(150px,1fr))">
    <div></div>${colunas.map((col) => `<div class="ag-tit">${esc(col.titulo)}</div>`).join('')}
    <div class="ag-horas" style="height:${altura}px">${horas.map((m) => `<span style="top:${(m - ini) * PX_MIN}px">${String(m / 60).padStart(2, '0')}:00</span>`).join('')}</div>
    ${colunas.map((col, ci) => `<div class="ag-col" data-ci="${ci}" style="height:${altura}px">
      ${horas.map((m) => `<i style="top:${(m - ini) * PX_MIN}px"></i>`).join('')}
      ${pausasDoDia(col.dia).map((x) => `<div class="ag-pausa" style="top:${(x.de - ini) * PX_MIN}px;height:${(x.ate - x.de) * PX_MIN}px">${esc(x.nome)}</div>`).join('')}
      ${ats.filter((a) => a.profissional_id === col.prof && new Date(a.inicio).toLocaleDateString('sv') === col.dia).map((a) => {
        const s = new Date(a.inicio), e = new Date(a.fim), top = (s.getHours() * 60 + s.getMinutes() - ini) * PX_MIN;
        const h = Math.max(22, ((e - s) / 6e4) * PX_MIN - 2);
        return `<div class="ag-ev st-${a.status}" data-id="${a.id}" style="top:${top}px;height:${h}px;border-left-color:${corDe(a.profissional_id)}">
          <b>${hm(a.inicio)} ${esc(a.pacientes?.nome || '')}${seloSessao(num[a.id])}</b><span>${esc(a.servico || '')}${a.sala ? ' · ' + esc(a.sala) : ''} · ${STATUS[a.status]}</span></div>`;
      }).join('')}</div>`).join('')}
  </div></div>`;

  $$('.ag-col', c).forEach((el) => (el.onclick = (e) => {
    if (e.target.closest('.ag-ev') || souProf) return;
    const col = colunas[el.dataset.ci], y = e.clientY - el.getBoundingClientRect().top;
    const passo = cfg.intervalo_min || 10, min = ini + Math.floor(y / PX_MIN / passo) * passo;
    if (naPausa(min, col.dia)) return toast('Fora do expediente. Para encaixe, use + Agendamento e ajuste a hora.');
    editar(null, { dia: col.dia, min, prof: col.prof });
  }));
  $$('.ag-ev', c).forEach((el) => (el.onclick = () => editar(ats.find((a) => a.id === el.dataset.id))));

  // ---------- Modal de agendamento ----------
  function editar(a, novo = {}) {
    const p = a ? profs.find((x) => x.id === a.profissional_id) : profs.find((x) => x.id === novo.prof) || profs[0];
    const dia = a ? new Date(a.inicio).toLocaleDateString('sv') : novo.dia;
    const hora = a ? hm(a.inicio) : `${String(Math.floor(novo.min / 60)).padStart(2, '0')}:${String(novo.min % 60).padStart(2, '0')}`;
    const dur = a ? Math.round((new Date(a.fim) - new Date(a.inicio)) / 6e4) : p?.duracao_padrao_min || 45;
    let pacienteId = a?.paciente_id || null;
    modal(`<h3>${a ? 'Agendamento' : 'Novo agendamento'}</h3>${a ? linhaSessao(num[a.id]) : ''}
      ${a ? `<div class="linha-acoes" style="justify-content:flex-start;margin:0 0 12px">${Object.entries(STATUS).filter(([k]) => k !== 'cancelado')
        .map(([k, v]) => `<button class="btn pequeno ${a.status === k ? 'primario' : ''}" data-st="${k}">${v}</button>`).join('')}</div>` : ''}
      <form class="grade-form" id="f">
        <label style="grid-column:1/-1">Paciente${souProf ? `<input value="${esc(a?.pacientes?.nome)}" disabled>` : `
          <input id="pbusca" placeholder="Digite o nome" value="${esc(a?.pacientes?.nome || '')}" autocomplete="off"><div id="psug" class="sugestoes"></div>`}</label>
        <label>Profissional<select name="profissional_id" ${souProf ? 'disabled' : ''}>${profs.map((x) => `<option value="${x.id}" ${x.id === p?.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Serviço<select name="servico">${SERVICOS.map((s) => `<option ${s === (a?.servico || p?.especialidade) ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Data<input type="date" name="dia" value="${dia}" ${souProf ? 'disabled' : ''}></label>
        <label>Hora<input type="time" name="hora" value="${hora}" step="300" ${souProf ? 'disabled' : ''}></label>
        <label>Duração (min)<input type="number" name="dur" value="${dur}" min="5" step="5" ${souProf ? 'disabled' : ''}></label>
        <label>Sala<select name="sala" ${souProf ? 'disabled' : ''}><option value="">—</option>
          ${[...new Set([...SALAS, ...(a?.sala ? [a.sala] : [])])].map((s) => `<option ${s === a?.sala ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        ${!a && !souProf ? `<div style="grid-column:1/-1" class="serie-box">
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
        <button class="btn" data-fechar>Fechar</button>${souProf && !a ? '' : '<button class="btn primario" id="s">Salvar</button>'}</div>`,
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
      const conv = $('#conv', m); let planos = [], planoId = a?.paciente_plano_id || '', autId = a?.autorizacao_id || '';
      const travado = a && ['atendido', 'cancelado'].includes(a.status); let carregado = false;
      async function carregarConv() {
        if (!pacienteId) { conv.innerHTML = ''; return; }
        const { data: ps, error: e } = await sb.rpc('autorizacoes_paciente', { p_paciente: pacienteId });
        if (e) return falha(e, 'Convênios');
        planos = ps || []; carregado = true;
        if (!a && !planoId) planoId = '';
        desenharConv();
      }
      function desenharConv() {
        const pl = planos.find((x) => x.id === planoId);
        const saldo = (x) => Number(x.qtd) - Number(x.usadas) - Number(x.agendadas) + (a && a.autorizacao_id === x.id ? 1 : 0);
        conv.innerHTML = `<div class="grade-form" style="margin-top:12px">
          <label style="grid-column:1/-1">Convênio<select id="c-plano" ${souProf || travado ? 'disabled' : ''}><option value="">Particular / sem convênio</option>
            ${planos.map((x) => `<option value="${x.id}" ${x.id === planoId ? 'selected' : ''}>${esc(x.contrato)} · cart. ${esc(x.carteirinha)}</option>`).join('')}</select>
            ${!planos.length ? '<small class="muted">Paciente sem convênio vinculado. Vincule na ficha do paciente.</small>' : ''}</label>
          ${pl && pl.exige ? `<label style="grid-column:1/-1">Autorização (senha)<select id="c-aut" ${souProf || travado ? 'disabled' : ''}>
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
      });
      $('#s', m)?.addEventListener('click', async () => {
        const f = Object.fromEntries(new FormData($('#f', m)));
        if (souProf) {
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
        const { data: ocup, error: eo } = await sb.from('atendimentos').select('id, inicio, fim, sala, profissional_id').eq('clinica_id', estado.clinica.id)
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
        if (e) return falha(e); fechar(); toast(serie ? `${criar.length} agendamentos criados.` : 'Agendamento salvo.'); vis.dia = f.dia; render();
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
