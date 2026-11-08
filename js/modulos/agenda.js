// Módulo Agenda: visão do dia (colunas = profissionais) e da semana (colunas = dias de um profissional).
import { sb, estado, $, $$, esc, tela, toast, falha, modal, confirmar } from '../core.js';

const SERVICOS = ['Fisioterapia', 'Nutrição', 'Psicologia', 'Palmilha / Baropodometria', 'Terapia Ocupacional', 'Avaliação'];
const STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', presente: 'Presente', atendido: 'Atendido', faltou: 'Faltou', cancelado: 'Cancelado' };
const PX_MIN = 1.4; // altura em pixels por minuto
const ICS = (t) => `https://paipxhfhwiztznvbxawz.supabase.co/functions/v1/agenda-ics?t=${t}`;
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const hm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const minDe = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const isoLocal = (dia, min) => new Date(`${dia}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`).toISOString();
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

let vis = { dia: hojeIso(), modo: 'dia', prof: '' };

export async function render() {
  const souProf = estado.perfil === 'profissional';
  const c = tela('Agenda', `
    <button class="btn" id="ant">‹</button><input type="date" id="dia" value="${vis.dia}"><button class="btn" id="prox">›</button>
    <button class="btn" id="hoje">Hoje</button>
    <select id="modo"><option value="dia">Dia</option><option value="semana">Semana</option></select>
    ${souProf ? '' : '<select id="prof"><option value="">Todos os profissionais</option></select>'}
    ${souProf ? '<button class="btn" id="cal">Ligar ao Google/Outlook</button>' : '<button class="btn primario" id="novo">+ Agendamento</button>'}`);
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

  let q = sb.from('atendimentos').select('id, inicio, fim, status, servico, sala, observacao, profissional_id, paciente_id, pacientes(nome, telefone)')
    .eq('clinica_id', estado.clinica.id).gte('inicio', new Date(de + 'T00:00').toISOString()).lt('inicio', new Date(somaDias(ate, 1) + 'T00:00').toISOString())
    .neq('status', 'cancelado').order('inicio');
  if (vis.prof) q = q.eq('profissional_id', vis.prof);
  const { data: ats, error } = await q;
  if (error) return falha(error);

  const ini = minDe(cfg.abre), fimMin = minDe(cfg.fecha), altura = (fimMin - ini) * PX_MIN;
  const horas = []; for (let m = Math.ceil(ini / 60) * 60; m < fimMin; m += 60) horas.push(m);
  const pausas = (cfg.pausas || []).map((x) => ({ de: minDe(x.de), ate: minDe(x.ate), nome: x.nome || 'Pausa' }));
  const pausasDoDia = (dia) => {
    const f = (cfg.fecha_por_dia || {})[new Date(dia + 'T12:00').getDay()];
    return f && minDe(f) < fimMin ? [...pausas.filter((x) => x.de < minDe(f)), { de: minDe(f), ate: fimMin, nome: 'Fechado' }] : pausas;
  };
  const naPausa = (min, dia) => pausasDoDia(dia).some((x) => min >= x.de && min < x.ate);
  const corDe = (pid) => profs.find((p) => p.id === pid)?.cor || '#F8781D';

  c.innerHTML = `<div class="cartao agenda-wrap"><div class="agenda" style="grid-template-columns:56px repeat(${colunas.length}, minmax(150px,1fr))">
    <div></div>${colunas.map((col) => `<div class="ag-tit">${esc(col.titulo)}</div>`).join('')}
    <div class="ag-horas" style="height:${altura}px">${horas.map((m) => `<span style="top:${(m - ini) * PX_MIN}px">${String(m / 60).padStart(2, '0')}:00</span>`).join('')}</div>
    ${colunas.map((col, ci) => `<div class="ag-col" data-ci="${ci}" style="height:${altura}px">
      ${horas.map((m) => `<i style="top:${(m - ini) * PX_MIN}px"></i>`).join('')}
      ${pausasDoDia(col.dia).map((x) => `<div class="ag-pausa" style="top:${(x.de - ini) * PX_MIN}px;height:${(x.ate - x.de) * PX_MIN}px">${esc(x.nome)}</div>`).join('')}
      ${ats.filter((a) => a.profissional_id === col.prof && new Date(a.inicio).toLocaleDateString('sv') === col.dia).map((a) => {
        const s = new Date(a.inicio), e = new Date(a.fim), top = (s.getHours() * 60 + s.getMinutes() - ini) * PX_MIN;
        const h = Math.max(22, ((e - s) / 6e4) * PX_MIN - 2);
        return `<div class="ag-ev st-${a.status}" data-id="${a.id}" style="top:${top}px;height:${h}px;border-left-color:${corDe(a.profissional_id)}">
          <b>${hm(a.inicio)} ${esc(a.pacientes?.nome || '')}</b><span>${esc(a.servico || '')}${a.sala ? ' · ' + esc(a.sala) : ''} · ${STATUS[a.status]}</span></div>`;
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
    modal(`<h3>${a ? 'Agendamento' : 'Novo agendamento'}</h3>
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
        <label>Sala<input name="sala" value="${esc(a?.sala || '')}" ${souProf ? 'disabled' : ''}></label>
        <label style="grid-column:1/-1">Observação<input name="observacao" value="${esc(a?.observacao || '')}"></label>
      </form>
      ${a ? `<p class="muted">${a.pacientes?.telefone ? 'Telefone: ' + esc(a.pacientes.telefone) + ' · ' : ''}<a href="#paciente-${a.paciente_id}" data-fechar>Abrir ficha do paciente →</a></p>` : ''}
      <div class="linha-acoes">${a && !souProf ? '<button class="btn escuro" id="canc">Cancelar agendamento</button>' : ''}
        <button class="btn" data-fechar>Fechar</button>${souProf && !a ? '' : '<button class="btn primario" id="s">Salvar</button>'}</div>`,
    (m, fechar) => {
      const busca = $('#pbusca', m), sug = $('#psug', m); let t;
      if (busca) busca.oninput = () => {
        pacienteId = null; clearTimeout(t);
        t = setTimeout(async () => {
          if (busca.value.trim().length < 2) return (sug.innerHTML = '');
          const { data: ps } = await sb.from('pacientes').select('id, nome, telefone').eq('clinica_id', estado.clinica.id).eq('ativo', true)
            .ilike('nome', `%${busca.value.trim()}%`).order('nome').limit(8);
          sug.innerHTML = (ps || []).map((x) => `<div data-id="${x.id}">${esc(x.nome)} <span class="muted">${esc(x.telefone || '')}</span></div>`).join('')
            || '<div class="muted">Nenhum paciente — cadastre em Pacientes.</div>';
          $$('[data-id]', sug).forEach((d) => (d.onclick = () => { pacienteId = d.dataset.id; busca.value = ps.find((x) => x.id === d.dataset.id).nome; sug.innerHTML = ''; }));
        }, 250);
      };
      $$('[data-st]', m).forEach((b) => (b.onclick = async () => {
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
        const inicio = new Date(`${f.dia}T${f.hora}:00`), fim = new Date(inicio.getTime() + Number(f.dur) * 6e4);
        const { data: choque } = await sb.from('atendimentos').select('id').eq('profissional_id', f.profissional_id).neq('status', 'cancelado')
          .lt('inicio', fim.toISOString()).gt('fim', inicio.toISOString()).neq('id', a?.id || '00000000-0000-0000-0000-000000000000').limit(1);
        const mi = inicio.getHours() * 60 + inicio.getMinutes(), mf = mi + Number(f.dur);
        if (pausasDoDia(f.dia).some((x) => mi < x.ate && mf > x.de) && !(await confirmar('Esse horário está fora do expediente (almoço ou clínica fechada). Agendar mesmo assim?', 'Agendar'))) return;
        if (choque?.length && !(await confirmar('Este profissional já tem atendimento nesse horário. Agendar mesmo assim (encaixe)?', 'Agendar'))) return;
        const reg = { paciente_id: pacienteId, profissional_id: f.profissional_id, servico: f.servico, sala: f.sala || null, observacao: f.observacao || null,
          inicio: inicio.toISOString(), fim: fim.toISOString(), atualizado_em: new Date().toISOString() };
        const { error: e } = a ? await sb.from('atendimentos').update(reg).eq('id', a.id)
          : await sb.from('atendimentos').insert({ ...reg, clinica_id: estado.clinica.id, status: 'agendado' });
        if (e) return falha(e); fechar(); toast('Agendamento salvo.'); vis.dia = f.dia; render();
      });
    });
  }
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
