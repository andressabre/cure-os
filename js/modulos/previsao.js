// Previsão de caixa (item 27) + recebíveis dos convênios (lote D do financeiro).
// Rota: #previsao. Só gestor e financeiro. Só a carteira EMPRESA entra (nunca as pessoais dos sócios).
// Só leitura: os cenários recalculam na tela e nada é gravado.
// A matemática fica em funções puras exportadas (centavos inteiros, datas como texto AAAA-MM-DD) para testar em node.

// ---------------- Funções puras ----------------
export const centavos = (v) => Math.round((Number(v) || 0) * 100);
const ymd = (iso) => String(iso).slice(0, 10).split('-').map(Number);
export const somaDias = (iso, n) => { const [a, m, d] = ymd(iso); return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10); };
export const diasEntre = (de, ate) => { const [a, m, d] = ymd(de), [b, n, e] = ymd(ate); return Math.round((Date.UTC(b, n - 1, e) - Date.UTC(a, m - 1, d)) / 864e5); };
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const diaCurto = (iso) => `${Number(iso.slice(8, 10))} ${MES[Number(iso.slice(5, 7)) - 1]}`;
const dataBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
export const brlC = (c) => ((Number(c) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/^-/, '\u2212'); // sinal de menos não quebra a linha
const sinal = (l) => (l.tipo === 'receber' ? 1 : -1);
export const ehConvenio = (l) => l.tipo === 'receber' && (l.origem === 'lote' || !!l.lote_id);

// Saldo de hoje = mesma conta da aba Caixa do Financeiro: por conta ativa, saldo_inicial + baixas (status 'pago')
// daquela conta com data_saldo_inicial <= data_realizado <= hoje (receber soma, pagar subtrai). Baixa sem conta não entra.
export function saldoHoje({ contas = [], lancamentos = [], hoje }) {
  let total = 0, semConta = 0;
  const ativas = contas.filter((k) => k.ativo !== false);
  const porConta = Object.fromEntries(ativas.map((k) => [k.id, { k, saldo: centavos(k.saldo_inicial) }]));
  for (const l of lancamentos) {
    if (l.status !== 'pago') continue;
    if (!l.conta_id) { semConta++; continue; }
    const x = porConta[l.conta_id];
    if (!x || !l.data_realizado || l.data_realizado < x.k.data_saldo_inicial || l.data_realizado > hoje) continue;
    x.saldo += sinal(l) * centavos(l.valor_realizado);
  }
  for (const x of Object.values(porConta)) total += x.saldo;
  return { total, porConta: Object.values(porConta).map((x) => ({ id: x.k.id, nome: x.k.nome, saldo: x.saldo })), semConta };
}

// Taxa histórica de glosa: soma valor_glosa / soma valor_informado das linhas de retorno da clínica (classe da_clinica).
export function taxaGlosa(linhas = []) {
  let inf = 0, gl = 0;
  for (const r of linhas) { if (r.classe && r.classe !== 'da_clinica') continue; inf += centavos(r.valor_informado); gl += centavos(r.valor_glosa); }
  return { temRetorno: inf > 0, informado: inf, glosa: gl, pct: inf > 0 ? Math.round((gl / inf) * 1000) / 10 : 0 };
}

// Lotes enviados e ainda não pagos. lancsLote = lançamentos (qualquer status) com lote_id desses lotes.
// Pago = existe lançamento do lote com status 'pago'. Lote cujo(s) lançamento(s) foram todos cancelados sai da lista.
export function recebiveis({ lotes = [], lancsLote = [], hoje }) {
  const porLote = {};
  for (const l of lancsLote) (porLote[l.lote_id] ||= []).push(l);
  const out = [];
  for (const lt of lotes) {
    if (!lt.data_envio || !['enviado', 'protocolado', 'retornado'].includes(lt.status)) continue;
    const ls = porLote[lt.id] || [];
    if (ls.some((l) => l.status === 'pago')) continue;
    const prev = ls.filter((l) => l.status === 'previsto');
    if (ls.length && !prev.length) continue;
    const valor = prev.length ? prev.reduce((s, l) => s + centavos(l.valor_previsto), 0) : centavos(lt.valor_total);
    const previsao = prev.length ? prev.map((l) => l.vencimento).sort()[0] : (lt.previsto_pagamento || null);
    out.push({ id: lt.id, numero: lt.numero_lote, competencia: lt.competencia, envio: lt.data_envio, status: lt.status, valor, previsao,
      semLancamento: !prev.length, contrato: lt.contratos?.nome || 'Contrato', operadora: lt.contratos?.operadoras?.nome || lt.contratos?.nome || 'Operadora',
      contrato_id: lt.contrato_id, emAnalise: diasEntre(lt.data_envio, hoje), atrasado: !!previsao && previsao < hoje });
  }
  return out.sort((a, b) => a.operadora.localeCompare(b.operadora, 'pt-BR') || a.contrato.localeCompare(b.contrato, 'pt-BR') || a.envio.localeCompare(b.envio));
}
export function agruparRecebiveis(rs) {
  const g = new Map();
  for (const r of rs) { const x = g.get(r.operadora) || { operadora: r.operadora, total: 0, itens: [] }; x.total += r.valor; x.itens.push(r); g.set(r.operadora, x); }
  return [...g.values()];
}

// Projeção diária. saldo em centavos; lancamentos = previstos (status 'previsto') da carteira empresa.
// cenarios: atraso (dias somados ao vencimento dos convênios), glosa (% descontado das entradas de convênio),
// incluirAtrasados (vencidos não baixados: entram hoje, senão ficam fora).
export function projetar({ saldo = 0, lancamentos = [], dias = 30, cenarios = {}, hoje }) {
  const atraso = Number(cenarios.atraso) || 0, glosa = Math.min(100, Math.max(0, Number(cenarios.glosa) || 0));
  const incluir = cenarios.incluirAtrasados !== false, fim = somaDias(hoje, dias - 1);
  const eventos = [], fora = { n: 0, ent: 0, sai: 0 };
  for (const l of lancamentos) {
    if (l.status && l.status !== 'previsto') continue;
    const conv = ehConvenio(l);
    let quando = conv && atraso ? somaDias(l.vencimento, atraso) : l.vencimento;
    let cent = centavos(l.valor_previsto);
    if (conv && glosa) cent = Math.round((cent * (1000 - glosa * 10)) / 1000);
    const atrasado = quando < hoje;
    if (atrasado) {
      if (!incluir) { fora.n++; fora[l.tipo === 'receber' ? 'ent' : 'sai'] += cent; continue; }
      quando = hoje;
    }
    if (quando > fim) continue;
    eventos.push({ ...l, data: quando, cent, convenio: conv, atrasado });
  }
  const porDia = {};
  for (const e of eventos) (porDia[e.data] ||= []).push(e);
  const out = []; let s = saldo, minimo = null, primeiroNegativo = null, entradas = 0, saidas = 0;
  for (let i = 0; i < dias; i++) {
    const d = somaDias(hoje, i), evs = porDia[d] || [];
    const ent = evs.filter((e) => e.tipo === 'receber').reduce((a, e) => a + e.cent, 0);
    const sai = evs.filter((e) => e.tipo !== 'receber').reduce((a, e) => a + e.cent, 0);
    const conv = evs.filter((e) => e.convenio).reduce((a, e) => a + e.cent, 0);
    s += ent - sai; entradas += ent; saidas += sai;
    const dia = { i, data: d, ent, sai, conv, saldo: s, eventos: evs };
    if (!minimo || s < minimo.saldo) minimo = { saldo: s, data: d, i };
    if (s < 0 && !primeiroNegativo) primeiroNegativo = { saldo: s, data: d, i };
    out.push(dia);
  }
  return { saldoInicial: saldo, dias: out, eventos, minimo, primeiroNegativo, entradas, saidas, fora, folego: saldo < 0 ? 0 : primeiroNegativo ? primeiroNegativo.i : null };
}

// Semanas de 7 dias a partir de hoje
export function semanas(proj) {
  const out = [];
  for (let i = 0; i < proj.dias.length; i += 7) {
    const ds = proj.dias.slice(i, i + 7);
    out.push({ de: ds[0].data, ate: ds.at(-1).data, ent: ds.reduce((a, d) => a + d.ent, 0), sai: ds.reduce((a, d) => a + d.sai, 0),
      saldo: ds.at(-1).saldo, eventos: ds.flatMap((d) => d.eventos) });
  }
  return out;
}

// Pontos de atenção por regra fixa (sem IA). Cada um: { nivel: 'alerta'|'pendente'|'info', texto, link }
export function pontosAtencao({ proj, recebs = [], horizonte }) {
  const p = [];
  if (proj.saldoInicial < 0) p.push({ nivel: 'alerta', texto: `O saldo de hoje já está negativo: ${brlC(proj.saldoInicial)}.`, link: 'financeiro-caixa' });
  else if (proj.primeiroNegativo) p.push({ nivel: 'alerta', texto: `O saldo fica negativo em ${dataBr(proj.primeiroNegativo.data)}: ${brlC(proj.primeiroNegativo.saldo)} (daqui a ${proj.primeiroNegativo.i} dia${proj.primeiroNegativo.i === 1 ? '' : 's'}). Menor saldo do período: ${brlC(proj.minimo.saldo)} em ${dataBr(proj.minimo.data)}.`, link: 'financeiro-caixa' });
  const saidas = proj.eventos.filter((e) => e.tipo !== 'receber');
  if (saidas.length) {
    const m = saidas.reduce((a, e) => (e.cent > a.cent ? e : a));
    p.push({ nivel: 'info', texto: `Maior saída dos próximos ${horizonte} dias: ${m.descricao} — ${brlC(m.cent)} em ${dataBr(m.data)}.`, link: 'financeiro-lancamentos-' + m.vencimento.slice(0, 7) });
  }
  const est = saidas.filter((e) => e.recorrencia === 'media' && !e.valor_confirmado);
  if (est.length) {
    const tot = est.reduce((a, e) => a + e.cent, 0), ex = est.slice(0, 3).map((e) => `${e.descricao} ${diaMes(e.data)}`).join(', ');
    p.push({ nivel: 'pendente', texto: `${est.length} despesa${est.length > 1 ? 's' : ''} prevista${est.length > 1 ? 's' : ''} pela média, sem valor confirmado: ${brlC(tot)} no período (${ex}${est.length > 3 ? '…' : ''}).`, link: 'financeiro-lancamentos-' + est[0].vencimento.slice(0, 7) });
  }
  const sem = recebs.filter((r) => !r.previsao);
  if (sem.length) p.push({ nivel: 'pendente', texto: `${sem.length} lote${sem.length > 1 ? 's' : ''} de convênio sem data prevista de pagamento, fora da curva: ${brlC(sem.reduce((a, r) => a + r.valor, 0))} (${sem.slice(0, 3).map((r) => `lote ${r.numero}`).join(', ')}).`, link: 'lotes' });
  const atr = recebs.filter((r) => r.atrasado);
  if (atr.length) p.push({ nivel: 'alerta', texto: `${atr.length} lote${atr.length > 1 ? 's' : ''} de convênio passou da data prevista sem baixa: ${brlC(atr.reduce((a, r) => a + r.valor, 0))}.`, link: 'lotes' });
  if (proj.fora.n) p.push({ nivel: 'info', texto: `${proj.fora.n} lançamento${proj.fora.n > 1 ? 's' : ''} vencido${proj.fora.n > 1 ? 's' : ''} e não baixado${proj.fora.n > 1 ? 's' : ''} ficou fora da curva: entradas ${brlC(proj.fora.ent)}, saídas ${brlC(proj.fora.sai)}.`, link: 'financeiro-lancamentos' });
  return p;
}

// CSV da projeção diária: separador ";", vírgula decimal, BOM UTF-8
const numCsv = (c) => { const a = Math.abs(c); return `${c < 0 ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`; };
export function csvProjecao(proj) {
  const linhas = [['Data', 'Entradas', 'Saídas', 'Entradas de convênio', 'Saldo projetado'].join(';')];
  for (const d of proj.dias) linhas.push([dataBr(d.data), numCsv(d.ent), numCsv(d.sai), numCsv(d.conv), numCsv(d.saldo)].join(';'));
  return '﻿' + linhas.join('\r\n') + '\r\n';
}

// Escala "bonita" para o eixo (centavos)
export function marcasEixo(lo, hi, n = 4) {
  const bruto = Math.max(1, (hi - lo) / n), p = 10 ** Math.floor(Math.log10(bruto)), f = bruto / p;
  const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p, out = [];
  for (let v = Math.floor(lo / passo) * passo; v <= Math.ceil(hi / passo) * passo + 1e-6; v += passo) out.push(Math.round(v));
  return out;
}

// ---------------- Tela ----------------
let core;
const hojeLocal = () => (typeof window !== 'undefined' && /^\d{4}-\d{2}-\d{2}$/.test(window.__HOJE || '') ? window.__HOJE : new Date().toLocaleDateString('sv'));
const HORIZONTES = [30, 60, 90], ATRASOS = [0, 15, 30, 45];
let aoRedimensionar = null;
if (typeof window !== 'undefined') window.addEventListener('resize', () => { clearTimeout(window.__pvT); window.__pvT = setTimeout(() => aoRedimensionar?.(), 150); });

// Busca todas as linhas (o Supabase devolve no máximo 1000 por vez)
async function todas(montar) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data: d, error } = await montar().range(i, i + 999);
    if (error) throw error;
    out.push(...d); if (d.length < 1000) return out;
  }
}

export async function render() {
  core ||= await import('../core.js');
  const { sb, estado, $, $$, esc, brl, tela, falha, podeGerir } = core;
  const reais = (c) => brl(c / 100);
  const c = tela('Previsão de caixa');
  if (!podeGerir()) {
    c.innerHTML = '<div class="cartao vazio"><strong>Tela da gestão.</strong><br>A previsão de caixa é só para os perfis gestor e financeiro.</div>';
    return;
  }
  const cid = estado.clinica.id, hoje = hojeLocal(), limite = somaDias(hoje, 89);
  let dados;
  try {
    const { data: carts, error: e0 } = await sb.from('carteiras').select('id, tipo, nome').eq('clinica_id', cid).eq('tipo', 'empresa');
    if (e0) throw e0;
    const emp = carts?.[0];
    if (!emp) { c.innerHTML = '<div class="cartao vazio">A carteira da empresa ainda não existe. Abra o Financeiro uma vez para criá-la.</div>'; return; }
    const [{ data: contas0, error: e1 }, { data: cats, error: e2 }, { data: lotes, error: e3 }] = await Promise.all([
      sb.from('contas_financeiras').select('id, nome, carteira_id, saldo_inicial, data_saldo_inicial, ativo').eq('clinica_id', cid).eq('ativo', true),
      sb.from('categorias_financeiras').select('id, nome').eq('clinica_id', cid),
      sb.from('lotes').select('id, numero_lote, competencia, status, data_envio, valor_total, previsto_pagamento, contrato_id, contratos(nome, operadoras(nome))')
        .eq('clinica_id', cid).in('status', ['enviado', 'protocolado', 'retornado']).not('data_envio', 'is', null),
    ]);
    if (e1 || e2 || e3) throw e1 || e2 || e3;
    // Só contas da empresa (sem carteira = antigas, tratadas como empresa, igual ao Financeiro)
    const contas = contas0.filter((k) => !k.carteira_id || k.carteira_id === emp.id);
    const desde = contas.map((k) => k.data_saldo_inicial).sort()[0] || hoje;
    const L = () => sb.from('lancamentos').select('id, tipo, status, descricao, categoria_id, conta_id, vencimento, valor_previsto, valor_realizado, data_realizado, origem, lote_id, contrato_id, recorrencia, valor_confirmado')
      .eq('clinica_id', cid).eq('carteira_id', emp.id);
    const ids = lotes.map((l) => l.id);
    const [pagos, previstos, lancsLote, linhasRet] = await Promise.all([
      contas.length ? todas(() => L().eq('status', 'pago').gte('data_realizado', desde).lte('data_realizado', hoje).order('id')) : [],
      todas(() => L().eq('status', 'previsto').lte('vencimento', limite).order('id')),
      ids.length ? todas(() => sb.from('lancamentos').select('lote_id, status, vencimento, valor_previsto').eq('clinica_id', cid).in('lote_id', ids).order('id')) : [],
      todas(() => sb.from('retorno_linhas').select('valor_informado, valor_glosa, classe').eq('clinica_id', cid).eq('classe', 'da_clinica').order('id')),
    ]);
    dados = { contas, cats: Object.fromEntries(cats.map((k) => [k.id, k.nome])), lotes, pagos, previstos, lancsLote, linhasRet };
  } catch (e) { return falha(e, 'Previsão de caixa'); }

  const sh = saldoHoje({ contas: dados.contas, lancamentos: dados.pagos, hoje });
  const recebs = recebiveis({ lotes: dados.lotes, lancsLote: dados.lancsLote, hoje });
  // Lote enviado sem lançamento "a receber" (não deveria acontecer): entra pela data prevista do lote
  const virtuais = recebs.filter((r) => r.semLancamento && r.previsao).map((r) => ({ id: 'lote-' + r.id, tipo: 'receber', status: 'previsto',
    descricao: `Lote ${r.numero} – ${r.contrato}`, vencimento: r.previsao, valor_previsto: r.valor / 100, origem: 'lote', lote_id: r.id }));
  const previstos = [...dados.previstos, ...virtuais];
  const glosaHist = taxaGlosa(dados.linhasRet);

  if (!dados.contas.length && !previstos.length && !recebs.length) {
    c.innerHTML = `<div class="cartao pv-vazio">
      <h3>A previsão aparece quando o Financeiro tiver dados</h3>
      <p class="muted">Aqui vai ficar a curva do saldo dos próximos 30, 60 e 90 dias, os convênios a receber e os dias de aperto. Para isso:</p>
      <ol class="pv-passos">
        <li><strong>Cadastre as contas da empresa</strong> em Financeiro → Contas e categorias, com o saldo do extrato e a data desse saldo.</li>
        <li><strong>Lance as contas a pagar e a receber</strong> que já conhece (aluguel, salários, impostos, particulares), com recorrência fixa ou pela média.</li>
        <li><strong>Registre o envio dos lotes TISS</strong> em Lotes TISS: cada lote enviado vira um "a receber" do convênio na data prevista.</li>
      </ol>
      <div class="linha-acoes" style="justify-content:flex-start"><a class="btn primario" href="#financeiro-cadastros">Abrir o Financeiro</a><a class="btn" href="#lotes">Lotes TISS</a></div></div>`;
    return;
  }

  const cen = { horizonte: 30, atraso: 0, glosa: glosaHist.pct, incluirAtrasados: true };
  const nAtrasados = dados.previstos.filter((l) => l.vencimento < hoje).length;
  $('#acoes-tela').innerHTML = '<button class="btn" id="pv-csv">Exportar CSV</button>';

  c.innerHTML = `
    ${!dados.contas.length ? '<div class="dica"><strong>Nenhuma conta da empresa cadastrada:</strong> a curva parte de R$ 0,00. Cadastre as contas com o saldo inicial em Financeiro → Contas e categorias.</div>' : ''}
    ${sh.semConta ? `<div class="dica"><strong>${sh.semConta} baixa(s) sem conta</strong> não entram no saldo de hoje. Edite no Financeiro e informe a conta.</div>` : ''}
    <div class="kpis" id="pv-kpis"></div>
    <div class="cartao pv-cenarios">
      <div class="pv-ctl"><span class="pv-rot">Convênios atrasam</span><div class="pv-chips" id="pv-atraso">${ATRASOS.map((d) => `<button type="button" class="chip-filtro${d === 0 ? ' on' : ''}" data-v="${d}">${d} dias</button>`).join('')}</div></div>
      <label class="pv-ctl pv-glosa"><span class="pv-rot">Glosa esperada</span><span class="pv-inp"><input type="number" id="pv-glosa" min="0" max="100" step="0.5" value="${glosaHist.pct}" inputmode="decimal"> %</span>
        <small class="muted">${glosaHist.temRetorno ? `Histórico dos retornos: ${esc(String(glosaHist.pct).replace('.', ','))}% (${esc(reais(glosaHist.glosa))} de ${esc(reais(glosaHist.informado))})` : 'Sem retorno importado ainda: começa em 0%.'}</small></label>
      <label class="pv-ctl pv-check"><input type="checkbox" id="pv-atr" checked> <span>Incluir atrasados${nAtrasados ? ` (${nAtrasados})` : ''}<small class="muted">Previstos vencidos e não baixados entram hoje; desmarcado, ficam fora.</small></span></label>
      <p class="muted pv-nota">Simulação: nada é gravado. Atraso e glosa valem só para os convênios (lotes TISS).</p>
    </div>
    <div class="cartao">
      <div class="pv-cab"><h3>Saldo projetado dia a dia</h3><div class="pv-chips" id="pv-hor">${HORIZONTES.map((h) => `<button type="button" class="chip-filtro${h === 30 ? ' on' : ''}" data-v="${h}">${h} dias</button>`).join('')}</div></div>
      <div class="pv-graf" id="pv-graf"></div>
      <div class="pv-legenda"><span><i class="pv-l-linha"></i>Saldo projetado</span><span><i class="pv-l-ponto"></i>Entrada de convênio</span><span><i class="pv-l-neg"></i>Abaixo de zero</span></div>
    </div>
    <div class="cartao" id="pv-pontos"></div>
    <div class="cartao" id="pv-receb"></div>
    <div class="cartao" id="pv-sem"></div>`;

  // Recebíveis (não dependem dos cenários)
  const grupos = agruparRecebiveis(recebs);
  $('#pv-receb').innerHTML = `<div class="pv-cab"><h3>Recebíveis dos convênios</h3><a href="#lotes" class="pv-link">Abrir Lotes TISS →</a></div>
    ${grupos.length ? `<div class="tabela-rolagem"><table class="pv-tab"><thead><tr><th>Lote</th><th>Competência</th><th>Envio</th><th class="num">Valor</th><th>Pagamento previsto</th><th class="num">Em análise</th></tr></thead>
      ${grupos.map((g) => `<tbody><tr class="pv-grupo"><td colspan="3"><strong>${esc(g.operadora)}</strong> <span class="muted">· ${g.itens.length} lote${g.itens.length > 1 ? 's' : ''}</span></td><td class="num"><strong>${esc(reais(g.total))}</strong></td><td colspan="2"></td></tr>
        ${g.itens.map((r) => `<tr><td><strong>${esc(r.numero)}</strong><div class="muted pv-peq">${esc(r.contrato)}</div></td><td>${esc(r.competencia ? r.competencia.slice(5, 7) + '/' + r.competencia.slice(0, 4) : '—')}</td>
          <td>${esc(dataBr(r.envio))}</td><td class="num">${esc(reais(r.valor))}</td>
          <td>${r.previsao ? esc(dataBr(r.previsao)) : '<span class="selo pendente">sem previsão</span>'} ${r.atrasado ? '<span class="selo alerta">atrasado</span>' : ''}</td>
          <td class="num">${r.emAnalise} dia${r.emAnalise === 1 ? '' : 's'}</td></tr>`).join('')}</tbody>`).join('')}
      <tfoot><tr><td colspan="3"><strong>Total a receber</strong></td><td class="num"><strong>${esc(reais(recebs.reduce((a, r) => a + r.valor, 0)))}</strong></td><td colspan="2"></td></tr></tfoot></table></div>
      <p class="muted pv-nota">Valor = previsto do lançamento do lote (valor informado, sem glosa). A curva desconta a glosa esperada.</p>`
    : '<div class="vazio">Nenhum lote enviado aguardando pagamento. Quando registrar o envio de um lote em Lotes TISS, ele aparece aqui com a data prevista.</div>'}`;

  let proj;
  function desenhar() {
    proj = projetar({ saldo: sh.total, lancamentos: previstos, dias: Math.max(30, cen.horizonte), cenarios: cen, hoje });
    const d30 = proj.dias.slice(0, 30), ent30 = d30.reduce((a, d) => a + d.ent, 0), sai30 = d30.reduce((a, d) => a + d.sai, 0);
    const neg = proj.folego !== null;
    $('#pv-kpis').innerHTML = `
      <div class="kpi${sh.total < 0 ? ' alerta' : ''}"><div class="rotulo">Saldo de hoje</div><div class="valor">${esc(reais(sh.total))}</div><div class="sub">${sh.porConta.length} conta${sh.porConta.length === 1 ? '' : 's'} da empresa</div></div>
      <div class="kpi"><div class="rotulo">Entradas previstas · 30 dias</div><div class="valor">${esc(reais(ent30))}</div><div class="sub">convênios: ${esc(reais(d30.reduce((a, d) => a + d.conv, 0)))}</div></div>
      <div class="kpi"><div class="rotulo">Saídas previstas · 30 dias</div><div class="valor">${esc(reais(sai30))}</div><div class="sub">saldo em 30 dias: ${esc(reais(d30.at(-1).saldo))}</div></div>
      <div class="kpi${proj.minimo.saldo < 0 ? ' alerta' : ''}"><div class="rotulo">Menor saldo · ${cen.horizonte} dias</div><div class="valor">${esc(reais(proj.minimo.saldo))}</div><div class="sub">em ${esc(dataBr(proj.minimo.data))}</div></div>
      <div class="kpi${neg ? ' alerta' : ''}"><div class="rotulo">Fôlego</div><div class="valor">${neg ? (proj.folego === 0 ? 'Já negativo' : `${proj.folego} dia${proj.folego === 1 ? '' : 's'}`) : 'Sem risco'}</div>
        <div class="sub">${neg ? (proj.folego === 0 ? 'o saldo de hoje está abaixo de zero' : `até o saldo ficar negativo (${esc(diaMes(proj.primeiroNegativo.data))})`) : `nos próximos ${cen.horizonte} dias`}</div></div>`;

    grafico($('#pv-graf'), proj.dias.slice(0, cen.horizonte));
    aoRedimensionar = () => { const g = $('#pv-graf'); if (g?.isConnected) grafico(g, proj.dias.slice(0, cen.horizonte)); else aoRedimensionar = null; };

    const pts = pontosAtencao({ proj: { ...proj, dias: proj.dias.slice(0, cen.horizonte) }, recebs, horizonte: cen.horizonte });
    $('#pv-pontos').innerHTML = `<h3>Pontos de atenção</h3>${pts.length ? `<ul class="pv-pontos">${pts.map((p) => `<li class="${p.nivel}"><span>${esc(p.texto)}</span>${p.link ? ` <a href="#${esc(p.link)}">ver</a>` : ''}</li>`).join('')}</ul>`
      : '<div class="vazio">Nada fora do normal no período: o saldo fica positivo e não há estimativas pendentes.</div>'}`;

    const sems = semanas({ dias: proj.dias.slice(0, cen.horizonte) });
    $('#pv-sem').innerHTML = `<h3>Semana a semana</h3><div class="tabela-rolagem"><table class="pv-tab pv-semanas"><thead><tr><th>Semana</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo final</th></tr></thead>
      ${sems.map((s, i) => `<tbody><tr class="${s.eventos.length ? 'clicavel' : ''}" data-sem="${i}"><td>${s.eventos.length ? '<span class="pv-seta">▸</span>' : '<span class="pv-seta"></span>'}${esc(diaMes(s.de))} – ${esc(diaMes(s.ate))}${s.eventos.length ? ` <span class="muted pv-peq">${s.eventos.length} lanç.</span>` : ''}</td>
        <td class="num">${esc(reais(s.ent))}</td><td class="num">${esc(reais(s.sai))}</td><td class="num"><strong class="${s.saldo < 0 ? 'pv-neg' : ''}">${esc(reais(s.saldo))}</strong></td></tr>
        <tr class="pv-det" hidden><td colspan="4"><table class="pv-sub">${s.eventos.map((e) => `<tr><td class="pv-d">${esc(diaMes(e.data))}</td>
          <td><a href="#financeiro-lancamentos-${esc(e.vencimento.slice(0, 7))}">${esc(e.descricao)}</a>${e.atrasado ? ' <span class="selo alerta">vencido</span>' : ''}${e.recorrencia === 'media' && !e.valor_confirmado ? ' <span class="selo pendente">estimado</span>' : ''}${e.convenio && (cen.glosa || cen.atraso) ? ' <span class="selo outra">cenário</span>' : ''}
          <div class="muted pv-peq">${esc(dados.cats[e.categoria_id] || (e.convenio ? 'Convênios' : 'Sem categoria'))}</div></td>
          <td class="num ${e.tipo === 'receber' ? 'pv-ent' : 'pv-sai'}">${e.tipo === 'receber' ? '+' : '−'} ${esc(reais(e.cent))}</td></tr>`).join('')}</table></td></tr></tbody>`).join('')}</table></div>`;
    $$('[data-sem]', $('#pv-sem')).forEach((tr) => (tr.onclick = () => {
      const det = tr.nextElementSibling; if (!det || !tr.classList.contains('clicavel')) return;
      det.hidden = !det.hidden; tr.querySelector('.pv-seta').textContent = det.hidden ? '▸' : '▾';
    }));
  }

  const chips = (id, chave) => $$(`#${id} [data-v]`).forEach((b) => (b.onclick = () => {
    cen[chave] = Number(b.dataset.v); $$(`#${id} [data-v]`).forEach((x) => x.classList.toggle('on', x === b)); desenhar(); }));
  chips('pv-atraso', 'atraso'); chips('pv-hor', 'horizonte');
  $('#pv-glosa').oninput = (e) => { const v = Number(String(e.target.value).replace(',', '.')); cen.glosa = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0; desenhar(); };
  $('#pv-atr').onchange = (e) => { cen.incluirAtrasados = e.target.checked; desenhar(); };
  $('#pv-csv').onclick = () => {
    const b = new Blob([csvProjecao({ dias: proj.dias.slice(0, cen.horizonte) })], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: `previsao-caixa-${hoje}-${cen.horizonte}d.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  desenhar();

  // ---------- Gráfico SVG próprio ----------
  function grafico(wrap, dias) {
    const W = Math.max(280, wrap.clientWidth || 600), estreito = W < 520, H = estreito ? 210 : 260;
    const m = { l: estreito ? 50 : 64, r: 10, t: 12, b: 26 }, n = dias.length;
    const vals = dias.map((d) => d.saldo).concat(sh.total, 0);
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) hi = lo + 100000;
    const marcas = marcasEixo(lo, hi, estreito ? 3 : 4); lo = marcas[0]; hi = marcas.at(-1);
    const x = (i) => m.l + (n <= 1 ? 0 : (i * (W - m.l - m.r)) / (n - 1)), y = (v) => m.t + ((hi - v) * (H - m.t - m.b)) / (hi - lo);
    const rotY = (cent) => { const r = cent / 100, a = Math.abs(r);
      return a >= 1000 ? `${r < 0 ? '−' : ''}${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: a >= 10000 ? 0 : 1 })} mil` : `${r < 0 ? '−' : ''}${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`; };
    const passoX = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - m.l - m.r) / (estreito ? 62 : 80)))));
    const pts = dias.map((d, i) => `${x(i).toFixed(1)},${y(d.saldo).toFixed(1)}`).join(' ');
    const z = y(0), uid = 'pv' + Math.random().toString(36).slice(2, 7);
    wrap.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="Saldo projetado para ${n} dias. Menor saldo ${esc(reais(Math.min(...dias.map((d) => d.saldo))))}.">
      <defs><clipPath id="${uid}n"><rect x="0" y="${z}" width="${W}" height="${Math.max(0, H - z)}"/></clipPath></defs>
      ${lo < 0 ? `<rect x="${m.l}" y="${z}" width="${W - m.l - m.r}" height="${H - m.b - z}" class="pv-faixa"/>` : ''}
      ${marcas.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'pv-zero' : 'pv-grade'}"/><text x="${m.l - 6}" y="${y(v) + 4}" class="pv-ey" text-anchor="end">${rotY(v)}</text>`).join('')}
      ${dias.map((d, i) => (i % passoX === 0 ? `<text x="${x(i)}" y="${H - 7}" class="pv-ex" text-anchor="${i === 0 ? 'start' : 'middle'}">${diaCurto(d.data)}</text>` : '')).join('')}
      <polyline points="${pts}" class="pv-linha"/>
      <polyline points="${pts}" class="pv-linha neg" clip-path="url(#${uid}n)"/>
      ${dias.map((d, i) => (d.conv ? `<circle cx="${x(i)}" cy="${y(d.saldo)}" r="4.5" class="pv-conv"/>` : '')).join('')}
      <g class="pv-mira" visibility="hidden"><line y1="${m.t}" y2="${H - m.b}" class="pv-mira-l"/><circle r="5" class="pv-mira-p"/></g>
      <rect x="${m.l - 8}" y="0" width="${W - m.l - m.r + 16}" height="${H}" fill="transparent" class="pv-alvo"/>
    </svg><div class="pv-tip" hidden></div>`;
    const svg = wrap.querySelector('svg'), mira = svg.querySelector('.pv-mira'), tip = wrap.querySelector('.pv-tip');
    const mostrar = (i) => {
      i = Math.max(0, Math.min(n - 1, i)); const d = dias[i]; svg._i = i;
      mira.setAttribute('visibility', 'visible'); mira.querySelector('line').setAttribute('x1', x(i)); mira.querySelector('line').setAttribute('x2', x(i));
      const p = mira.querySelector('circle'); p.setAttribute('cx', x(i)); p.setAttribute('cy', y(d.saldo));
      tip.hidden = false;
      tip.innerHTML = `<strong>${esc(dataBr(d.data))}</strong><div><span>Entradas</span><b>${esc(reais(d.ent))}</b></div>${d.conv ? `<div class="muted"><span>convênio</span><b>${esc(reais(d.conv))}</b></div>` : ''}
        <div><span>Saídas</span><b>${esc(reais(d.sai))}</b></div><div class="pv-tip-s"><span>Saldo</span><b class="${d.saldo < 0 ? 'pv-neg' : ''}">${esc(reais(d.saldo))}</b></div>`;
      const tw = tip.offsetWidth, left = x(i) + 12 + tw > W ? x(i) - 12 - tw : x(i) + 12;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = Math.max(0, Math.min(H - tip.offsetHeight, y(d.saldo) - tip.offsetHeight / 2)) + 'px';
    };
    const esconder = () => { mira.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    const indice = (ev) => { const r = svg.getBoundingClientRect(); return Math.round(((ev.clientX - r.left - m.l) / (W - m.l - m.r)) * (n - 1)); };
    svg.addEventListener('pointermove', (ev) => mostrar(indice(ev)));
    svg.addEventListener('pointerdown', (ev) => mostrar(indice(ev)));
    svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') esconder(); });
    svg.addEventListener('blur', esconder);
    svg.addEventListener('keydown', (ev) => { if (!/Arrow(Left|Right)|Home|End/.test(ev.key)) return; ev.preventDefault();
      const i = svg._i ?? -1; mostrar(ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : i + (ev.key === 'ArrowRight' ? 1 : -1)); });
  }
}
