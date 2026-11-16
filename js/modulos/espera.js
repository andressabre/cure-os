// Módulo Lista de espera (item 13, db/057): vagas que abriram por cancelamento → quem espera aquele profissional/serviço,
// mensagem pronta no WhatsApp (wa.me, sem custo) que marca "ofertado", e atalho para agendar pela faixa da agenda (sessionStorage.agendar_para).
import { sb, estado, $, $$, esc, tela, toast, falha, modal, confirmar, areasDaEspecialidade, SERVICOS_DA_AREA, foneFmt, faltaBanco } from '../core.js';
import { foneWhats } from './agenda.js';

// Mesmos nomes de serviço da agenda (js/modulos/agenda.js)
const SERVICOS = ['Fisioterapia', 'Nutrição', 'Psicologia', 'Palmilha / Baropodometria', 'Terapia Ocupacional', 'Avaliação'];
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PERIODOS = { qualquer: 'Qualquer horário', manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const SITUACOES = { aguardando: 'Aguardando', ofertado: 'Vaga oferecida', agendado: 'Agendado', desistiu: 'Desistiu' };
const SELO_SIT = { aguardando: 'pendente', ofertado: 'clinica', agendado: 'ok', desistiu: 'outra' };
const JANELA_DIAS = 14;
export const TEXTO_PADRAO = 'Olá, {nome}! Abriu um horário de {servico} com {profissional} {dia} às {hora}. Quer que eu reserve para você?';

const hm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const diaLocal = (d) => new Date(d).toLocaleDateString('sv');
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv'); };
const primeiroNome = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p.toLowerCase().replace(/^./, (c) => c.toUpperCase()); };
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
export const periodoDe = (inicio) => { const h = new Date(inicio).getHours(); return h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite'; };
const diasNaFila = (x, agora = Date.now()) => Math.max(0, Math.floor((agora - new Date(x.criado_em)) / 864e5));
const ATIVAS = ['aguardando', 'ofertado'];

// "amanhã (18/11)", "na quarta-feira (19/11)" — mesmo jeito do lembrete da agenda
function quando(inicio) {
  const ini = new Date(inicio), hoje = new Date().toLocaleDateString('sv'), dia = diaLocal(inicio);
  const dm = ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (dia === hoje) return `hoje (${dm})`;
  if (dia === somaDias(hoje, 1)) return `amanhã (${dm})`;
  return `${ini.toLocaleDateString('pt-BR', { weekday: 'long' }).replace(/^(\S+)/, (w) => (/sábado|domingo/.test(w) ? 'no ' : 'na ') + w)} (${dm})`;
}

// Texto do convite (config.espera_texto ou padrão). Placeholders: {nome} {servico} {profissional} {dia} {hora}
export function textoOferta(cfg, vaga, item, nomeProf) {
  return String(cfg?.espera_texto || TEXTO_PADRAO).replace(/\{nome\}/g, primeiroNome(item.pacientes?.nome))
    .replace(/\{servico\}/g, String(vaga.servico || item.servico || 'atendimento').toLowerCase())
    .replace(/\{profissional\}/g, nomeProf || 'nossa equipe').replace(/\{dia\}/g, quando(vaga.inicio)).replace(/\{hora\}/g, hm(vaga.inicio));
}

/**
 * Função pura: quem da fila combina com a vaga, já em ordem.
 * vaga = { profissional_id, inicio, servico, paciente_id?, servicosDoProf? [serviços que o profissional da vaga atende] }
 * fila = linhas de lista_espera (com criado_em, urgencia, profissional_id, servico, dias_semana, periodo, situacao)
 * Entra: situação aguardando/ofertado; profissional igual, ou "qualquer" com serviço que o profissional da vaga atende
 *        (igual ao da vaga, ou da lista servicosDoProf); nunca o próprio paciente que cancelou.
 * Ordem: urgência alta → mesmo profissional (antes de "qualquer") → mesmo serviço → dia/período compatível → mais antigo.
 * Devolve [{ item, motivo, mesmoProf, mesmoServico, compat, diaOk, periodoOk }].
 */
export function combinar(vaga, fila) {
  const dow = new Date(vaga.inicio).getDay(), per = periodoDe(vaga.inicio);
  const servProf = new Set([vaga.servico, ...(vaga.servicosDoProf || [])].filter(Boolean));
  const out = [];
  for (const item of fila || []) {
    if (!ATIVAS.includes(item.situacao || 'aguardando')) continue;
    if (vaga.paciente_id && item.paciente_id === vaga.paciente_id) continue;
    const mesmoProf = !!item.profissional_id && item.profissional_id === vaga.profissional_id;
    if (item.profissional_id && !mesmoProf) continue;
    const mesmoServico = item.servico === vaga.servico;
    if (!mesmoProf && !servProf.has(item.servico)) continue;
    const dias = item.dias_semana?.length ? item.dias_semana.map(Number) : null;
    const diaOk = !dias || dias.includes(dow);
    const periodoOk = !item.periodo || item.periodo === 'qualquer' || item.periodo === per;
    const m = [];
    if (item.urgencia === 'alta') m.push('urgente');
    m.push(mesmoProf ? 'mesmo profissional' : 'qualquer profissional');
    if (!mesmoServico) m.push(`pediu ${item.servico}`);
    if (dias) m.push(diaOk ? `prefere ${dias.map((d) => DIAS[d].toLowerCase()).join(', ')}` : `outro dia (prefere ${dias.map((d) => DIAS[d].toLowerCase()).join(', ')})`);
    if (item.periodo && item.periodo !== 'qualquer') m.push(periodoOk ? `prefere ${PERIODOS[item.periodo].toLowerCase()}` : `outro período (prefere ${PERIODOS[item.periodo].toLowerCase()})`);
    if (item.situacao === 'ofertado') m.push('já recebeu oferta');
    out.push({ item, motivo: m.join(' · '), mesmoProf, mesmoServico, diaOk, periodoOk, compat: (diaOk ? 1 : 0) + (periodoOk ? 1 : 0) });
  }
  const t = (x) => +new Date(x.item.criado_em || 0);
  return out.sort((a, b) => (b.item.urgencia === 'alta') - (a.item.urgencia === 'alta') || b.mesmoProf - a.mesmoProf
    || b.mesmoServico - a.mesmoServico || b.compat - a.compat || t(a) - t(b));
}

const servicosDe = (prof) => [...new Set(areasDaEspecialidade(prof?.especialidade).flatMap((k) => SERVICOS_DA_AREA[k] || []))];
const SEL_FILA = 'id, clinica_id, paciente_id, profissional_id, servico, dias_semana, periodo, urgencia, observacao, situacao, ofertado_em, atendimento_id, criado_em, pacientes(nome, celular, telefone)';

/**
 * Para a agenda chamar ao cancelar: candidatos da fila para o horário que abriu.
 * candidatosParaVaga({ profissionalId, inicio, servico, pacienteId? }) → Promise<[{ item, motivo, … }]> (mesma saída de combinar)
 */
export async function candidatosParaVaga({ profissionalId, inicio, servico, pacienteId = null }) {
  const [{ data: fila, error }, { data: prof }] = await Promise.all([
    sb.from('lista_espera').select(SEL_FILA).eq('clinica_id', estado.clinica.id).in('situacao', ATIVAS),
    sb.from('profissionais').select('id, especialidade').eq('id', profissionalId).maybeSingle()]);
  if (error) throw error;
  return combinar({ profissional_id: profissionalId, inicio, servico, paciente_id: pacienteId, servicosDoProf: servicosDe(prof) }, fila || []);
}

// Vagas: cancelados no futuro (14 dias) cujo horário continua livre para o profissional
export function vagasLivres(cancelados, ativos, agora = Date.now()) {
  const vistos = new Set();
  return cancelados.filter((v) => {
    if (+new Date(v.inicio) < agora) return false;
    const k = v.profissional_id + '|' + v.inicio; if (vistos.has(k)) return false;
    const ocupado = ativos.some((a) => a.profissional_id === v.profissional_id && new Date(a.inicio) < new Date(v.fim) && new Date(a.fim) > new Date(v.inicio));
    if (ocupado) return false; vistos.add(k); return true;
  }).sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}

let filtro = { serv: '', prof: '', sit: 'ativas' };
try { filtro = { ...filtro, ...JSON.parse(sessionStorage.getItem('espera_filtro') || '{}') }; } catch { /* sem storage */ }

export async function render() {
  const souProf = estado.perfil === 'profissional', eu = estado.profissionalId;
  const c = tela('Lista de espera', '<button class="btn primario" id="esp-novo">+ Na espera</button>');
  const cfg = estado.clinica.config || (await sb.from('clinicas').select('config').eq('id', estado.clinica.id).single()).data?.config || {};
  estado.clinica.config = cfg;
  const agora = new Date(), ate = new Date(agora.getTime() + JANELA_DIAS * 864e5);
  let qc = sb.from('atendimentos').select('id, inicio, fim, servico, sala, profissional_id, paciente_id, status').eq('clinica_id', estado.clinica.id)
    .eq('status', 'cancelado').gte('inicio', agora.toISOString()).lt('inicio', ate.toISOString()).order('inicio');
  let qa = sb.from('atendimentos').select('id, inicio, fim, profissional_id').eq('clinica_id', estado.clinica.id)
    .neq('status', 'cancelado').lt('inicio', ate.toISOString()).gt('fim', agora.toISOString());
  if (souProf && eu) { qc = qc.eq('profissional_id', eu); qa = qa.eq('profissional_id', eu); }   // sócio no modo profissional: só as dele
  const [rP, rF, rC, rA] = await Promise.all([
    sb.from('profissionais').select('id, nome, especialidade').eq('clinica_id', estado.clinica.id).eq('ativo', true).order('nome'),
    sb.from('lista_espera').select(SEL_FILA).eq('clinica_id', estado.clinica.id).order('criado_em'), qc, qa]);
  if (faltaBanco(rF.error, c, 'db/057_lista_espera.sql')) { $('#acoes-tela').innerHTML = ''; return; }
  const erro = rP.error || rF.error || rC.error || rA.error; if (erro) return falha(erro, 'Lista de espera');
  const profs = rP.data || [], fila = rF.data || [];
  const nomeProf = (id) => profs.find((p) => p.id === id)?.nome || '';
  const podeMexer = (x) => !souProf || (x.profissional_id && x.profissional_id === eu);
  const vagas = vagasLivres(rC.data || [], rA.data || []).map((v) => ({ ...v, cand: combinar({ ...v, servicosDoProf: servicosDe(profs.find((p) => p.id === v.profissional_id)) }, fila) }));
  const indo = (() => { try { return JSON.parse(sessionStorage.getItem('espera_agendando') || 'null'); } catch { return null; } })();
  const indoItem = indo && fila.find((x) => x.id === indo.id && ATIVAS.includes(x.situacao));

  $('#esp-novo').onclick = () => editar(null);
  if (!vagas.length && !fila.length) {
    c.innerHTML = `<div class="cartao esp-vazio"><div class="esp-vazio-ic">⏳</div><h3>Ninguém na lista de espera</h3>
      <p>Coloque aqui quem quer um horário que ainda não existe (profissional, dias e período que prefere).</p>
      <p>Quando alguém cancelar nos próximos ${JANELA_DIAS} dias, a vaga aparece aqui com quem combina e a mensagem de WhatsApp pronta.</p>
      <button class="btn primario" id="esp-novo2">+ Colocar alguém na espera</button></div>`;
    $('#esp-novo2').onclick = () => editar(null);
    return;
  }

  const prefs = (x) => [x.dias_semana?.length ? x.dias_semana.map((d) => DIAS[d]).join(', ') : 'qualquer dia', PERIODOS[x.periodo || 'qualquer'].toLowerCase()].join(' · ');
  const cartaoVaga = (v, i) => {
    const dm = new Date(v.inicio).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    return `<div class="cartao esp-vaga"><div class="esp-vaga-topo"><div><strong>${esc(dm)} · ${hm(v.inicio)}–${hm(v.fim)}</strong>
      <div class="muted">${esc(nomeProf(v.profissional_id) || 'Profissional')} · ${esc(v.servico || 'Atendimento')}${v.sala ? ' · ' + esc(v.sala) : ''}</div></div>
      <span class="selo ${v.cand.length ? 'ok' : 'outra'}">${v.cand.length ? v.cand.length + ' na espera' : 'ninguém combina'}</span></div>
      ${v.cand.length ? `<ol class="esp-cand">${v.cand.slice(0, 5).map((k, j) => `<li><div class="esp-cand-info"><strong>${esc(k.item.pacientes?.nome || 'Paciente')}</strong>
          <div class="muted esp-motivo">${esc(k.motivo)} · na fila há ${diasNaFila(k.item)} dia(s)</div></div>
        <div class="esp-acoes"><button class="btn pequeno esp-wpp" data-v="${i}" data-k="${j}">📲 WhatsApp</button>
          <button class="btn pequeno" data-agendar="${i}" data-k="${j}">📅 Agendar</button></div></li>`).join('')}</ol>
        ${v.cand.length > 5 ? `<p class="muted">+ ${v.cand.length - 5} na fila para esta vaga.</p>` : ''}`
      : '<p class="muted">Ninguém da fila espera este profissional ou serviço.</p>'}</div>`;
  };

  c.innerHTML = `${indoItem ? `<div class="faixa-agendar esp-faixa"><span>Você foi agendar <strong>${esc(indoItem.pacientes?.nome)}</strong> pela lista de espera.
      Se o horário ficou marcado, tire da fila.</span><button class="btn pequeno primario" id="esp-ja">✓ Já agendei</button><button class="btn pequeno" id="esp-nao">Ainda não</button></div>` : ''}
    <h3 class="esp-titulo">Vagas que abriram <span class="muted">· próximos ${JANELA_DIAS} dias</span></h3>
    ${vagas.length ? `<div class="esp-vagas">${vagas.map(cartaoVaga).join('')}</div>`
      : `<div class="cartao vazio">Nenhum horário cancelado e ainda livre nos próximos ${JANELA_DIAS} dias. Quando alguém cancelar, a vaga aparece aqui com quem está esperando.</div>`}
    <h3 class="esp-titulo">Fila de espera</h3>
    <div class="cartao esp-filtros">
      <select id="esp-f-serv"><option value="">Serviço: todos</option>${[...new Set([...SERVICOS, ...fila.map((x) => x.servico)])].map((s) => `<option>${esc(s)}</option>`).join('')}</select>
      <select id="esp-f-prof"><option value="">Profissional: todos</option><option value="_qq">Qualquer profissional</option>${profs.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('')}</select>
      <select id="esp-f-sit"><option value="ativas">Aguardando e oferecidos</option>${Object.entries(SITUACOES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="">Todas</option></select>
      <span class="muted" id="esp-cont"></span></div>
    <div id="esp-fila"></div>`;

  [['esp-f-serv', 'serv'], ['esp-f-prof', 'prof'], ['esp-f-sit', 'sit']].forEach(([id, k]) => {
    const el = $('#' + id); if (![...el.options].some((o) => o.value === filtro[k])) filtro[k] = k === 'sit' ? 'ativas' : '';
    el.value = filtro[k]; el.onchange = () => { filtro[k] = el.value; try { sessionStorage.setItem('espera_filtro', JSON.stringify(filtro)); } catch { /* */ } desenharFila(); };
  });

  function desenharFila() {
    const ls = fila.filter((x) => (!filtro.serv || x.servico === filtro.serv)
      && (!filtro.prof || (filtro.prof === '_qq' ? !x.profissional_id : x.profissional_id === filtro.prof))
      && (filtro.sit === 'ativas' ? ATIVAS.includes(x.situacao) : !filtro.sit || x.situacao === filtro.sit))
      .sort((a, b) => (b.urgencia === 'alta') - (a.urgencia === 'alta') || new Date(a.criado_em) - new Date(b.criado_em));
    $('#esp-cont').textContent = `${ls.length} na lista`;
    $('#esp-fila').innerHTML = ls.length ? `<div class="esp-lista">${ls.map((x) => { const m = podeMexer(x);
      return `<div class="cartao esp-item ${x.urgencia === 'alta' ? 'urgente' : ''}">
        <div class="esp-item-topo"><a href="#paciente-${esc(x.paciente_id)}"><strong>${esc(x.pacientes?.nome || 'Paciente')}</strong></a>
          <span class="selo ${SELO_SIT[x.situacao]}">${SITUACOES[x.situacao]}${x.situacao === 'ofertado' && x.ofertado_em ? ' ' + new Date(x.ofertado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}</span>
          ${x.urgencia === 'alta' ? '<span class="selo alerta">urgente</span>' : ''}<span class="esp-dias">${diasNaFila(x)} dia(s) na fila</span></div>
        <div>${esc(x.servico)} · ${x.profissional_id ? esc(nomeProf(x.profissional_id) || 'Profissional') : 'qualquer profissional'}</div>
        <div class="muted">Prefere: ${esc(prefs(x))}${x.pacientes?.celular || x.pacientes?.telefone ? ' · ' + esc(foneFmt(x.pacientes.celular || x.pacientes.telefone)) : ''}</div>
        ${x.observacao ? `<div class="esp-obs">${esc(x.observacao)}</div>` : ''}
        ${m ? `<div class="esp-acoes">
          <button class="btn pequeno" data-ed="${esc(x.id)}">Editar</button>
          ${ATIVAS.includes(x.situacao) ? `<button class="btn pequeno" data-ja="${esc(x.id)}">✓ Já agendei</button><button class="btn pequeno" data-sit="desistiu" data-id="${esc(x.id)}">Desistiu</button>` : ''}
          ${x.situacao !== 'aguardando' ? `<button class="btn pequeno" data-sit="aguardando" data-id="${esc(x.id)}">Voltar para aguardando</button>` : ''}
          ${souProf ? '' : `<button class="btn pequeno esp-exc" data-exc="${esc(x.id)}">Excluir</button>`}</div>`
        : '<div class="muted esp-obs-p">Só a recepção altera (espera para qualquer profissional ou de colega).</div>'}</div>`; }).join('')}</div>`
      : '<div class="cartao vazio">Ninguém com esses filtros. Troque a situação para "Todas" para ver o histórico.</div>';
    const doId = (id) => fila.find((x) => x.id === id);
    $$('[data-ed]', $('#esp-fila')).forEach((b) => (b.onclick = () => editar(doId(b.dataset.ed))));
    $$('[data-ja]', $('#esp-fila')).forEach((b) => (b.onclick = () => jaAgendei(doId(b.dataset.ja))));
    $$('[data-sit]', $('#esp-fila')).forEach((b) => (b.onclick = () => mudar(doId(b.dataset.id), { situacao: b.dataset.sit, ...(b.dataset.sit === 'aguardando' ? { ofertado_em: null, atendimento_id: null } : {}) },
      b.dataset.sit === 'desistiu' ? 'Marcado como desistiu.' : 'Voltou para aguardando.')));
    $$('[data-exc]', $('#esp-fila')).forEach((b) => (b.onclick = async () => {
      const x = doId(b.dataset.exc);
      if (!(await confirmar(`Excluir ${x.pacientes?.nome || 'este paciente'} da lista de espera? Para guardar o histórico, prefira "Desistiu".`, 'Excluir'))) return;
      const { error } = await sb.from('lista_espera').delete().eq('id', x.id);
      if (error) return falha(error, 'Excluir'); toast('Excluído da lista.'); render();
    }));
  }
  desenharFila();

  async function mudar(x, campos, msg) {
    if (!x || !podeMexer(x)) return toast('Só a recepção pode alterar esta espera.', true);
    const { data: r, error } = await sb.from('lista_espera').update(campos).eq('id', x.id).select('id');
    if (error) return falha(error, 'Lista de espera');
    if (Array.isArray(r) && !r.length) return toast('Sem permissão para alterar esta espera.', true);
    if (msg) toast(msg); render();
  }

  // "Já agendei": liga ao próximo agendamento do paciente (criado agora) e tira da fila
  async function jaAgendei(x) {
    if (!x) return;
    let q = sb.from('atendimentos').select('id, inicio, profissional_id, servico').eq('paciente_id', x.paciente_id).neq('status', 'cancelado')
      .gte('inicio', new Date().toISOString()).order('inicio').limit(5);
    if (souProf && eu) q = q.eq('profissional_id', eu);
    const { data: ats, error } = await q; if (error) return falha(error, 'Agendamentos');
    const at = (ats || []).find((a) => !x.profissional_id || a.profissional_id === x.profissional_id) || (ats || [])[0];
    if (!at && !(await confirmar(`Não achei agendamento futuro de ${x.pacientes?.nome || 'paciente'}. Marcar como agendado mesmo assim?`, 'Marcar agendado'))) return;
    try { sessionStorage.removeItem('espera_agendando'); } catch { /* */ }
    mudar(x, { situacao: 'agendado', atendimento_id: at?.id || null }, at ? `Agendado ${new Date(at.inicio).toLocaleDateString('pt-BR')} às ${hm(at.inicio)} — saiu da fila.` : 'Marcado como agendado.');
  }
  $('#esp-ja')?.addEventListener('click', () => jaAgendei(indoItem));
  $('#esp-nao')?.addEventListener('click', () => { try { sessionStorage.removeItem('espera_agendando'); } catch { /* */ } render(); });

  // Vagas: WhatsApp e Agendar
  $$('.esp-wpp', c).forEach((b) => (b.onclick = async () => {
    const v = vagas[b.dataset.v], k = v.cand[b.dataset.k], x = k.item;
    const fone = foneWhats(x.pacientes?.celular) || foneWhats(x.pacientes?.telefone);
    if (!fone) return toast('Paciente sem celular com DDD. Atualize o cadastro.', true);
    window.open(`https://wa.me/${fone}?text=${encodeURIComponent(textoOferta(cfg, v, x, nomeProf(v.profissional_id)))}`, '_blank', 'noopener');
    if (!podeMexer(x)) return toast('Mensagem aberta. A recepção marca a oferta (espera para qualquer profissional).');
    mudar(x, { situacao: 'ofertado', ofertado_em: new Date().toISOString() }, 'Mensagem aberta no WhatsApp — marcado como vaga oferecida.');
  }));
  $$('[data-agendar]', c).forEach((b) => (b.onclick = () => {
    const v = vagas[b.dataset.agendar], x = v.cand[b.dataset.k].item;
    const dm = new Date(v.inicio).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    // Mesmo formato que a ficha grava (paciente.js) e a agenda lê; sem plano/senha = particular (convênio se escolhe no modal)
    sessionStorage.setItem('agendar_para', JSON.stringify({ paciente: x.paciente_id, nome: x.pacientes?.nome || '', origem: 'espera', plano: null, aut: '', proc: null, porSessao: false,
      prof: souProf ? eu : v.profissional_id, dia: diaLocal(v.inicio), resumo: `Lista de espera · vaga ${dm} às ${hm(v.inicio)} (${v.servico || 'atendimento'})` }));
    sessionStorage.setItem('espera_agendando', JSON.stringify({ id: x.id }));
    location.hash = 'agenda';
  }));

  // ---------- Modal + Na espera / Editar ----------
  function editar(x) {
    const minhas = souProf ? servicosDe(profs.find((p) => p.id === eu)) : [];
    const servOp = [...new Set([...(souProf && minhas.length ? minhas : SERVICOS), ...(x?.servico ? [x.servico] : [])])];
    const abertos = cfg.dias?.length ? cfg.dias : [1, 2, 3, 4, 5, 6];
    let pacienteId = x?.paciente_id || null, pacNome = x?.pacientes?.nome || '', urg = x?.urgencia || 'normal';
    const diasSel = new Set((x?.dias_semana || []).map(Number));
    const profPadrao = souProf ? eu : x ? x.profissional_id || '' : '';
    modal(`<h3>${x ? 'Editar espera' : 'Colocar na lista de espera'}</h3>
      <form class="grade-form" id="esp-f" onsubmit="return false">
        <label style="grid-column:1/-1">Paciente${x ? `<input value="${esc(pacNome)}" disabled>` : `<input id="esp-busca" placeholder="Nome, CPF ou telefone" autocomplete="off"><div id="esp-sug" class="sugestoes"></div>`}</label>
        <label>Serviço<select name="servico">${servOp.map((s) => `<option ${s === (x?.servico || (souProf ? servOp[0] : '')) ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Profissional<select name="profissional_id" ${souProf ? 'disabled' : ''}>${souProf ? `<option value="${esc(eu)}">${esc(nomeProf(eu) || 'Eu')}</option>`
          : `<option value="">Qualquer profissional</option>${profs.map((p) => `<option value="${esc(p.id)}" ${p.id === profPadrao ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}`}</select></label>
        <div style="grid-column:1/-1"><span class="esp-rot">Dias que prefere <small class="muted">(nenhum = qualquer dia)</small></span>
          <div class="esp-chips">${abertos.map((d) => `<button type="button" class="chip-filtro ${diasSel.has(d) ? 'on' : ''}" data-dia="${d}">${DIAS[d]}</button>`).join('')}</div></div>
        <label>Período<select name="periodo">${Object.entries(PERIODOS).map(([k, v]) => `<option value="${k}" ${k === (x?.periodo || 'qualquer') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <div><span class="esp-rot">Urgência</span><div class="esp-chips">${[['normal', 'Normal'], ['alta', 'Alta']].map(([k, v]) => `<button type="button" class="chip-filtro ${urg === k ? 'on' : ''}" data-urg="${k}">${v}</button>`).join('')}</div></div>
        <label style="grid-column:1/-1">Observação<input name="observacao" value="${esc(x?.observacao || '')}" placeholder="Ex.: só depois das 17h, prefere sala térrea"></label>
      </form>
      <div id="esp-aviso"></div>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="esp-salvar">${x ? 'Salvar' : 'Colocar na espera'}</button></div>`,
    (m, fechar) => {
      const f = $('#esp-f', m);
      const duplicado = () => pacienteId && fila.find((y) => y.id !== x?.id && y.paciente_id === pacienteId && y.servico === f.servico.value && ATIVAS.includes(y.situacao));
      const avisar = () => { const d = duplicado(); $('#esp-aviso', m).innerHTML = d ? `<p class="selo pendente esp-dup">${esc(pacNome)} já está na espera de ${esc(d.servico)} desde ${new Date(d.criado_em).toLocaleDateString('pt-BR')}.</p>` : ''; };
      f.servico.onchange = avisar;
      $$('[data-dia]', m).forEach((b) => (b.onclick = () => { const d = Number(b.dataset.dia); diasSel.has(d) ? diasSel.delete(d) : diasSel.add(d); b.classList.toggle('on'); }));
      $$('[data-urg]', m).forEach((b) => (b.onclick = () => { urg = b.dataset.urg; $$('[data-urg]', m).forEach((y) => y.classList.toggle('on', y === b)); }));
      const busca = $('#esp-busca', m), sug = $('#esp-sug', m); let t;
      if (busca) busca.oninput = () => {
        pacienteId = null; avisar(); clearTimeout(t);
        t = setTimeout(async () => {   // mesma estratégia de pacientes.js: ≥ 2 letras; 4+ dígitos = CPF/telefone
          const q = busca.value.trim(); if (q.length < 2) return (sug.innerHTML = '');
          let cons = sb.from('pacientes').select('id, nome, celular, telefone, alerta').eq('clinica_id', estado.clinica.id).eq('ativo', true).order('nome').limit(8);
          const dig = q.replace(/\D/g, '');
          cons = dig.length >= 4 ? cons.or(`cpf.ilike.%${dig}%,telefone.ilike.%${dig}%,celular.ilike.%${dig}%`) : cons.ilike('nome', `%${q}%`);
          const { data: ps, error } = await cons; if (error) return falha(error, 'Busca');
          sug.innerHTML = (ps || []).map((p) => `<div data-id="${esc(p.id)}">${p.alerta ? '⚠️ ' : ''}${esc(p.nome)} <span class="muted">${esc(p.celular || p.telefone ? foneFmt(p.celular || p.telefone) : '')}</span></div>`).join('')
            || '<div class="muted">Nenhum paciente encontrado — cadastre em Pacientes.</div>';
          $$('[data-id]', sug).forEach((d) => (d.onclick = () => { const p = ps.find((y) => y.id === d.dataset.id); pacienteId = p.id; pacNome = p.nome; busca.value = p.nome; sug.innerHTML = ''; avisar(); }));
        }, 300);
      };
      $('#esp-salvar', m).onclick = async () => {
        // lê tudo antes de qualquer confirmar() (ele troca o conteúdo do modal)
        const reg = { servico: f.servico.value, profissional_id: souProf ? eu : f.profissional_id.value || null,
          dias_semana: diasSel.size ? [...diasSel].sort((a, b) => a - b) : null, periodo: f.periodo.value, urgencia: urg, observacao: f.observacao.value.trim() || null };
        if (!pacienteId) return toast('Escolha o paciente na lista.', true);
        if (souProf && !eu) return toast('Seu acesso não tem profissional vinculado.', true);
        const dup = duplicado();
        if (dup && !(await confirmar(`${pacNome} já está aguardando ${dup.servico}. Colocar de novo na espera?`, 'Colocar mesmo assim'))) return;
        const { error } = x ? await sb.from('lista_espera').update(reg).eq('id', x.id)
          : await sb.from('lista_espera').insert({ ...reg, clinica_id: estado.clinica.id, paciente_id: pacienteId, situacao: 'aguardando' });
        if (error) return falha(error, 'Lista de espera');
        fechar(); toast(x ? 'Espera atualizada.' : `${pacNome} entrou na lista de espera.`); render();
      };
    });
  }
}
