// Inteligência de glosas (item 26): onde a clínica perde dinheiro, por motivo × convênio × procedimento × profissional,
// prazos de recurso e tempo até o demonstrativo. Só gestão (podeGerir). Usa apenas linhas `da_clinica` do retorno.
// Os cálculos são funções puras exportadas (testáveis em node); o core.js é importado só dentro de render()
// para o arquivo poder ser importado fora do navegador.

export const META = 3; // % de referência, igual ao Painel
// Mesmo mapa do painel.js ("como o sistema vai prevenir") + o que o fechamento da guia já barra (CLAUDE.md)
export const EVITAVEIS = {
  '3209': 'Bloquear guia repetida (mesmo paciente, procedimento e data)',
  '3292': 'Controlar sessões autorizadas × usadas',
  '1814': 'Exigir autorização válida na data do atendimento',
  '1705': 'Preencher valor pela tabela do contrato',
};
const NO_SISTEMA = {
  '3209': 'Guias fechadas pelo Cure OS já são barradas nesse caso. Confira se estas guias saíram do sistema.',
  '3292': 'Guias fechadas pelo Cure OS já são barradas nesse caso. Confira se estas guias saíram do sistema.',
  '1814': 'Guias fechadas pelo Cure OS já são barradas nesse caso. Confira se estas guias saíram do sistema.',
  '1705': 'O fechamento da guia no Cure OS barra procedimento sem valor. Confira a tabela do contrato.',
};
export const ACAO_NEUTRA = 'Conferir no demonstrativo e cadastrar a orientação.';
const VALIDOS = ['em_revisao', 'confirmado'];

const N = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const taxa = (g, i) => (i > 0 ? (g / i) * 100 : null);
const isoDia = (d) => d.toLocaleDateString('sv');
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00Z') - Date.parse(a + 'T12:00Z')) / 864e5);
export const nomeConvenio = (r) => r?.contratos?.nome || 'Sem convênio';
const codigo = (l) => l.codigo_glosa || '—';
const chaveGuia = (l) => `${l.numero_lote ?? ''}|${l.numero_guia_prestador ?? ''}`;
const porId = (rs) => new Map((rs || []).map((r) => [r.id, r]));

// Retornos válidos pelo filtro + só linhas da clínica desses retornos
export function filtrar(linhas, retornos, f = {}, hoje = new Date()) {
  let corte = null;
  if (f.meses) { const d = new Date(hoje); d.setMonth(d.getMonth() - f.meses); corte = isoDia(d); }
  const rs = (retornos || []).filter((r) => VALIDOS.includes(r.status)
    && (!f.soConfirmados || r.status === 'confirmado')
    && (!f.convenio || nomeConvenio(r) === f.convenio)
    && (!corte || (r.data_emissao && r.data_emissao >= corte)));
  const ids = new Set(rs.map((r) => r.id));
  return { retornos: rs, linhas: (linhas || []).filter((l) => l.classe === 'da_clinica' && ids.has(l.retorno_id)) };
}

export function resumir(linhas, retornos, motivos = []) {
  const desc = Object.fromEntries((motivos || []).map((m) => [m.codigo, m.descricao]));
  const glos = linhas.filter((l) => N(l.valor_glosa) > 0);
  const faturado = r2(linhas.reduce((s, l) => s + N(l.valor_informado), 0));
  const glosado = r2(glos.reduce((s, l) => s + N(l.valor_glosa), 0));
  const guias = new Set(linhas.map(chaveGuia)), guiasGlosa = new Set(glos.map(chaveGuia));
  const por = {};
  glos.forEach((l) => { const k = codigo(l); (por[k] ||= { codigo: k, valor: 0, n: 0 }); por[k].valor += N(l.valor_glosa); por[k].n++; });
  const porMotivo = Object.values(por).map((m) => ({ ...m, valor: r2(m.valor), descricao: desc[m.codigo] || null }))
    .sort((a, b) => b.valor - a.valor || a.codigo.localeCompare(b.codigo));
  return {
    faturado, glosado, taxa: taxa(glosado, faturado), itensGlosados: glos.length,
    ticket: glos.length ? r2(glosado / glos.length) : 0,
    guias: guias.size, guiasComGlosa: guiasGlosa.size,
    evitavel: r2(glos.filter((l) => EVITAVEIS[l.codigo_glosa]).reduce((s, l) => s + N(l.valor_glosa), 0)),
    emRevisao: (retornos || []).filter((r) => r.status === 'em_revisao').length,
    porMotivo,
  };
}

// Motivo (linhas, por valor) × convênio (colunas, por valor)
export function matriz(linhas, retornos) {
  const rs = porId(retornos), cel = {}, tl = {}, tc = {};
  let total = 0, max = 0;
  linhas.filter((l) => N(l.valor_glosa) > 0).forEach((l) => {
    const m = codigo(l), c = nomeConvenio(rs.get(l.retorno_id)), v = N(l.valor_glosa);
    ((cel[m] ||= {})[c] ||= { v: 0, n: 0 }); cel[m][c].v += v; cel[m][c].n++;
    tl[m] = (tl[m] || 0) + v; tc[c] = (tc[c] || 0) + v; total += v;
  });
  Object.values(cel).forEach((o) => Object.values(o).forEach((x) => { x.v = r2(x.v); max = Math.max(max, x.v); }));
  const ord = (o) => Object.keys(o).sort((a, b) => o[b] - o[a] || a.localeCompare(b));
  Object.keys(tl).forEach((k) => (tl[k] = r2(tl[k]))); Object.keys(tc).forEach((k) => (tc[k] = r2(tc[k])));
  return { motivos: ord(tl), convenios: ord(tc), cel, totLinha: tl, totCol: tc, total: r2(total), max };
}

// Taxa por mês de emissão do retorno (retorno sem data fica de fora do gráfico)
export function evolucao(linhas, retornos) {
  const rs = porId(retornos), m = {};
  linhas.forEach((l) => { const d = rs.get(l.retorno_id)?.data_emissao; if (!d) return; const k = d.slice(0, 7);
    (m[k] ||= { mes: k, informado: 0, glosa: 0 }); m[k].informado += N(l.valor_informado); m[k].glosa += N(l.valor_glosa); });
  return Object.values(m).sort((a, b) => a.mes.localeCompare(b.mes))
    .map((x) => ({ mes: x.mes, informado: r2(x.informado), glosa: r2(x.glosa), taxa: taxa(x.glosa, x.informado) }));
}

export function porProcedimento(linhas) {
  const m = {}; let ti = 0, tg = 0;
  linhas.forEach((l) => { const k = l.codigo_procedimento || ''; (m[k] ||= { codigo: k, n: 0, informado: 0, glosa: 0 });
    m[k].n++; m[k].informado += N(l.valor_informado); m[k].glosa += N(l.valor_glosa); ti += N(l.valor_informado); tg += N(l.valor_glosa); });
  const media = taxa(tg, ti);
  return { media, lista: Object.values(m).map((x) => { const t = taxa(x.glosa, x.informado);
    return { ...x, informado: r2(x.informado), glosa: r2(x.glosa), taxa: t, acima: media != null && t != null && x.glosa > 0 && t > media }; })
    .sort((a, b) => b.glosa - a.glosa || b.informado - a.informado) };
}

// linha → guia (direto ou pelo item) → profissional
export function porProfissional(linhas, guias = [], itens = [], profs = []) {
  const gItem = new Map(itens.map((i) => [i.id, i.guia_id])), gProf = new Map(guias.map((g) => [g.id, g.profissional_id]));
  const nome = new Map(profs.map((p) => [p.id, p.nome])), m = {}; let ligadas = 0;
  linhas.forEach((l) => { const gid = l.guia_id || gItem.get(l.guia_item_id); const pid = gid && gProf.get(gid); if (!pid) return;
    ligadas++; (m[pid] ||= { id: pid, nome: nome.get(pid) || 'Profissional sem cadastro', n: 0, informado: 0, glosa: 0 });
    m[pid].n++; m[pid].informado += N(l.valor_informado); m[pid].glosa += N(l.valor_glosa); });
  return { ligadas, total: linhas.length, lista: Object.values(m).map((x) => ({ ...x, informado: r2(x.informado), glosa: r2(x.glosa), taxa: taxa(x.glosa, x.informado) }))
    .sort((a, b) => b.glosa - a.glosa) };
}

// 5 motivos de maior valor com a ação. Só usa orientação que o próprio sistema sustenta.
export function acoes(porMotivo, motivos = [], n = 5) {
  const cad = new Map((motivos || []).map((m) => [m.codigo, m]));
  return porMotivo.slice(0, n).map((m) => { const c = cad.get(m.codigo);
    return { ...m, evitavel: !!EVITAVEIS[m.codigo], acao: EVITAVEIS[m.codigo] || ACAO_NEUTRA, noSistema: NO_SISTEMA[m.codigo] || null,
      inativo: c && c.ativo === false ? { desde: c.inativo_desde || null, por: c.substituido_por || null } : null }; });
}

// Glosas ainda pendentes com prazo vencido ou nos próximos `dias`
export function prazos(glosas, hoje = new Date(), dias = 15) {
  const h = isoDia(hoje);
  return (glosas || []).filter((g) => g.status === 'pendente' && g.prazo_recurso && diasEntre(h, g.prazo_recurso) <= dias)
    .map((g) => ({ ...g, faltam: diasEntre(h, g.prazo_recurso) }))
    .sort((a, b) => a.prazo_recurso.localeCompare(b.prazo_recurso));
}

// % recuperado = valor recuperado / valor já decidido em recurso (recuperada + definitiva)
export function recuperacao(glosas) {
  const v = (st) => r2((glosas || []).filter((g) => g.status === st).reduce((s, g) => s + N(g.valor), 0));
  const n = (st) => (glosas || []).filter((g) => g.status === st).length;
  const rec = v('recuperada'), def = v('definitiva');
  return { recuperado: rec, perdido: def, emRecurso: n('em_recurso'), valorEmRecurso: v('em_recurso'), decididas: n('recuperada') + n('definitiva'),
    pct: rec + def > 0 ? (rec / (rec + def)) * 100 : null };
}

// Dias entre o envio do lote e a emissão do 1º demonstrativo que cita o lote (mesmo nº e mesmo contrato)
export function tempoPagamento(lotes, linhas, retornos) {
  const rs = porId(retornos), cita = {};
  linhas.forEach((l) => { const r = rs.get(l.retorno_id); if (!r?.data_emissao || !l.numero_lote) return;
    const k = `${r.contrato_id ?? ''}|${l.numero_lote}`; if (!cita[k] || r.data_emissao < cita[k].data_emissao) cita[k] = r; });
  const g = {};
  (lotes || []).forEach((lt) => { if (!lt.data_envio) return; const r = cita[`${lt.contrato_id ?? ''}|${lt.numero_lote}`];
    if (!r || r.data_emissao < lt.data_envio) return; const d = diasEntre(lt.data_envio, r.data_emissao), c = nomeConvenio(r);
    (g[c] ||= { convenio: c, dias: [] }).dias.push(d); });
  return Object.values(g).map((x) => ({ convenio: x.convenio, n: x.dias.length, media: x.dias.reduce((a, b) => a + b, 0) / x.dias.length,
    min: Math.min(...x.dias), max: Math.max(...x.dias) })).sort((a, b) => b.media - a.media);
}

// CSV para Excel brasileiro: ";" + vírgula decimal + BOM. Sem carteirinha (LGPD).
export function csv(linhas, retornos, motivos = []) {
  const rs = porId(retornos), desc = Object.fromEntries((motivos || []).map((m) => [m.codigo, m.descricao]));
  const cel = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const dec = (v) => N(v).toFixed(2).replace('.', ',');
  const cab = ['Emissão do retorno', 'Convênio', 'Status do retorno', 'Lote', 'Guia (prestador)', 'Guia (operadora)', 'Data de realização',
    'Procedimento', 'Valor informado', 'Valor liberado', 'Valor glosado', 'Código da glosa', 'Motivo'];
  const corpo = linhas.map((l) => { const r = rs.get(l.retorno_id) || {};
    return [r.data_emissao, nomeConvenio(r), r.status === 'confirmado' ? 'Confirmado' : 'Em revisão', l.numero_lote, l.numero_guia_prestador,
      l.numero_guia_operadora, l.data_realizacao, l.codigo_procedimento, dec(l.valor_informado), dec(l.valor_liberado), dec(l.valor_glosa),
      l.codigo_glosa, l.codigo_glosa ? desc[l.codigo_glosa] || '' : ''].map(cel).join(';'); });
  return '﻿' + [cab.join(';'), ...corpo].join('\r\n') + '\r\n';
}

// Faixa de cor do mapa de calor (0 = vazio, 1…5 = mais claro → mais escuro; texto sempre escuro)
export const faixa = (v, max) => (!v || !max ? 0 : Math.min(5, Math.max(1, Math.ceil((v / max) * 5))));

/* ------------------------------------------------------------------ tela */
let filtro = { meses: 0, convenio: '', soConfirmados: false };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotMes = (k) => `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;

export async function render() {
  const core = await import('../core.js');
  const { sb, estado, $, $$, esc, brl, pct, data, tela, falha, modal } = core;
  if (!core.podeGerir()) {
    const c = tela('Inteligência de glosas');
    c.innerHTML = '<div class="cartao vazio">Esta tela é só da gestão e do financeiro.</div>';
    return;
  }
  const c = tela('Inteligência de glosas', '<button class="btn" id="gi-csv">Exportar CSV</button>');
  const cid = estado.clinica.id;
  const [r1, r2_, r3, r4, r5, r6] = await Promise.all([
    sb.from('retorno_linhas').select('id, retorno_id, classe, numero_lote, numero_guia_prestador, numero_guia_operadora, data_realizacao, codigo_procedimento, valor_informado, valor_liberado, valor_glosa, codigo_glosa, guia_id, guia_item_id')
      .eq('clinica_id', cid).eq('classe', 'da_clinica'),
    sb.from('retornos').select('id, contrato_id, data_emissao, status, contratos(nome)').eq('clinica_id', cid),
    sb.from('motivos_glosa').select('codigo, descricao, ativo, substituido_por, inativo_desde'),
    sb.from('glosas').select('id, codigo_glosa, valor, status, prazo_recurso, guia_item_id, retorno_linha_id, guia_itens(data_realizacao, guias(numero_guia_prestador, contratos(nome)))').eq('clinica_id', cid),
    sb.from('lotes').select('id, contrato_id, numero_lote, data_envio, previsto_pagamento, valor_total, status').eq('clinica_id', cid),
    sb.from('profissionais').select('id, nome').eq('clinica_id', cid),
  ]);
  const erro = [r1, r2_, r3, r4, r5, r6].find((r) => r.error)?.error;
  if (erro) return falha(erro, 'Inteligência de glosas');
  const todas = r1.data || [], rets = r2_.data || [], motivos = r3.data || [], glosas = r4.data || [], lotes = r5.data || [], profs = r6.data || [];

  // Guias ligadas às linhas (direto ou pelo item) → profissional
  const idsItem = [...new Set(todas.filter((l) => !l.guia_id && l.guia_item_id).map((l) => l.guia_item_id))];
  let itens = [];
  if (idsItem.length) { const { data: d, error: e } = await sb.from('guia_itens').select('id, guia_id').in('id', idsItem); if (e) return falha(e); itens = d || []; }
  const idsGuia = [...new Set([...todas.map((l) => l.guia_id), ...itens.map((i) => i.guia_id)].filter(Boolean))];
  let guias = [];
  if (idsGuia.length) { const { data: d, error: e } = await sb.from('guias').select('id, profissional_id').in('id', idsGuia); if (e) return falha(e); guias = d || []; }

  const convenios = [...new Set(rets.filter((r) => VALIDOS.includes(r.status)).map(nomeConvenio))].sort();
  if (filtro.convenio && !convenios.includes(filtro.convenio)) filtro.convenio = '';
  const linhaPorId = new Map(todas.map((l) => [l.id, l]));
  const valor = (v) => (v == null ? '—' : pct(v));
  const vazio = (t) => `<div class="vazio gi-vazio">${t}</div>`;

  function desenhar() {
    const { linhas, retornos } = filtrar(todas, rets, filtro);
    const res = resumir(linhas, retornos, motivos), mx = matriz(linhas, retornos), evo = evolucao(linhas, retornos);
    const proc = porProcedimento(linhas), prof = porProfissional(linhas, guias, itens, profs), ac = acoes(res.porMotivo, motivos);
    const pz = prazos(glosas), rec = recuperacao(glosas), tp = tempoPagamento(lotes, linhas, retornos);
    const temRetorno = rets.some((r) => VALIDOS.includes(r.status));
    const semLinhas = temRetorno ? 'Nenhuma linha da clínica com estes filtros.' : 'Importe um retorno em <a href="#retornos">Retornos e glosas</a> para acender este bloco.';
    const desc = (k) => (k === '—' ? 'Sem código de glosa' : motivos.find((m) => m.codigo === k)?.descricao || 'descrição a cadastrar');

    c.innerHTML = `
      <div class="cartao gi-filtros">
        <div class="gi-grupo" role="group" aria-label="Período">
          <span class="muted">Emissão do retorno:</span>
          ${[[3, '3 meses'], [6, '6 meses'], [12, '12 meses'], [0, 'Tudo']].map(([m, t]) => `<button class="chip-filtro ${filtro.meses === m ? 'on' : ''}" data-meses="${m}" aria-pressed="${filtro.meses === m}">${t}</button>`).join('')}
        </div>
        <label class="gi-grupo">Convênio <select id="gi-conv"><option value="">Todos</option>
          ${convenios.map((n) => `<option ${n === filtro.convenio ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="gi-grupo gi-check"><input type="checkbox" id="gi-conf" ${filtro.soConfirmados ? 'checked' : ''}> Só retornos confirmados</label>
      </div>
      ${res.emRevisao ? `<div class="dica">${res.emRevisao === 1 ? 'Há 1 retorno em revisão' : `Há ${res.emRevisao} retornos em revisão`} nestes números: eles ainda podem mudar. <a href="#retornos">Revisar →</a></div>` : ''}

      <div class="kpis">
        <div class="kpi"><div class="rotulo">Faturado</div><div class="valor">${brl(res.faturado)}</div><div class="sub">valor informado nos retornos</div></div>
        <div class="kpi alerta"><div class="rotulo">Glosado</div><div class="valor">${brl(res.glosado)}</div><div class="sub">${res.itensGlosados} itens glosados</div></div>
        <div class="kpi ${res.taxa != null && res.taxa > META ? 'alerta' : ''}"><div class="rotulo">Taxa de glosa</div><div class="valor">${valor(res.taxa)}</div><div class="sub">meta sugerida: abaixo de ${META}%</div></div>
        <div class="kpi"><div class="rotulo">Ticket médio da glosa</div><div class="valor">${res.itensGlosados ? brl(res.ticket) : '—'}</div><div class="sub">por item glosado</div></div>
        <div class="kpi"><div class="rotulo">Guias com glosa</div><div class="valor">${res.guiasComGlosa} <small class="gi-de">de ${res.guias}</small></div><div class="sub">${res.guias ? pct((res.guiasComGlosa / res.guias) * 100) + ' das guias' : 'nenhuma guia no período'}</div></div>
        <div class="kpi"><div class="rotulo">Glosas evitáveis</div><div class="valor">${brl(res.evitavel)}</div><div class="sub">códigos 3209, 3292, 1814 e 1705</div></div>
      </div>

      <div class="cartao"><h3>O que fazer</h3>
        ${ac.length ? `<div class="gi-acoes">${ac.map((a, i) => `<article class="gi-acao ${a.evitavel ? 'evitavel' : ''}">
          <div class="gi-acao-topo"><span class="gi-pos">${i + 1}</span><strong>${esc(a.codigo)}</strong>
            ${a.evitavel ? '<span class="selo ok">Evitável</span>' : ''}</div>
          <div class="gi-acao-desc ${a.descricao ? '' : 'muted'}">${esc(a.codigo === '—' ? 'Sem código de glosa' : a.descricao || 'descrição a cadastrar')}</div>
          <div class="gi-acao-num"><span>${brl(a.valor)}</span><span class="muted">${a.n} ${a.n === 1 ? 'ocorrência' : 'ocorrências'}</span></div>
          <p class="gi-acao-fazer"><b>Ação:</b> ${esc(a.acao)}</p>
          ${a.noSistema ? `<p class="muted gi-acao-nota">${esc(a.noSistema)}</p>` : ''}
          ${a.inativo ? `<p class="gi-acao-nota"><span class="selo pendente">Código inativo${a.inativo.desde ? ' desde ' + esc(data(a.inativo.desde)) : ''}</span>${a.inativo.por ? ` substituído por <b>${esc(a.inativo.por)}</b>` : ''}</p>` : ''}
        </article>`).join('')}</div>` : vazio(linhas.length ? 'Nenhuma glosa no período. 🎉' : semLinhas)}
      </div>

      <div class="cartao"><h3>Motivo × convênio</h3>
        ${mx.motivos.length ? `<p class="muted gi-legenda">Quanto mais escura a célula, maior o valor glosado. Toque numa célula para ver as linhas.</p>
        <div class="tabela-rolagem gi-rolagem"><table class="gi-matriz">
          <caption class="gi-sr">Valor glosado por motivo e convênio</caption>
          <thead><tr><th scope="col">Motivo</th>${mx.convenios.map((cv) => `<th scope="col" class="num">${esc(cv)}</th>`).join('')}<th scope="col" class="num">Total</th></tr></thead>
          <tbody>${mx.motivos.map((m) => `<tr><th scope="row"><strong>${esc(m)}</strong> <span class="muted">${esc(desc(m))}</span></th>
            ${mx.convenios.map((cv) => { const x = mx.cel[m]?.[cv]; return x ? `<td class="num gi-q${faixa(x.v, mx.max)}"><button class="gi-cel" data-m="${esc(m)}" data-c="${esc(cv)}"
              aria-label="${esc(m)} em ${esc(cv)}: ${brl(x.v)}, ${x.n} itens">${brl(x.v)}<small>${x.n}×</small></button></td>` : '<td class="num gi-q0"><span class="muted">—</span></td>'; }).join('')}
            <td class="num gi-tot">${brl(mx.totLinha[m])}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th>${mx.convenios.map((cv) => `<td class="num gi-tot">${brl(mx.totCol[cv])}</td>`).join('')}<td class="num gi-tot">${brl(mx.total)}</td></tr></tfoot>
        </table></div>` : vazio(linhas.length ? 'Nenhuma glosa no período. 🎉' : semLinhas)}
      </div>

      <div class="gi-duas">
        <div class="cartao"><h3>Evolução da taxa de glosa</h3>
          ${evo.length ? `<div id="gi-evo" class="gi-evo"></div>
            <details class="gi-tabela"><summary>Ver em tabela</summary><div class="tabela-rolagem"><table><thead><tr><th>Mês</th><th class="num">Informado</th><th class="num">Glosado</th><th class="num">Taxa</th></tr></thead>
            <tbody>${evo.map((e) => `<tr><td>${rotMes(e.mes)}</td><td class="num">${brl(e.informado)}</td><td class="num">${brl(e.glosa)}</td><td class="num">${valor(e.taxa)}</td></tr>`).join('')}</tbody></table></div></details>
            ${evo.length === 1 ? '<p class="muted gi-legenda">Com um só mês ainda não dá para ver tendência: cada retorno novo acrescenta uma barra.</p>' : ''}`
          : vazio(linhas.length ? 'Os retornos do período estão sem data de emissão.' : semLinhas)}
        </div>
        <div class="cartao"><h3>Prazos de recurso</h3>
          ${pz.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Prazo</th><th>Situação</th><th>Código</th><th>Guia</th><th class="num">Valor</th></tr></thead><tbody>
            ${pz.map((g) => { const l = linhaPorId.get(g.retorno_linha_id); const guia = g.guia_itens?.guias?.numero_guia_prestador || l?.numero_guia_prestador;
              return `<tr><td>${data(g.prazo_recurso)}</td><td>${g.faltam < 0 ? `<span class="selo alerta">Vencido há ${-g.faltam} d</span>` : g.faltam === 0 ? '<span class="selo alerta">Vence hoje</span>'
                : `<span class="selo pendente">Faltam ${g.faltam} d</span>`}</td><td><strong>${esc(g.codigo_glosa || '—')}</strong></td><td>${esc(guia || '—')}</td><td class="num">${brl(g.valor)}</td></tr>`; }).join('')}
            </tbody></table></div>`
          : vazio('Nenhuma glosa pendente com prazo vencido ou nos próximos 15 dias. Os prazos aparecem quando as glosas forem registradas a partir das guias feitas no Cure OS.')}
          <p class="muted gi-legenda">${rec.decididas ? `Recuperado em recurso: <b>${valor(rec.pct)}</b> do valor já decidido (${brl(rec.recuperado)} de ${brl(rec.recuperado + rec.perdido)}).` : 'Recuperado em recurso: aparece quando houver recurso decidido.'}
            ${rec.emRecurso ? ` ${rec.emRecurso} em recurso aguardando resposta (${brl(rec.valorEmRecurso)}).` : ''}</p>
        </div>
      </div>

      <div class="cartao"><h3>Por procedimento</h3>
        ${proc.lista.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Procedimento</th><th class="num">Itens</th><th class="num">Informado</th><th class="num">Glosado</th><th class="num">Taxa</th></tr></thead><tbody>
          ${proc.lista.map((p) => `<tr><td>${p.codigo ? `<strong>${esc(p.codigo)}</strong>` : '<span class="muted">Sem código (saldo da guia)</span>'}</td><td class="num">${p.n}</td>
            <td class="num">${brl(p.informado)}</td><td class="num">${brl(p.glosa)}</td>
            <td class="num">${p.acima ? `<span class="selo alerta" title="Acima da média">▲ ${valor(p.taxa)}</span>` : valor(p.taxa)}</td></tr>`).join('')}
          </tbody></table></div><p class="muted gi-legenda">Média do período: ${valor(proc.media)}. ▲ = taxa acima da média.</p>` : vazio(semLinhas)}
      </div>

      <div class="gi-duas">
        <div class="cartao"><h3>Por profissional</h3>
          ${prof.lista.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Profissional</th><th class="num">Itens</th><th class="num">Glosado</th><th class="num">Taxa</th></tr></thead><tbody>
            ${prof.lista.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${p.n}</td><td class="num">${brl(p.glosa)}</td><td class="num">${valor(p.taxa)}</td></tr>`).join('')}
            </tbody></table></div><p class="muted gi-legenda">${prof.ligadas} de ${prof.total} linhas ligadas a uma guia do Cure OS.</p>`
          : vazio('Ainda sem linhas ligadas a guias. Este bloco acende quando as guias saírem do próprio Cure OS (fechar atendimento → lote → retorno).')}
        </div>
        <div class="cartao"><h3>Tempo até o demonstrativo</h3>
          ${tp.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Convênio</th><th class="num">Lotes</th><th class="num">Média</th><th class="num">Menor–maior</th></tr></thead><tbody>
            ${tp.map((t) => `<tr><td>${esc(t.convenio)}</td><td class="num">${t.n}</td><td class="num"><strong>${Math.round(t.media)} dias</strong></td><td class="num">${t.min}–${t.max} d</td></tr>`).join('')}
            </tbody></table></div><p class="muted gi-legenda">Dias entre o envio do lote e a emissão do demonstrativo que cita o lote.</p>`
          : vazio('Acende quando um lote enviado pelo Cure OS (com data de envio) aparecer num retorno importado.')}
        </div>
      </div>`;

    $$('[data-meses]', c).forEach((b) => (b.onclick = () => { filtro.meses = Number(b.dataset.meses); desenhar(); }));
    $('#gi-conv', c).onchange = (e) => { filtro.convenio = e.target.value; desenhar(); };
    $('#gi-conf', c).onchange = (e) => { filtro.soConfirmados = e.target.checked; desenhar(); };
    $('#gi-csv').onclick = () => {
      if (!linhas.length) return core.toast('Nada para exportar com estes filtros.');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv(linhas, retornos, motivos)], { type: 'text/csv;charset=utf-8' })),
        download: `glosas-${new Date().toLocaleDateString('sv')}.csv` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    $$('.gi-cel', c).forEach((b) => (b.onclick = () => detalheCelula(b.dataset.m, b.dataset.c, linhas, retornos)));
    const evoEl = $('#gi-evo', c); if (evoEl) evoEl.innerHTML = grafico(evo, evoEl.clientWidth || 600);
  }

  function detalheCelula(m, cv, linhas, retornos) {
    const rs = porId(retornos);
    const ls = linhas.filter((l) => N(l.valor_glosa) > 0 && codigo(l) === m && nomeConvenio(rs.get(l.retorno_id)) === cv)
      .sort((a, b) => N(b.valor_glosa) - N(a.valor_glosa));
    const d = motivos.find((x) => x.codigo === m)?.descricao;
    modal(`<h3>${esc(m)} · ${esc(cv)}</h3><p class="muted">${esc(m === '—' ? 'Sem código de glosa' : d || 'descrição a cadastrar')} · ${ls.length} itens · ${brl(ls.reduce((s, l) => s + N(l.valor_glosa), 0))}</p>
      <div class="tabela-rolagem"><table><thead><tr><th>Lote</th><th>Guia</th><th>Data</th><th>Procedimento</th><th class="num">Informado</th><th class="num">Glosado</th></tr></thead><tbody>
      ${ls.map((l) => `<tr><td>${esc(l.numero_lote || '—')}</td><td>${esc(l.numero_guia_prestador || '—')}</td><td>${data(l.data_realizacao)}</td>
        <td>${esc(l.codigo_procedimento || 'guia inteira')}</td><td class="num">${brl(l.valor_informado)}</td><td class="num"><strong>${brl(l.valor_glosa)}</strong></td></tr>`).join('')}
      </tbody></table></div><div class="linha-acoes"><button class="btn" data-fechar>Fechar</button></div>`, (caixa) => caixa.classList.add('gi-modal'));
  }

  // Barras da taxa por mês com a linha da meta (SVG desenhado na largura real do cartão)
  function grafico(evo, larg) {
    const W = Math.max(280, Math.floor(larg)), H = 220, e = 34, d = 8, t = 22, b = 26, aw = W - e - d, ah = H - t - b;
    const maior = Math.max(META * 2, ...evo.map((x) => x.taxa || 0));
    const passo = maior <= 8 ? 2 : maior <= 20 ? 5 : maior <= 50 ? 10 : 25, topo = Math.ceil((maior * 1.08) / passo) * passo;
    const y = (v) => t + ah - (v / topo) * ah, banda = aw / evo.length, bw = Math.min(44, banda * 0.62);
    const marcas = []; for (let v = 0; v <= topo + 1e-9; v += passo) marcas.push(v);
    const rotular = evo.length <= 12 || W > evo.length * 46;
    const barra = (x0, y0, w, h) => { const r = Math.min(4, w / 2, h); return h <= 0 ? '' :
      `M${x0},${y0 + h}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + h}Z`; };
    return `<svg class="gi-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Taxa de glosa por mês de emissão, com a meta de ${META}%">
      ${marcas.map((v) => `<line class="gi-grade" x1="${e}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text class="gi-eixo" x="${e - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join('')}
      ${evo.map((x, i) => { const cx = e + banda * i + banda / 2, v = x.taxa || 0, yy = y(v), acima = v > META;
        return `<g class="gi-col" tabindex="0"><title>${rotMes(x.mes)}: ${valor(x.taxa)} (${brl(x.glosa)} de ${brl(x.informado)})</title>
          <rect class="gi-alvo" x="${e + banda * i}" y="${t}" width="${banda}" height="${ah}"/>
          <path class="gi-barra ${acima ? 'acima' : ''}" d="${barra(cx - bw / 2, yy, bw, t + ah - yy)}"/>
          ${rotular ? `<text class="gi-rot" x="${cx}" y="${yy - 5}" text-anchor="middle">${valor(x.taxa)}</text>` : ''}
          <text class="gi-eixo" x="${cx}" y="${H - 8}" text-anchor="middle">${rotMes(x.mes)}</text></g>`; }).join('')}
      <line class="gi-meta" x1="${e}" x2="${W - d}" y1="${y(META)}" y2="${y(META)}"/>
      <text class="gi-meta-rot" x="${W - d}" y="${y(META) - 5}" text-anchor="end">meta ${META}%</text>
    </svg>`;
  }

  desenhar();
}
