// Módulo Hoje (itens 10 e 21 do backlog): a central do dia de cada perfil — atendimentos de hoje, lembretes de amanhã (wa.me, custo zero),
// pendências, autorizações aguardando senha, evoluções em aberto, avisos e aniversariantes. Cada seção carrega sozinha (uma falha não derruba a tela).
import { sb, estado, $, $$, esc, data, tela, toast, falha, podeGerir } from '../core.js';
import { foneWhats } from './agenda.js';

const STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', presente: 'Presente', atendido: 'Atendido', faltou: 'Faltou', cancelado: 'Cancelado' };
const hojeIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const inicioDia = (dia) => new Date(dia + 'T00:00').toISOString();
const hm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const primeiro = (n) => ((n || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const linkSeguro = (l) => (/^[\w:.-]+$/.test(String(l || '')) ? String(l) : '');
const LINHA_VAZIA = (txt, dica = '') => `<p class="hj-vazio">${txt}${dica ? ` <span class="muted">· ${dica}</span>` : ''}</p>`;

// ---------- Lembrete: réplica fiel de textoLembrete/linkWhats da agenda.js (lá não são exportadas) ----------
const LEMBRETE_PADRAO = 'Olá, {nome}! Aqui é da Clínica Cure. Lembrete do seu atendimento de {servico} com {profissional} {dia} às {hora}. '
  + 'Pode confirmar sua presença? Se precisar remarcar, é só responder esta mensagem.';
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

// ---------- Parabéns: réplica do texto de relacionamento.js (mesmo rodapé "responda SAIR") ----------
function textoParabens(cfg, it) {
  return `${(cfg.texto_aniversario || '').replace(/\{nome\}/g, primeiro(it.nome)).replace(/\{item\}/g, '').replace(/\{tempo\}/g, '')}\n\n${cfg.rodape_sair || 'Se não quiser mais receber, responda SAIR.'}`;
}

// ---------- Selo de sessão (mesmas cores da agenda: cinza · laranja acabando · vermelho última/vencida) ----------
function nivelSessao(x) {
  const vence = x.validade ? Math.round((new Date(x.validade + 'T12:00') - new Date(hojeIso() + 'T12:00')) / 864e5) : null;
  if ((x.total && x.n >= x.total) || (vence !== null && vence < 0)) return 'fim';
  if ((x.total && x.total - x.n <= 2) || (vence !== null && vence <= 7)) return 'acabando';
  return 'ok';
}
const seloSessao = (x) => (!x || !x.n ? '' : ` <em class="ses ses-${nivelSessao(x)}" title="${x.base === 'encaminhamento' ? 'Sessão do encaminhamento (1 senha por sessão)' : 'Sessão da senha'}">S ${x.n}${x.total ? '/' + x.total : ''}</em>`);

function saudacao() { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }

function secao(id, titulo, extra = '') {
  return `<section class="cartao hj-sec" id="${id}"><h3><span>${titulo}</span><span class="hj-cont"></span>${extra ? `<span class="hj-link">${extra}</span>` : ''}</h3>
    <div class="hj-corpo"><p class="hj-vazio muted">Carregando…</p></div></section>`;
}
// Cada seção roda isolada: erro vira uma linha discreta na própria seção
async function rodar(el, fn) {
  if (!el) return;
  try { await fn($('.hj-corpo', el), (n, alerta) => { const c = $('.hj-cont', el); c.innerHTML = n ? `<span class="selo ${alerta ? 'alerta' : 'outra'}">${esc(n)}</span>` : ''; }); }
  catch (e) { console.warn('Hoje:', e); $('.hj-corpo', el).innerHTML = LINHA_VAZIA('Não foi possível carregar esta parte.', 'tente Atualizar'); }
}
const ok = ({ data: d, error }) => { if (error) throw error; return d; };

export async function render() {
  const c = tela('Hoje', '<button class="btn" id="hj-atualizar">↻ Atualizar</button>');
  const souProf = estado.perfil === 'profissional', gestao = podeGerir(), cid = estado.clinica.id, eu = estado.profissionalId;
  const [cfgR, profsR] = await Promise.all([
    estado.clinica.config ? { data: { config: estado.clinica.config } } : sb.from('clinicas').select('config').eq('id', cid).single(),
    sb.from('profissionais').select('id, nome').eq('clinica_id', cid)]);
  const cfg = cfgR.data?.config || {}; estado.clinica.config ||= cfgR.data?.config;
  const profs = profsR.data || [];
  const nomeProf = (pid) => profs.find((p) => p.id === pid)?.nome || '';
  const meuNome = eu ? nomeProf(eu) : '';
  const dataExt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const lado = [
    souProf ? '' : secao('hj-lemb', '📲 Lembretes para enviar'),
    eu ? secao('hj-evol', '📝 Evoluções em aberto') : '',
    secao('hj-aut', '⏳ Autorizações aguardando senha', '<a href="#agenda">resolver na agenda →</a>'),
    gestao ? secao('hj-pend', 'Pendências', '<a href="#painel">ver todas no Painel →</a>') : '',
    eu ? secao('hj-avisos', '🔔 Avisos') : '',
    souProf ? '' : secao('hj-aniv', '🎂 Aniversariantes de hoje'),
  ].join('');
  c.innerHTML = `<div class="hj">
    <div class="hj-cab"><div><div class="hj-ola">${saudacao()}${meuNome ? ', ' + esc(primeiro(meuNome)) : ''}!</div>
      <div class="hj-data">${esc(dataExt.replace(/^./, (x) => x.toUpperCase()))}${souProf ? ' · sua agenda' : ' · clínica'}</div></div></div>
    <div class="kpis hj-kpis" id="hj-kpis">${['Agendados hoje', 'Confirmados', 'Já atendidos', 'Faltas'].map((r) => `<div class="kpi"><div class="rotulo">${r}</div><div class="valor">–</div></div>`).join('')}</div>
    <div class="hj-grade"><div class="hj-principal">${secao('hj-ats', 'Atendimentos de hoje', '<a href="#agenda">abrir na agenda →</a>')}</div>
      <div class="hj-lado">${lado}</div></div></div>`;
  $('#hj-atualizar').onclick = () => render();

  const sec = (id) => $('#' + id, c);
  const tarefas = [rodar(sec('hj-ats'), (corpo, cont) => atendimentosHoje(corpo, cont))];
  if (!souProf) tarefas.push(rodar(sec('hj-lemb'), lembretes), rodar(sec('hj-aniv'), aniversarios));
  if (eu) tarefas.push(rodar(sec('hj-evol'), evolucoes), rodar(sec('hj-avisos'), avisos));
  if (gestao) tarefas.push(rodar(sec('hj-pend'), pendencias));
  tarefas.push(rodar(sec('hj-aut'), autorizacoes));
  await Promise.all(tarefas);

  // ---------------- Atendimentos de hoje + KPIs ----------------
  async function atendimentosHoje(corpo, cont) {
    const hoje = hojeIso();
    let q = sb.from('atendimentos').select('id, inicio, fim, status, servico, sala, profissional_id, paciente_id, paciente_plano_id, autorizacao_id, lembrete_enviado_em, pacientes(nome, telefone, celular)')
      .eq('clinica_id', cid).gte('inicio', inicioDia(hoje)).lt('inicio', inicioDia(somaDias(hoje, 1))).order('inicio');
    if (souProf) q = q.eq('profissional_id', eu);   // sócio no modo profissional tem RLS de gestão: filtra aqui também
    const todos = ok(await q).filter((a) => !souProf || a.profissional_id === eu);
    const ats = todos.filter((a) => a.status !== 'cancelado');
    const ids = ats.filter((a) => a.autorizacao_id).map((a) => a.id), num = {};
    if (ids.length) { const r = await sb.rpc('numeracao_sessoes', { p_atendimentos: ids }); (r.data || []).forEach((x) => (num[x.atendimento_id] = x)); }

    const n = (st) => ats.filter((a) => a.status === st).length, agora = Date.now();
    const prox = ats.find((a) => ['agendado', 'confirmado', 'presente'].includes(a.status) && +new Date(a.fim) > agora);
    $('#hj-kpis', c).innerHTML = `
      <div class="kpi"><div class="rotulo">Agendados hoje</div><div class="valor">${ats.length}</div><div class="sub">${prox ? `próximo às ${hm(prox.inicio)}` : ats.length ? 'nenhum a seguir' : '&nbsp;'}</div></div>
      <div class="kpi"><div class="rotulo">Confirmados</div><div class="valor">${n('confirmado')}</div><div class="sub">${n('presente') ? `${n('presente')} na clínica agora` : '&nbsp;'}</div></div>
      <div class="kpi"><div class="rotulo">Já atendidos</div><div class="valor">${n('atendido')}</div><div class="sub">&nbsp;</div></div>
      <div class="kpi ${n('faltou') ? 'alerta' : ''}"><div class="rotulo">Faltas</div><div class="valor">${n('faltou')}</div><div class="sub">&nbsp;</div></div>`;
    cont(ats.length);
    if (!ats.length) { corpo.innerHTML = LINHA_VAZIA(souProf ? 'Sua agenda de hoje está livre.' : 'Nenhum atendimento marcado para hoje.', 'os horários do dia aparecem aqui em ordem'); return; }

    corpo.innerHTML = `<ol class="hj-linha-tempo">${ats.map((a) => {
      const meu = !!eu && a.profissional_id === eu, aberto = !['atendido', 'cancelado', 'faltou'].includes(a.status);
      const wpp = !souProf && ['agendado', 'confirmado'].includes(a.status) ? linkWhats(cfg, a, nomeProf(a.profissional_id)) : null;
      const passou = !aberto || +new Date(a.fim) < agora;
      return `<li class="hj-at st-${a.status}${a === prox ? ' hj-prox' : ''}${passou && a !== prox ? ' hj-passou' : ''}" data-id="${a.id}">
        <div class="hj-hora">${hm(a.inicio)}${a === prox ? '<small>próximo</small>' : ''}</div>
        <div class="hj-info"><div class="hj-nome"><a href="#paciente-${a.paciente_id}">${esc(a.pacientes?.nome || 'Paciente')}</a>${seloSessao(num[a.id])}</div>
          <div class="hj-det muted">${esc(a.servico || '—')}${souProf ? '' : ' · ' + esc(nomeProf(a.profissional_id))}${a.sala ? ' · ' + esc(a.sala) : ''}</div></div>
        <div class="hj-st"><span class="ag-st st-${a.status}">${STATUS[a.status] || esc(a.status)}</span></div>
        <div class="hj-acoes">
          ${meu && aberto ? '<button class="btn pequeno primario" data-ini>▶ Iniciar atendimento</button>' : ''}
          ${meu && a.status === 'atendido' ? `<a class="btn pequeno" href="#paciente-${a.paciente_id}-prontuario:${a.id}">Evoluir</a>` : ''}
          ${!souProf && aberto ? ['confirmado', 'presente', 'faltou'].filter((k) => k !== a.status).map((k) => `<button class="btn pequeno" data-st="${k}">${k === 'presente' ? 'Chegou' : STATUS[k]}</button>`).join('') : ''}
          ${!souProf && a.status === 'presente' ? '<a class="btn pequeno" href="#agenda" title="Marcar Atendido (fecha a guia) na agenda">✓ Atendido na agenda</a>' : ''}
          ${wpp ? `<a class="btn pequeno" target="_blank" rel="noopener" href="${esc(wpp)}" data-wpp title="WhatsApp com o lembrete">📲</a>` : ''}
        </div></li>`; }).join('')}</ol>`;

    const recarregar = () => rodar(sec('hj-ats'), atendimentosHoje);
    $$('.hj-at', corpo).forEach((li) => {
      const a = ats.find((x) => x.id === li.dataset.id);
      $$('[data-st]', li).forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        const { error: e } = await sb.from('atendimentos').update({ status: b.dataset.st, atualizado_em: new Date().toISOString() }).eq('id', a.id);
        if (e) { b.disabled = false; return falha(e); }
        toast(`Status: ${STATUS[b.dataset.st]}.`); recarregar();
      }));
      $('[data-ini]', li)?.addEventListener('click', async () => {
        if (['agendado', 'confirmado'].includes(a.status)) {
          const { error: e } = await sb.from('atendimentos').update({ status: 'presente', atualizado_em: new Date().toISOString() }).eq('id', a.id);
          if (e) return falha(e);
        }
        location.hash = `#paciente-${a.paciente_id}-prontuario:${a.id}`;
      });
      $('[data-wpp]', li)?.addEventListener('click', async () => {
        await sb.from('atendimentos').update({ lembrete_enviado_em: new Date().toISOString() }).eq('id', a.id);
      });
    });
  }

  // ---------------- Lembretes para enviar (item 21) ----------------
  async function lembretes(corpo, cont) {
    const amanha = somaDias(hojeIso(), 1), aberto = (d) => (cfg.dias || [1, 2, 3, 4, 5, 6]).includes(new Date(d + 'T12:00').getDay());
    const lista = ok(await sb.from('atendimentos').select('id, inicio, fim, status, servico, sala, profissional_id, paciente_id, lembrete_enviado_em, pacientes(nome, telefone, celular)')
      .eq('clinica_id', cid).gte('inicio', inicioDia(amanha)).lt('inicio', inicioDia(somaDias(amanha, 3))).in('status', ['agendado', 'confirmado']).order('inicio'));
    // Amanhã com expediente → amanhã; senão o próximo dia (até 3 à frente) que tenha atendimentos
    const diaDe = (a) => new Date(a.inicio).toLocaleDateString('sv');
    const dia = aberto(amanha) ? amanha : (lista[0] ? diaDe(lista[0]) : amanha);
    const doDia = lista.filter((a) => diaDe(a) === dia), agendados = doDia.filter((a) => a.status === 'agendado');
    const pend = agendados.filter((a) => !a.lembrete_enviado_em), env = agendados.length - pend.length;
    const rotDia = dia === amanha ? 'amanhã' : new Date(dia + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
    cont(pend.length, false);
    const resumo = agendados.length ? `<p class="hj-resumo muted">${rotDia.replace(/^./, (x) => x.toUpperCase())} · <strong>${env} de ${agendados.length}</strong> enviados${doDia.length > agendados.length ? ` · ${doDia.length - agendados.length} já confirmado(s)` : ''}</p>` : '';
    if (!pend.length) { corpo.innerHTML = resumo + LINHA_VAZIA('Nenhum lembrete pendente ✓', doDia.length ? '' : aberto(amanha) ? 'nenhum atendimento agendado para amanhã' : 'nenhum atendimento nos próximos 3 dias'); return; }
    corpo.innerHTML = `${resumo}<ul class="hj-lista">${pend.map((a) => { const l = linkWhats(cfg, a, nomeProf(a.profissional_id));
      return `<li><span class="hj-hora-p">${hm(a.inicio)}</span><span class="hj-txt"><a href="#paciente-${a.paciente_id}">${esc(a.pacientes?.nome || 'Paciente')}</a>
        <small class="muted">${esc(primeiro(nomeProf(a.profissional_id)))}${a.servico ? ' · ' + esc(a.servico) : ''}</small></span>
        ${l ? `<a class="btn pequeno primario" target="_blank" rel="noopener" href="${esc(l)}" data-env="${a.id}">WhatsApp</a>` : '<span class="selo pendente" title="Cadastre um celular com DDD na ficha">sem WhatsApp</span>'}</li>`; }).join('')}</ul>`;
    $$('[data-env]', corpo).forEach((b) => b.addEventListener('click', async () => {
      const { error: e } = await sb.from('atendimentos').update({ lembrete_enviado_em: new Date().toISOString() }).eq('id', b.dataset.env);
      if (e) return falha(e, 'Lembrete');
      setTimeout(() => rodar(sec('hj-lemb'), lembretes), 800);
    }));
  }

  // ---------------- Pendências (gestão) ----------------
  async function pendencias(corpo, cont) {
    const ordem = { alta: 0, media: 1, baixa: 2 }, rot = { alta: ['alerta', 'Alta'], media: ['pendente', 'Média'], baixa: ['outra', 'Baixa'] };
    const ps = (ok(await sb.rpc('pendencias', { p_clinica: cid })) || []).sort((a, b) => (ordem[a.gravidade] ?? 3) - (ordem[b.gravidade] ?? 3));
    cont(ps.length, ps.some((x) => x.gravidade === 'alta'));
    if (!ps.length) { corpo.innerHTML = LINHA_VAZIA('Nenhuma pendência ✓'); return; }
    corpo.innerHTML = `<ul class="hj-lista">${ps.slice(0, 8).map((x) => { const r = rot[x.gravidade] || rot.baixa, l = linkSeguro(x.link);
      return `<li class="${l ? 'clicavel' : ''}" ${l ? `data-link="${esc(l)}"` : ''}><span class="selo ${r[0]}">${r[1]}</span>
        <span class="hj-txt">${esc(x.descricao)}<small class="muted">${esc(x.area)}</small></span>${l ? '<span class="muted">›</span>' : ''}</li>`; }).join('')}</ul>
      ${ps.length > 8 ? `<p class="hj-resumo"><a href="#painel">+ ${ps.length - 8} no Painel →</a></p>` : ''}`;
    $$('[data-link]', corpo).forEach((li) => (li.onclick = () => (location.hash = li.dataset.link)));
  }

  // ---------------- Autorizações aguardando senha ----------------
  async function autorizacoes(corpo, cont) {
    let ps = ok(await sb.rpc('autorizacoes_pendentes', { p_clinica: cid })) || [];
    // A função não devolve o paciente_id: busca na tabela (RLS) para montar o link da ficha
    const info = {};
    if (ps.length) {
      const { data: aus } = await sb.from('autorizacoes').select('id, profissional_id, paciente_planos(paciente_id)').in('id', ps.map((x) => x.autorizacao_id));
      (aus || []).forEach((x) => (info[x.id] = x));
    }
    // Sócio no modo profissional: o banco devolve tudo (perfil real é gestão) → mesmo critério da função para profissional
    if (souProf && estado.perfilReal !== 'profissional')
      ps = ps.filter((x) => info[x.autorizacao_id]?.profissional_id === eu || (meuNome && String(x.profissionais || '').split(', ').includes(meuNome)));
    cont(ps.length, ps.some((x) => Number(x.atendidos) > 0));
    if (!ps.length) { corpo.innerHTML = LINHA_VAZIA('Nenhuma autorização aguardando senha ✓'); return; }
    corpo.innerHTML = `<ul class="hj-lista">${ps.slice(0, 6).map((x) => { const pid = info[x.autorizacao_id]?.paciente_planos?.paciente_id;
      return `<li><span class="hj-txt">${pid ? `<a href="#paciente-${esc(pid)}-autorizacoes">${esc(x.paciente)}</a>` : `<strong>${esc(x.paciente)}</strong>`}
        <small class="muted">${esc(x.contrato)} · ${esc(x.procedimento)}</small>
        <small class="${Number(x.atendidos) ? 'hj-alerta' : 'muted'}">${Number(x.atendidos) ? `${x.atendidos} sessão(ões) já feita(s) sem senha · ` : ''}${x.primeira_data ? `1ª sessão ${data(x.primeira_data)} · ` : ''}pedida há ${Number(x.dias) || 0} dia(s)</small></span></li>`; }).join('')}</ul>
      ${ps.length > 6 ? `<p class="hj-resumo"><a href="#agenda">+ ${ps.length - 6} na agenda →</a></p>` : ''}`;
  }

  // ---------------- Evoluções em aberto (mesmo critério do prontuário: atendimento meu sem registro ligado) ----------------
  async function evolucoes(corpo, cont) {
    const de = inicioDia(somaDias(hojeIso(), -14));
    const ats = ok(await sb.from('atendimentos').select('id, inicio, servico, paciente_id, profissional_id, pacientes(nome)')
      .eq('clinica_id', cid).eq('profissional_id', eu).eq('status', 'atendido').gte('inicio', de).order('inicio', { ascending: false }))
      .filter((a) => a.profissional_id === eu);
    let semReg = ats;
    if (ats.length) {
      const regs = ok(await sb.from('prontuario_registros').select('atendimento_id').in('atendimento_id', ats.map((a) => a.id)));
      const com = new Set((regs || []).map((r) => r.atendimento_id));
      semReg = ats.filter((a) => !com.has(a.id));
    }
    cont(semReg.length, semReg.length > 0);
    if (!semReg.length) { corpo.innerHTML = LINHA_VAZIA('Todas as evoluções em dia ✓', 'últimos 14 dias'); return; }
    corpo.innerHTML = `<ul class="hj-lista">${semReg.slice(0, 8).map((a) => `<li><span class="hj-hora-p">${new Date(a.inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
      <span class="hj-txt">${esc(a.pacientes?.nome || 'Paciente')}<small class="muted">${esc(a.servico || '')} · ${hm(a.inicio)}</small></span>
      <a class="btn pequeno" href="#paciente-${a.paciente_id}-prontuario:${a.id}">Evoluir</a></li>`).join('')}</ul>
      ${semReg.length > 8 ? `<p class="hj-resumo muted">+ ${semReg.length - 8} mais antigas · <a href="#prontuarios">Meus prontuários →</a></p>` : ''}`;
  }

  // ---------------- Avisos (notificacoes do profissional vinculado) ----------------
  async function avisos(corpo, cont) {
    const ns = ok(await sb.from('notificacoes').select('id, tipo, mensagem, lida, criado_em, profissional_id')
      .eq('clinica_id', cid).eq('profissional_id', eu).eq('lida', false).order('criado_em', { ascending: false }).limit(20));
    cont(ns.length, false);
    if (!ns.length) { corpo.innerHTML = LINHA_VAZIA('Nenhum aviso novo ✓'); return; }
    corpo.innerHTML = `<ul class="hj-lista">${ns.map((x) => `<li data-n="${x.id}"><span class="hj-txt">${esc(x.mensagem)}
      <small class="muted">${new Date(x.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></span>
      <button class="btn pequeno" data-lida title="Marcar como lida">✓ Lida</button></li>`).join('')}</ul>`;
    $$('[data-lida]', corpo).forEach((b) => (b.onclick = async () => {
      const li = b.closest('li'); b.disabled = true;
      const { error: e } = await sb.from('notificacoes').update({ lida: true }).eq('id', li.dataset.n);
      if (e) { b.disabled = false; return falha(e, 'Aviso'); }
      li.remove(); const resta = $$('li', corpo).length; cont(resta, false);
      if (!resta) corpo.innerHTML = LINHA_VAZIA('Nenhum aviso novo ✓');
    }));
  }

  // ---------------- Aniversariantes de hoje (relacionamento: só quem não pediu para sair) ----------------
  async function aniversarios(corpo, cont) {
    const sec0 = sec('hj-aniv');
    const { data: r, error } = await sb.rpc('relacionamento', { p_clinica: cid, p_dias: 0 });
    if (error || !r || !Array.isArray(r.itens)) { sec0?.remove(); return; }   // sem permissão para o perfil: a seção some
    const rc = r.config || {}, hoje = hojeIso();
    const lista = r.itens.filter((i) => i.tipo === 'aniversario' && String(i.quando).slice(0, 10) === hoje);
    const enviados = JSON.parse(sessionStorage.getItem('rel-enviados') || '{}');   // mesma marcação da tela de Relacionamento
    cont(lista.length, false);
    if (!lista.length) { corpo.innerHTML = LINHA_VAZIA('Nenhum aniversariante hoje.'); return; }
    corpo.innerHTML = `<ul class="hj-lista">${lista.map((it) => { const f = foneWhats(it.telefone), chave = `${it.tipo}|${it.paciente_id}|${it.quando}`;
      return `<li><span class="hj-txt"><a href="#paciente-${esc(it.paciente_id)}">${esc(it.nome)}</a><small class="muted">${it.idade ? `${esc(it.idade)} anos` : ''}</small></span>
        ${f ? `<a class="btn pequeno ${enviados[chave] ? '' : 'primario'}" target="_blank" rel="noopener" data-env="${esc(chave)}" href="https://wa.me/${f}?text=${encodeURIComponent(textoParabens(rc, it))}">${enviados[chave] ? '✓ enviado' : 'Parabéns'}</a>`
          : '<span class="selo pendente">sem WhatsApp</span>'}</li>`; }).join('')}</ul>`;
    $$('[data-env]', corpo).forEach((a) => a.addEventListener('click', () => {
      enviados[a.dataset.env] = 1; sessionStorage.setItem('rel-enviados', JSON.stringify(enviados));
      a.classList.remove('primario'); a.textContent = '✓ enviado';
    }));
  }
}
