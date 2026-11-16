// Ficha do paciente como linha do tempo (backlog 14): atendimentos, autorizações, encaminhamentos, documentos,
// registros de prontuário (SÓ tipo e data, nunca o texto) e, para a gestão, pagamentos e guias — numa sequência só.
// Uso: renderLinhaTempo(elemento, pacienteId). As funções puras (montarEventos, resumir, agrupar…) não dependem do navegador
// nem do core.js (que importa a biblioteca do Supabase pela rede): por isso o core só é carregado dentro de renderLinhaTempo
// e dá para testar tudo em node.

const FUSO = 'America/Sao_Paulo';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const PASSO = 50;

// Mesmo escape do core (cópia para o módulo continuar testável em node)
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- vocabulário (igual ao da ficha, paciente.js)
export const TIPOS = {
  atendimento: { nome: 'Atendimentos', icone: '🗓' },
  autorizacao: { nome: 'Autorizações', icone: '🔑' },
  encaminhamento: { nome: 'Encaminhamentos', icone: '📋' },
  documento: { nome: 'Documentos', icone: '📄' },
  prontuario: { nome: 'Prontuário', icone: '🩺' },
  financeiro: { nome: 'Financeiro', icone: '💲' },
};
const AREAS = { fisioterapia: 'Fisioterapia', nutricao: 'Nutrição', psicologia: 'Psicologia', palmilha: 'Palmilha / podologia', medicina: 'Medicina', outra: 'Outra' };
const ST_AT = { agendado: ['agendado', 'pendente'], confirmado: ['confirmado', 'pendente'], presente: ['presente', 'pendente'],
  atendido: ['realizado', 'ok'], faltou: ['faltou', 'alerta'], cancelado: ['cancelado', 'outra'] };
const ABERTOS = ['agendado', 'confirmado', 'presente'];
const FIN = { rascunho: ['a faturar', 'pendente'], pronta: ['a faturar', 'pendente'], enviada: ['faturado', 'clinica'], paga: ['pago', 'ok'],
  glosa_parcial: ['glosa parcial', 'alerta'], glosa_total: ['glosado', 'alerta'], cancelada: ['guia cancelada', 'outra'] };
const FORMAS = { pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito à vista', credito_parcelado: 'Crédito parcelado', transferencia: 'Transferência', outro: 'Outro' };
const MODELOS = { soapn: 'Evolução SOAPN', fisio_avaliacao: 'Avaliação fisioterapêutica', fisio_esportiva: 'Avaliação de fisioterapia esportiva',
  fisio_podo: 'Avaliação podoposturológica', fisio_postural: 'Avaliação postural por foto', fisio_palmilha3d: 'Projeto de palmilha 3D',
  dinamometria: 'Avaliação por dinamometria', fisio_evolucao: 'Evolução de sessão (fisioterapia)', psico_registro: 'Registro documental (psicologia)',
  medica_consulta: 'Consulta médica', livre: 'Registro livre' };
const AVALIACOES = new Set(['dinamometria', 'fisio_postural', 'fisio_podo', 'fisio_palmilha3d']);   // ficam na aba Avaliações da ficha
const ABA = { atendimento: 'autorizacoes', autorizacao: 'autorizacoes', encaminhamento: 'cadastro', documento: 'documentos', prontuario: 'prontuario', financeiro: 'autorizacoes' };

// ---------------------------------------------------------------- datas (dia local = Brasília; colunas date são texto AAAA-MM-DD)
const doisD = (n) => String(n).padStart(2, '0');
// timestamptz → 'AAAA-MM-DD HH:MM' no fuso de Brasília, qualquer que seja o fuso de quem roda
export function emBrasilia(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export const fmtData = (dia) => (dia && /^\d{4}-\d{2}-\d{2}/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : '—');
const fmtCurta = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const diaSemana = (dia) => DIAS_SEM[new Date(dia + 'T12:00:00Z').getUTCDay()];
const rotuloMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Coluna date ('AAAA-MM-DD') ou timestamptz → { dia, hora|null, chave }; chave ordena (sem hora = 00:00 do dia)
function quando(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { dia: s, hora: null, chave: `${s} 00:00` };
  const l = emBrasilia(s);
  return l ? { dia: l.slice(0, 10), hora: l.slice(11, 16), chave: l } : null;
}

// ---------------------------------------------------------------- eventos
const ev = (tipo, id, q, o) => ({ tipo, id: `${tipo}:${id}`, dia: q.dia, hora: q.hora, chave: q.chave, icone: TIPOS[tipo].icone, status: null, futuro: false, aba: ABA[tipo], ...o });

// Cada fonte pode vir null (consulta negada/falhou) ou [] — a fonte ausente simplesmente fica de fora.
// agora = 'AAAA-MM-DD HH:MM' em Brasília (padrão: agora de verdade).
export function montarEventos(fontes = {}, { agora = emBrasilia(new Date()) } = {}) {
  const hoje = agora.slice(0, 10), todos = [];
  const push = (e) => { if (e) todos.push(e); };

  (fontes.atendimentos || []).forEach((a) => {
    const q = quando(a.inicio); if (!q) return;
    const futuro = ABERTOS.includes(a.status) && q.chave >= agora;
    let [texto, cls] = ST_AT[a.status] || [a.status || '—', 'outra'];
    if (!futuro && ABERTOS.includes(a.status)) [texto, cls] = ['sem baixa', 'pendente'];   // horário passou e ninguém marcou atendido/faltou
    push(ev('atendimento', a.id, q, { titulo: a.servico || 'Atendimento', status: a.status, futuro, aba: futuro ? null : ABA.atendimento, href: futuro ? '#agenda' : null,
      detalhe: [a.profissionais?.nome, a.sala].filter(Boolean).join(' · '), selo: { texto, cls } }));
  });

  (fontes.autorizacoes || []).forEach((a) => {
    const autorizada = a.status === 'autorizada' && a.data_autorizacao;
    const q = quando(autorizada ? a.data_autorizacao : a.solicitada_em) || quando(a.data_autorizacao); if (!q) return;
    let selo;
    if (['negada', 'cancelada'].includes(a.status)) selo = { texto: a.status === 'negada' ? 'negada' : 'cancelada', cls: 'outra' };
    else if (a.status === 'pendente' || (!a.senha && !/particular/i.test(a.paciente_planos?.contratos?.nome || ''))) selo = { texto: 'senha pendente', cls: 'pendente' };
    else if (a.validade && a.validade < hoje) selo = { texto: 'vencida', cls: 'alerta' };
    else selo = { texto: 'autorizada', cls: 'ok' };
    push(ev('autorizacao', a.id, q, { titulo: selo.texto === 'autorizada' || selo.texto === 'vencida' ? 'Autorização com senha' : 'Autorização solicitada',
      detalhe: [a.paciente_planos?.contratos?.nome, a.senha ? `senha ${a.senha}` : null, a.validade ? `validade ${fmtData(a.validade)}` : null,
        a.qtd_autorizada ? `${a.qtd_autorizada} sessões` : null].filter(Boolean).join(' · '), selo }));
  });

  (fontes.encaminhamentos || []).forEach((e) => {
    const q = quando(e.data_pedido); if (!q) return;
    const selo = e.status === 'cancelado' ? { texto: 'cancelado', cls: 'outra' } : e.validade && e.validade < hoje ? { texto: 'vencido', cls: 'alerta' } : { texto: 'ativo', cls: 'ok' };
    push(ev('encaminhamento', e.id, q, { titulo: `Encaminhamento · ${AREAS[e.area] || e.area || 'área não informada'}`,
      detalhe: [e.cid ? `CID ${e.cid}` : null, e.validade ? `validade ${fmtData(e.validade)}` : null, e.solicitantes?.nome].filter(Boolean).join(' · '), selo }));
  });

  (fontes.documentos || []).forEach((d) => {
    const q = quando(d.emitido_em); if (!q) return;
    push(ev('documento', d.id, q, { titulo: d.titulo || 'Documento', detalhe: [d.profissionais?.nome || 'Recepção', d.codigo ? `código ${d.codigo}` : null].filter(Boolean).join(' · '),
      selo: { texto: 'emitido', cls: 'outra' } }));
  });

  // Prontuário: só o tipo/modelo e a data. O texto clínico nunca entra aqui (nem é pedido ao banco).
  (fontes.prontuario || []).forEach((r) => {
    const q = quando(r.data_registro); if (!q) return;
    push(ev('prontuario', r.id, q, { titulo: MODELOS[r.modelo] || String(r.modelo || 'Registro').replace(/_/g, ' '), detalhe: 'Registro seu — abra o prontuário para ler',
      aba: AVALIACOES.has(r.modelo) ? 'avaliacoes' : 'prontuario', selo: { texto: AREAS[r.area] || 'registro', cls: 'outra' } }));
  });

  (fontes.recebimentos || []).forEach((r) => {
    const q = quando(r.pago_em); if (!q) return;
    push(ev('financeiro', 'rec-' + r.id, q, { titulo: 'Pagamento particular', icone: '💲',
      detalhe: [FORMAS[r.forma] || r.forma, r.parcelas > 1 ? `${r.parcelas}x` : null, r.valor_pago != null ? reais(r.valor_pago) : null].filter(Boolean).join(' · '),
      selo: r.nf_numero ? { texto: `NF ${r.nf_numero}`, cls: 'clinica' } : { texto: 'NF pendente', cls: 'alerta' } }));
  });

  (fontes.guias || []).forEach((g) => {
    const q = quando(g.data_atendimento); if (!q) return;
    const f = g.segurada ? ['segurada', 'outra'] : FIN[g.status] || [g.status || '—', 'outra'];
    push(ev('financeiro', 'guia-' + g.id, q, { titulo: `Guia ${g.numero_guia_prestador || ''}`.trim(), icone: '🧾',
      detalhe: [g.contratos?.nome, `atendimento de ${fmtData(g.data_atendimento)}`].filter(Boolean).join(' · '), selo: { texto: f[0], cls: f[1] } }));
  });

  const proximos = todos.filter((e) => e.futuro).sort((a, b) => a.chave.localeCompare(b.chave));
  const passados = todos.filter((e) => !e.futuro).sort((a, b) => b.chave.localeCompare(a.chave) || a.id.localeCompare(b.id));
  return { proximos, passados, todos: [...proximos, ...passados] };
}
const reais = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Resumo do topo (conta só o que a pessoa enxerga pela RLS)
export function resumir({ proximos = [], passados = [] } = {}) {
  const ats = [...proximos, ...passados].filter((e) => e.tipo === 'atendimento');
  const vivos = ats.filter((e) => e.status !== 'cancelado');
  const realizados = ats.filter((e) => e.status === 'atendido');
  const todos = [...proximos, ...passados];
  const menor = (l) => l.reduce((m, e) => (!m || e.chave < m.chave ? e : m), null);
  const primeira = menor(vivos) || menor(todos);
  const ultimo = realizados.reduce((m, e) => (!m || e.chave > m.chave ? e : m), null);
  const prox = proximos.find((e) => e.tipo === 'atendimento') || null;
  return { primeira: primeira?.dia || null, realizados: realizados.length, faltas: ats.filter((e) => e.status === 'faltou').length,
    ultimo: ultimo ? { dia: ultimo.dia, hora: ultimo.hora } : null, proximo: prox ? { dia: prox.dia, hora: prox.hora } : null };
}

// Filtro: tipos = lista (vazia = todos) e busca = texto livre sem acento
export function filtrar(eventos, { tipos = [], busca = '' } = {}) {
  const t = new Set(tipos), b = semAcento(busca).trim();
  return eventos.filter((e) => (!t.size || t.has(e.tipo)) && (!b || semAcento([e.titulo, e.detalhe, e.selo?.texto, TIPOS[e.tipo].nome].join(' ')).includes(b)));
}
export const contar = (eventos) => Object.fromEntries(Object.keys(TIPOS).map((k) => [k, eventos.filter((e) => e.tipo === k).length]));
// Agrupa (lista já em ordem) por mês/ano: [{ mes: '2026-11', rotulo: 'Novembro de 2026', eventos: [...] }]
export function agrupar(eventos) {
  const g = [];
  eventos.forEach((e) => { const m = e.dia.slice(0, 7); if (!g.length || g[g.length - 1].mes !== m) g.push({ mes: m, rotulo: maiuscula(rotuloMes(m)), eventos: [] }); g[g.length - 1].eventos.push(e); });
  return g;
}

// ---------------------------------------------------------------- tela
const chaveFiltro = (id) => `linha_tempo_${id}`;
function lerFiltro(id) {
  try { const f = JSON.parse(sessionStorage.getItem(chaveFiltro(id)) || '{}');
    return { tipos: (f.tipos || []).filter((k) => TIPOS[k]), busca: String(f.busca || '') }; } catch { return { tipos: [], busca: '' }; }
}
const guardarFiltro = (id, f) => { try { sessionStorage.setItem(chaveFiltro(id), JSON.stringify(f)); } catch {} };
const seguro = async (p) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };   // fonte que falha fica de fora, sem erro na tela

function garantirCss() {
  if (document.querySelector('link[href$="linha-tempo.css"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/linha-tempo.css'; document.head.appendChild(l);
}

const hrefDe = (e, pid) => e.href || `#paciente-${pid}-${e.aba}`;
function htmlEvento(e, pid, completo) {
  const dia = completo ? `<span class="lt-dia">${esc(diaSemana(e.dia))} ${esc(fmtCurta(e.dia))}</span>` : `<span class="lt-dia">${esc(e.dia.slice(8, 10))}</span>`;
  return `<li><a class="lt-ev lt-${esc(e.tipo)}${e.futuro ? ' lt-fut' : ''}" href="${esc(hrefDe(e, pid))}" title="${esc(e.titulo)}${e.detalhe ? ' — ' + esc(e.detalhe) : ''}">
    <span class="lt-data">${dia}<span class="lt-hora">${esc(e.hora || '')}</span></span>
    <span class="lt-marca" aria-hidden="true">${e.icone}</span>
    <span class="lt-corpo"><span class="lt-linha1"><strong>${esc(e.titulo)}</strong><span class="selo ${esc(e.selo.cls)}">${esc(e.selo.texto)}</span></span>
      <span class="lt-detalhe muted">${esc(e.detalhe || TIPOS[e.tipo].nome)}</span></span></a></li>`;
}

export async function renderLinhaTempo(el, pacienteId) {
  const { sb, estado, podeGerir, areasDaEspecialidade } = await import('../core.js');
  garantirCss();
  el.innerHTML = '<div class="vazio">Carregando a linha do tempo…</div>';
  const gerir = podeGerir(), souProf = estado.perfil === 'profissional';

  // Planos primeiro só para achar as guias (só gestão); o resto corre em paralelo. Cada fonte é tolerante a erro.
  const guiasDe = async () => {
    const { data: planos, error } = await sb.from('paciente_planos').select('id').eq('paciente_id', pacienteId);
    if (error) return null;
    return seguro(sb.from('guias').select('id, numero_guia_prestador, data_atendimento, status, segurada, contratos(nome)')
      .in('paciente_plano_id', (planos || []).map((p) => p.id).concat(['00000000-0000-0000-0000-000000000000'])));
  };
  const autsDe = async () => {
    const auts = await seguro(sb.from('autorizacoes').select('id, status, senha, data_autorizacao, validade, solicitada_em, area, qtd_autorizada, profissional_id, paciente_planos!inner(paciente_id, contratos(nome))')
      .eq('paciente_planos.paciente_id', pacienteId));
    if (!auts || !souProf) return auts;
    // Mesma regra da ficha: profissional só vê autorizações da sua área ou feitas em seu nome (a RLS já filtra; aqui é a segunda trava)
    let minhas = [];
    try { const { data: eu } = await sb.from('profissionais').select('especialidade').eq('id', estado.profissionalId).maybeSingle(); minhas = areasDaEspecialidade(eu?.especialidade); } catch {}
    return auts.filter((a) => minhas.includes(a.area) || a.profissional_id === estado.profissionalId);
  };
  const [atendimentos, autorizacoes, encaminhamentos, documentos, prontuario, recebimentos, guias] = await Promise.all([
    seguro(sb.from('atendimentos').select('id, inicio, status, servico, sala, profissionais(nome)').eq('paciente_id', pacienteId)),
    autsDe(),
    seguro(sb.from('encaminhamentos').select('id, area, data_pedido, validade, cid, status, solicitantes(nome)').eq('paciente_id', pacienteId)),
    seguro(sb.from('documentos_emitidos').select('id, tipo, titulo, codigo, emitido_em, profissionais(nome)').eq('paciente_id', pacienteId)),
    seguro(sb.from('prontuario_registros').select('id, modelo, area, data_registro').eq('paciente_id', pacienteId)),   // sem 'conteudo' de propósito
    gerir ? seguro(sb.from('recebimentos').select('id, pago_em, forma, parcelas, valor_pago, nf_numero').eq('paciente_id', pacienteId)) : Promise.resolve(null),
    gerir ? guiasDe() : Promise.resolve(null),
  ]);

  const { proximos, passados, todos } = montarEventos({ atendimentos, autorizacoes, encaminhamentos, documentos, prontuario, recebimentos, guias });
  if (!todos.length) {
    el.innerHTML = `<div class="cartao vazio lt-vazio"><div class="lt-vazio-ic" aria-hidden="true">🕓</div><h3>Ainda não há histórico para este paciente</h3>
      <p class="muted">Aqui vai aparecer, em ordem do mais recente para o mais antigo, tudo o que acontecer: atendimentos e faltas, autorizações e encaminhamentos,
      documentos emitidos${gerir ? ', pagamentos e guias' : ''} e os seus registros de prontuário.</p>
      <p><a class="btn primario" href="#agenda">Marcar o primeiro atendimento</a></p></div>`;
    return;
  }

  const contagem = contar(todos), r = resumir({ proximos, passados });
  const filtro = lerFiltro(pacienteId); filtro.tipos = filtro.tipos.filter((k) => contagem[k]);
  let limite = PASSO;
  const rotuloQuando = (x) => (x ? `${fmtData(x.dia)}${x.hora ? ' · ' + x.hora : ''}` : '—');

  el.innerHTML = `<div class="kpis lt-resumo">
      <div class="kpi"><div class="rotulo">Primeira vez na clínica</div><div class="valor lt-v-data">${r.primeira ? esc(fmtData(r.primeira)) : '—'}</div></div>
      <div class="kpi"><div class="rotulo">Atendimentos realizados</div><div class="valor">${r.realizados}</div></div>
      <div class="kpi ${r.faltas >= 2 ? 'alerta' : ''}"><div class="rotulo">Faltas</div><div class="valor">${r.faltas}</div></div>
      <div class="kpi"><div class="rotulo">Último atendimento</div><div class="valor lt-v-data">${r.ultimo ? esc(fmtData(r.ultimo.dia)) : '—'}</div></div>
      <div class="kpi"><div class="rotulo">Próximo agendado</div><div class="valor lt-v-data">${r.proximo ? esc(fmtData(r.proximo.dia)) : '—'}</div><div class="sub">${r.proximo?.hora ? esc(r.proximo.hora) : ''}</div></div>
    </div>
    <div class="cartao lt-filtros">
      <div class="lt-chips" role="group" aria-label="Filtrar por tipo">${Object.entries(TIPOS).filter(([k]) => contagem[k]).map(([k, t]) =>
        `<button type="button" class="chip-filtro" data-tipo="${k}" aria-pressed="false">${t.icone} ${t.nome} <b>${contagem[k]}</b></button>`).join('')}</div>
      <input type="search" class="lt-busca" placeholder="Buscar na linha do tempo (serviço, profissional, senha, CID…)" aria-label="Buscar na linha do tempo" value="${esc(filtro.busca)}">
    </div>
    <div id="lt-lista"></div>`;

  const lista = el.querySelector('#lt-lista'), busca = el.querySelector('.lt-busca');
  const desenhar = () => {
    el.querySelectorAll('.chip-filtro').forEach((b) => { const on = filtro.tipos.includes(b.dataset.tipo); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const px = filtrar(proximos, filtro), ps = filtrar(passados, filtro);
    if (!px.length && !ps.length) {
      lista.innerHTML = `<div class="cartao vazio"><p>Nada encontrado com esse filtro.</p><button type="button" class="btn" id="lt-limpar">Limpar filtros</button></div>`;
      lista.querySelector('#lt-limpar').onclick = () => { filtro.tipos = []; filtro.busca = ''; busca.value = ''; guardarFiltro(pacienteId, filtro); limite = PASSO; desenhar(); };
      return;
    }
    const mostrados = ps.slice(0, limite);
    lista.innerHTML = `${px.length ? `<section class="lt-proximos"><h4 class="lt-titulo-bloco">Próximos <span class="muted">${px.length}</span></h4><ul class="lt-lista">${px.map((e) => htmlEvento(e, pacienteId, true)).join('')}</ul></section>` : ''}
      ${agrupar(mostrados).map((g) => `<section class="lt-grupo"><h4 class="lt-mes">${esc(g.rotulo)}</h4><ul class="lt-lista">${g.eventos.map((e) => htmlEvento(e, pacienteId, false)).join('')}</ul></section>`).join('')}
      ${ps.length > limite ? `<div class="lt-mais"><button type="button" class="btn" id="lt-mais">Mostrar mais (${ps.length - limite} restantes)</button></div>` : ''}`;
    const mais = lista.querySelector('#lt-mais'); if (mais) mais.onclick = () => { limite += PASSO; desenhar(); };
  };
  el.querySelectorAll('.chip-filtro').forEach((b) => (b.onclick = () => {
    const k = b.dataset.tipo; filtro.tipos = filtro.tipos.includes(k) ? filtro.tipos.filter((x) => x !== k) : [...filtro.tipos, k];
    guardarFiltro(pacienteId, filtro); limite = PASSO; desenhar();
  }));
  busca.addEventListener('input', () => { filtro.busca = busca.value; guardarFiltro(pacienteId, filtro); limite = PASSO; desenhar(); });
  desenhar();
}
