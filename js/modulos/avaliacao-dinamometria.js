// Avaliação por dinamometria (modelo "dinamometria", db/054, 15/11/2026): preensão palmar (EWGSOP2/AWGS2, MDC por aparelho) +
// dinamometria isométrica segmentar com assimetria entre membros, LSI do lado acometido, relação I/Q e mapa corporal.
// Estado em conteudo.dina; o painel escreve o texto nos campos preensao/segmentar/conclusao (texto digitado não é apagado, igual ao SAPO).
// laudoDina() monta o laudo premium timbrado (A4) com KPIs, barras D/E, mapa corporal e comparação com a avaliação anterior.
import { esc, data, falha } from '../core.js';
import { corpo, MUSCULOS, PROFUNDOS } from './anatomia.js';

const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const f1 = (n, d = 1) => (n == null ? '—' : n.toFixed(d).replace('.', ','));
const pct = (n) => (n == null ? '—' : Math.round(n) + '%');
const LADO = { D: 'direita', E: 'esquerda' }, LADO_M = { D: 'direito', E: 'esquerdo' };

// MDC95 (kg) por aparelho, mão dominante / não dominante — Akgün et al., BMC Sports Sci Med Rehabil (2026).
export const EQUIP_GRIP = [
  ['jamar', 'Jamar hidráulico', null], ['jamar_dig', 'Jamar digital', null],
  ['kforce', 'K-Force Grip', [4.53, 3.77]], ['jtech', 'JTech Commander Echo Grip', [5.87, 4.63]],
  ['gripable', 'GripAble', [5.86, 4.02]], ['outro', 'Outro dinamômetro', null]];
const MDC_CONSERV = 5.87;   // sem MDC próprio do aparelho: usa o maior MDC95 publicado entre os digitais (conservador)
const EQUIP_SEG = ['K-Force Muscle Controller', 'Dinamômetro manual (HHD)', 'Célula de carga fixa (tração)', 'Outro'];

// [chave, nome, região do mapa, vista F=anterior B=posterior]
export const MOV = [
  ['Tornozelo', [['tz_df', 'Flexão dorsal', 'tib', 'F'], ['tz_fp', 'Flexão plantar', 'calf', 'B'], ['tz_inv', 'Inversão', 'tibpost', 'B'], ['tz_ev', 'Eversão', 'fib', 'F']]],
  ['Joelho', [['jo_ext', 'Extensão', 'quad', 'F'], ['jo_flex', 'Flexão', 'ham', 'B']]],
  ['Quadril', [['qd_flex', 'Flexão', 'hipflex', 'F'], ['qd_ext', 'Extensão', 'glut', 'B'], ['qd_abd', 'Abdução', 'gmed', 'B'], ['qd_adu', 'Adução', 'add', 'F'],
    ['qd_ri', 'Rotação interna', 'gmed', 'B'], ['qd_re', 'Rotação externa', 'glut', 'B']]],
  ['Ombro', [['om_flex', 'Flexão', 'delt', 'F'], ['om_abd', 'Abdução', 'delt', 'B'], ['om_ri', 'Rotação interna', 'cuff', 'B'], ['om_re', 'Rotação externa', 'cuff', 'B']]],
  ['Cotovelo', [['co_flex', 'Flexão', 'bic', 'F'], ['co_ext', 'Extensão', 'tri', 'B']]],
];
const MOVS = Object.fromEntries(MOV.flatMap(([art, l]) => l.map(([k, nome, reg, vista]) => [k, { k, art, nome, reg, vista }])));
const ORDEM = MOV.flatMap(([, l]) => l.map(([k]) => k));

// Assimetria = (maior − menor) / maior × 100 (Parkinson et al., 2021); faixas do relatório: < 10 leve, 10–15 moderada, ≥ 15 alta
export function assim(d, e) {
  if (!d || !e) return null;
  const mx = Math.max(d, e);
  return { pct: ((mx - Math.min(d, e)) / mx) * 100, fraco: d < e ? 'D' : d > e ? 'E' : '' };
}
export const classe = (p) => (p == null ? null : Math.round(p) <= 10 ? 'leve' : Math.round(p) < 15 ? 'moderada' : 'alta');   // classifica pelo % exibido (arredondado)
const COR = { leve: '#2F7A4E', moderada: '#E39A1F', alta: '#B5412F' };
const COR_CLARA = { leve: '#E4F1E8', moderada: '#FCEFD6', alta: '#F8E5E1' };
const NOME_CL = { leve: 'Leve', moderada: 'Moderada', alta: 'Alta' };

export function idade(nasc, ref) {
  if (!nasc) return null;
  const a = new Date(nasc + 'T12:00'), b = ref ? new Date(ref + 'T12:00') : new Date();
  return b.getFullYear() - a.getFullYear() - (b < new Date(b.getFullYear(), a.getMonth(), a.getDate()) ? 1 : 0);
}

// ---------- cálculos ----------
export function calcGrip(st, ctx) {
  if (!st.testes?.grip) return null;
  const g = st.g || {}, d = (g.d || []).map(num).filter(Boolean), e = (g.e || []).map(num).filter(Boolean);
  if (!d.length && !e.length) return null;
  const med = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const mxD = d.length ? Math.max(...d) : null, mxE = e.length ? Math.max(...e) : null;
  const max = Math.max(mxD || 0, mxE || 0);
  const sx = String(ctx.sexo || '').toUpperCase()[0];
  const cut = sx === 'M' ? { ew: 27, aw: 28 } : sx === 'F' ? { ew: 16, aw: 18 } : null;
  const peso = ctx.peso?.();
  const eq = EQUIP_GRIP.find(([k]) => k === st.eq_grip);
  const r = { mxD, mxE, mdD: med(d), mdE: med(e), max, lado: mxD >= (mxE || 0) ? 'D' : 'E', cut,
    ew: cut ? max < cut.ew : null, aw: cut ? max < cut.aw : null, as: assim(mxD, mxE), rel: peso ? max / peso : null,
    eqNome: eq?.[1] || 'dinamômetro', mdc: eq?.[2]?.[0] || MDC_CONSERV, mdcProprio: !!eq?.[2] };
  if (st.dom && r.as && r.as.fraco === st.dom) r.domFraca = true;
  const ant = ctx.anterior?.dina, ag = ant ? calcGrip(ant, { ...ctx, anterior: null }) : null;
  if (ag) r.ant = { max: ag.max, data: ctx.anterior.data, delta: max - ag.max, mesmoAparelho: (ant.eq_grip || '') === (st.eq_grip || '') };
  return r;
}

export function calcSeg(st, ctx) {
  if (!st.testes?.seg) return { rows: [], hq: {} };
  const peso = ctx.peso?.(), antSeg = ctx.anterior?.dina?.seg || {};
  const rows = ORDEM.filter((k) => (st.sel || []).includes(k)).map((k) => {
    const v = st.seg?.[k] || {}, d = num(v.d), e = num(v.e), as = assim(d, e);
    const lsi = st.acom && d && e ? Math.round((st.acom === 'D' ? d / e : e / d) * 100) : null;
    const aD = num(antSeg[k]?.d), aE = num(antSeg[k]?.e);
    return { ...MOVS[k], d, e, as, cls: classe(as?.pct), lsi, relD: peso && d ? d / peso : null, relE: peso && e ? e / peso : null,
      aD, aE, dD: aD && d ? ((d - aD) / aD) * 100 : null, dE: aE && e ? ((e - aE) / aE) * 100 : null };
  });
  const ext = st.seg?.jo_ext || {}, fl = st.seg?.jo_flex || {}, hq = {};
  if ((st.sel || []).includes('jo_ext') && (st.sel || []).includes('jo_flex'))
    for (const s of ['d', 'e']) if (num(ext[s]) && num(fl[s])) hq[s.toUpperCase()] = (num(fl[s]) / num(ext[s])) * 100;
  return { rows, hq };
}

// ---------- texto para os campos ----------
export function gerar(st, ctx) {
  const G = calcGrip(st, ctx), S = calcSeg(st, ctx), out = { preensao: '', segmentar: '', conclusao: '' };
  const id = ctx.idade;
  if (G) {
    const t = (k) => (st.g?.[k] || []).map((x) => (num(x) ? f1(num(x)) : '—')).join(' / ');
    const L = [`Dinamômetro: ${G.eqNome} (kgf), 2ª posição da empunhadura; protocolo ASHT, 3 tentativas alternadas por mão.${st.dom ? ` Mão dominante: ${LADO[st.dom]}.` : ''}`];
    if (G.mxD) L.push(`Direita: ${t('d')} → máx. ${f1(G.mxD)} kgf (média ${f1(G.mdD)}).`);
    if (G.mxE) L.push(`Esquerda: ${t('e')} → máx. ${f1(G.mxE)} kgf (média ${f1(G.mdE)}).`);
    L.push(`Força de preensão máxima: ${f1(G.max)} kgf (mão ${G.lado})${G.rel ? ` · ${f1(G.rel, 2)} kgf/kg de massa corporal` : ''}.`
      + (G.as ? ` Assimetria D×E: ${pct(G.as.pct)}${G.as.pct > 10 ? ` (> 10%, menor à ${LADO[G.as.fraco]})` : ' (≤ 10%)'}.` : ''));
    if (G.domFraca) L.push('Mão dominante mais fraca que a não dominante — achado incomum, correlacionar com a queixa.');
    if (G.cut) L.push(`EWGSOP2 (< ${G.cut.ew} kgf): ${G.ew ? 'força REDUZIDA — sarcopenia provável/dinapenia' : 'força preservada'}. AWGS2 (< ${G.cut.aw} kgf): ${G.aw ? 'reduzida' : 'preservada'}.`
      + (id != null && id < 60 ? ' Pontos de corte validados em idosos; em adultos < 60 anos, usar como sinal de alerta e acompanhar a evolução.' : ''));
    else L.push('Sexo não informado no cadastro: classificação EWGSOP2/AWGS2 não aplicada.');
    if (G.ant) L.push(G.ant.mesmoAparelho
      ? `Comparação com ${G.ant.data}: ${f1(G.ant.max)} → ${f1(G.max)} kgf (${G.ant.delta >= 0 ? '+' : ''}${f1(G.ant.delta)} kgf); MDC95 ${G.mdcProprio ? 'do aparelho' : 'conservador'} ${f1(G.mdc)} kgf → ${Math.abs(G.ant.delta) >= G.mdc ? 'mudança real (acima do erro de medida)' : 'variação dentro do erro de medida'}.`
      : `Avaliação anterior (${G.ant.data}) feita com outro dinamômetro: valores absolutos não são intercambiáveis entre aparelhos.`);
    out.preensao = L.join('\n');
  }
  const R = S.rows.filter((r) => r.d || r.e);
  if (R.length) {
    const L = [`Dinamometria isométrica (${st.eq_seg || 'dinamômetro manual'}), em kgf, melhor de 3 tentativas por lado.${st.acom ? ` Lado acometido: ${LADO_M[st.acom]}.` : ''}`];
    for (const r of R) L.push(`${r.art} — ${r.nome.toLowerCase()}: D ${f1(r.d)} / E ${f1(r.e)} kgf`
      + (r.as ? ` · assimetria ${pct(r.as.pct)} (${NOME_CL[r.cls].toLowerCase()}${r.as.fraco && r.cls !== 'leve' ? `, déficit à ${r.as.fraco}` : ''})` : '')
      + (r.lsi != null ? ` · LSI ${pct(r.lsi)}` : '') + '.');
    if (S.hq.D || S.hq.E) L.push(`Relação flexores/extensores do joelho (isométrica): ${S.hq.D ? 'D ' + pct(S.hq.D) : ''}${S.hq.D && S.hq.E ? ' · ' : ''}${S.hq.E ? 'E ' + pct(S.hq.E) : ''}.`);
    out.segmentar = L.join('\n');
  }
  const C = [];
  if (G?.cut) C.push(G.ew ? `Força de preensão palmar reduzida (${f1(G.max)} kgf; EWGSOP2), compatível com sarcopenia provável/dinapenia. Confirmar com massa muscular (BIA/DXA) e desempenho físico (velocidade de marcha, SPPB, TUG ou levantar da cadeira).`
    : `Força de preensão palmar preservada (${f1(G.max)} kgf; EWGSOP2${G.aw ? ', porém abaixo do corte AWGS2' : ''}).`);
  const grupo = (cl) => R.filter((r) => r.cls === cl).map((r) => `${r.nome.toLowerCase()} de ${r.art.toLowerCase()}${r.as?.fraco ? ` (${r.as.fraco})` : ''}`);
  const alta = grupo('alta'), mod = grupo('moderada');
  if (alta.length) C.push(`Assimetria alta (≥ 15%): ${alta.join(', ')}.`);
  if (mod.length) C.push(`Assimetria moderada (11–14%): ${mod.join(', ')}.`);
  if (R.length && !alta.length && !mod.length) C.push('Todos os movimentos testados com assimetria ≤ 10%.');
  else if (R.length && R.some((r) => r.cls === 'leve')) C.push('Demais movimentos com assimetria ≤ 10%.');
  const lsiBaixo = R.filter((r) => r.lsi != null && r.lsi < 90);
  if (lsiBaixo.length) C.push(`LSI < 90% no lado acometido: ${lsiBaixo.map((r) => `${r.nome.toLowerCase()} de ${r.art.toLowerCase()} (${pct(r.lsi)})`).join(', ')} — abaixo do critério usual de retorno ao esporte.`);
  out.conclusao = C.join('\n');
  return out;
}

// ---------- mapa corporal: atlas anatômico próprio (anatomia.js) + camada de dados ----------
// Vista anterior: D do paciente à esquerda de quem olha; posterior: D à direita. Cor = pior classe entre os movimentos que usam o músculo;
// lado mais forte fica mais claro; músculo profundo aparece tracejado (projeção). Rótulos só na vista principal do movimento.
const ORD_CL = { leve: 1, moderada: 2, alta: 3 };

export function mapaSvg(rows, grip, sexo) {
  const itens = rows.filter((r) => r.d || r.e).map((r) => ({ k: r.k, vista: r.vista, nome: r.nome, art: r.art, d: r.d, e: r.e, cls: r.cls, fraco: r.as?.fraco, pct: r.as?.pct }));
  if (grip && (grip.mxD || grip.mxE)) itens.push({ k: 'grip', vista: 'F', nome: 'Preensão palmar', art: '', d: grip.mxD, e: grip.mxE, cls: classe(grip.as?.pct), fraco: grip.as?.fraco, pct: grip.as?.pct });
  const OX = 120, W = 440, H = 446, TOPO = 16, ABV = { Tornozelo: 'tornoz.', Joelho: 'joelho', Quadril: 'quadril', Ombro: 'ombro', Cotovelo: 'cotov.' };
  const vista = (vk, x0) => {
    const ladoDe = { esq: vk === 'F' ? 'D' : 'E', dir: vk === 'F' ? 'E' : 'D' };
    const pint = {};
    for (const it of itens) for (const m of MUSCULOS[it.k]?.[vk] || []) {
      const at = pint[m]; if (at && (ORD_CL[at.cls] || 0) >= (ORD_CL[it.cls] || 0)) continue;
      pint[m] = { cor: COR[it.cls] || '#8A9196', cls: it.cls,
        op: { esq: it.fraco && it.fraco !== ladoDe.esq ? 0.42 : 1, dir: it.fraco && it.fraco !== ladoDe.dir ? 0.42 : 1 } };
    }
    const c = corpo(vk, sexo, pint);
    const rotulos = (pos) => {
      const ld = ladoDe[pos].toLowerCase();
      const L = itens.filter((it) => it.vista === vk && it[ld]).map((it) => {
        const m0 = (MUSCULOS[it.k]?.[vk] || [])[0], a = m0 && c.ancora(m0, pos);
        return a ? { ...it, prof: PROFUNDOS.has(m0), ax: x0 + OX + a[0], ay: TOPO + a[1] } : null;
      }).filter(Boolean).sort((a, b) => a.ay - b.ay);
      let ult = -1e9; L.forEach((l) => { l.ty = Math.max(l.ay, ult + 25, 40); ult = l.ty; });
      const exc = L.length ? Math.max(0, L[L.length - 1].ty - (H - 8)) : 0;
      if (exc) { L.forEach((l) => (l.ty -= exc)); for (let i = 0; i < L.length - 1; i++) if (L[i + 1].ty - L[i].ty < 25) L[i + 1].ty = L[i].ty + 25; }
      const esq = pos === 'esq', tx = esq ? x0 + 112 : x0 + W - 112, an = esq ? 'end' : 'start';
      return L.map((l) => {
        const cor = COR[l.cls] || '#3B4146', lx = esq ? tx + 3 : tx - 3;
        return `<path d="M${lx},${l.ty - 3} L${esq ? lx + 6 : lx - 6},${l.ty - 3} L${r2(l.ax)},${r2(l.ay)}" fill="none" stroke="#7E8682" stroke-width=".55"/>
          <circle cx="${r2(l.ax)}" cy="${r2(l.ay)}" r="1.9" fill="#fff" stroke="${cor}" stroke-width="1"/>
          <text x="${tx}" y="${l.ty - 1}" text-anchor="${an}" font-size="11" font-weight="700" fill="${cor}">${esq && l.pct != null ? `<tspan font-size="8">${pct(l.pct)}  </tspan>` : ''}${f1(l[ld])} kgf${!esq && l.pct != null ? `<tspan font-size="8">  ${pct(l.pct)}</tspan>` : ''}</text>
          <text x="${tx}" y="${l.ty + 8.5}" text-anchor="${an}" font-size="7.6" fill="#5E666B">${esc(l.nome)}${l.art ? ' · ' + esc(ABV[l.art] || l.art.toLowerCase()) : ''}${l.prof ? ' (prof.)' : ''}</text>`;
      }).join('');
    };
    return `<g><text x="${x0 + W / 2}" y="11" text-anchor="middle" font-size="9" font-weight="700" fill="#8A9196" letter-spacing="1.6">${vk === 'F' ? 'VISTA ANTERIOR' : 'VISTA POSTERIOR'}</text>
      <text x="${x0 + OX + 8}" y="34" font-size="15" font-weight="700" fill="#B9BFBB">${ladoDe.esq}</text><text x="${x0 + OX + 192}" y="34" text-anchor="end" font-size="15" font-weight="700" fill="#B9BFBB">${ladoDe.dir}</text>
      <g transform="translate(${x0 + OX} ${TOPO})">${c.svg}</g>${rotulos('esq')}${rotulos('dir')}</g>`;
  };
  return `<svg viewBox="0 0 ${W * 2} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Barlow, Arial, sans-serif" role="img" aria-label="Atlas anatômico com força e assimetria por músculo">
    ${vista('F', 0)}${vista('B', W)}</svg>`;
}
const r2 = (n) => Math.round(n * 10) / 10;

// ---------- painel no editor ----------
export function montarDina(alvo, form, st, ctx = {}) {
  st.testes ||= { grip: true, seg: ctx.area === 'fisioterapia' };
  st.g ||= { d: ['', '', ''], e: ['', '', ''] }; st.seg ||= {}; st.sel ||= []; st._g ||= {};
  st.eq_grip ||= 'jamar'; st.eq_seg ||= EQUIP_SEG[0];
  ctx.peso = () => num(form.elements.m_peso?.value);

  const aplicar = () => {
    const out = gerar(st, ctx);
    for (const [k, txt] of Object.entries(out)) {
      const el = form.elements['c_' + k]; if (!el) continue;
      const novo = txt || '', prev = st._g[k] || '', cur = el.value;
      if (!cur.trim() || cur === prev) el.value = novo;
      else if (prev && cur.includes(prev)) el.value = (novo ? cur.replace(prev, novo) : cur.replace(prev, '')).trim();
      else if (novo) el.value = cur.replace(/\s*$/, '') + '\n' + novo;
      st._g[k] = novo;
    }
  };
  const chip = (attr, val, on, rot) => `<button type="button" class="ck${on ? ' on' : ''}" ${attr}="${esc(val)}">${rot}</button>`;
  const ent = (attr, val) => `<input class="dn-in" inputmode="decimal" ${attr} value="${esc(val ?? '')}" placeholder="kgf">`;

  const tela = () => {
    alvo.innerHTML = `
      <div class="dn-topo"><span class="ck-rot">Testes</span><div class="ck-ops">${chip('data-t', 'grip', st.testes.grip, 'Preensão palmar')}${chip('data-t', 'seg', st.testes.seg, 'Segmentar (por movimento)')}</div>
        <span class="ck-rot">Lado acometido</span><div class="ck-ops">${chip('data-acom', 'D', st.acom === 'D', 'Direito')}${chip('data-acom', 'E', st.acom === 'E', 'Esquerdo')}${chip('data-acom', '', !st.acom, 'Nenhum / bilateral')}</div>
        ${ctx.anterior ? `<button type="button" class="btn pequeno" data-copiar>↻ Mesmos testes da avaliação de ${esc(ctx.anterior.data)}</button>` : ''}</div>
      ${st.testes.grip ? `<fieldset class="ck-bloco"><legend>Preensão palmar</legend>
        <div class="dn-linha"><label>Dinamômetro <select data-k="eq_grip">${EQUIP_GRIP.map(([k, n]) => `<option value="${k}" ${k === st.eq_grip ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <span class="ck-rot">Mão dominante</span><div class="ck-ops">${chip('data-dom', 'D', st.dom === 'D', 'Direita')}${chip('data-dom', 'E', st.dom === 'E', 'Esquerda')}</div></div>
        <table class="dn-tab"><tr><th></th><th>1ª</th><th>2ª</th><th>3ª</th><th>Máx.</th></tr>
          ${['d', 'e'].map((s) => `<tr><th>${s === 'd' ? 'Direita' : 'Esquerda'}</th>${[0, 1, 2].map((i) => `<td>${ent(`data-g="${s}${i}"`, st.g[s][i])}</td>`).join('')}<td class="dn-max" data-o="mx${s}"></td></tr>`).join('')}
        </table><div class="dn-res" data-o="grip"></div>
        <small class="muted">Sentado, ombro aduzido, cotovelo a 90°, antebraço e punho neutros; 3–5 s de contração, 30–60 s de repouso; alternar as mãos. Usar sempre o mesmo aparelho nas reavaliações.</small></fieldset>` : ''}
      ${st.testes.seg ? `<fieldset class="ck-bloco"><legend>Dinamometria segmentar (isométrica)</legend>
        <div class="dn-linha"><label>Equipamento <select data-k="eq_seg">${EQUIP_SEG.map((n) => `<option ${n === st.eq_seg ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
        ${MOV.map(([art, l]) => `<div class="dn-art"><span class="ck-rot">${art}</span><div class="ck-ops">${l.map(([k, n]) => chip('data-mov', k, st.sel.includes(k), n)).join('')}</div></div>`).join('')}
        ${st.sel.length ? `<table class="dn-tab dn-seg"><tr><th>Movimento</th><th>Direito</th><th>Esquerdo</th><th>Assimetria</th></tr>
          ${ORDEM.filter((k) => st.sel.includes(k)).map((k) => `<tr><th>${esc(MOVS[k].art)} · ${esc(MOVS[k].nome.toLowerCase())}</th>
            <td>${ent(`data-s="${k}.d"`, st.seg[k]?.d)}</td><td>${ent(`data-s="${k}.e"`, st.seg[k]?.e)}</td><td data-as="${k}"></td></tr>`).join('')}</table>
          <div class="dn-res" data-o="hq"></div>` : '<p class="muted">Escolha os movimentos testados acima.</p>'}
        <small class="muted">Teste isométrico "make" de 3–5 s com estabilização do segmento; melhor de 3 tentativas por lado; mesma posição e braço de alavanca nas reavaliações.</small></fieldset>` : ''}
      <div class="dn-mapa" data-o="mapa"></div>
      <div class="dn-leg">${Object.keys(COR).map((c) => `<span><i style="background:${COR[c]}"></i>${NOME_CL[c]} ${c === 'leve' ? '≤ 10%' : c === 'moderada' ? '11–14%' : '≥ 15%'}</span>`).join('')}
        <button type="button" class="btn pequeno primario" data-laudo-dn>🖨 Laudo premium</button></div>`;
    atualizar();
  };

  const atualizar = () => {
    const G = calcGrip(st, ctx), S = calcSeg(st, ctx);
    const o = (k) => alvo.querySelector(`[data-o="${k}"]`);
    if (o('mxd')) o('mxd').textContent = G?.mxD ? f1(G.mxD) : '—';
    if (o('mxe')) o('mxe').textContent = G?.mxE ? f1(G.mxE) : '—';
    if (o('grip')) o('grip').innerHTML = G ? `<b>Máx. ${f1(G.max)} kgf</b>${G.rel ? ` · ${f1(G.rel, 2)} kgf/kg` : ''}${G.as ? ` · assimetria ${pct(G.as.pct)}` : ''}
      ${G.cut ? `<span class="dn-selo ${G.ew ? 'ruim' : 'bom'}">EWGSOP2: ${G.ew ? 'reduzida' : 'preservada'}</span><span class="dn-selo ${G.aw ? 'ruim' : 'bom'}">AWGS2: ${G.aw ? 'reduzida' : 'preservada'}</span>` : '<span class="dn-selo">sexo não informado</span>'}
      ${G.ant ? `<span class="dn-selo">${G.ant.mesmoAparelho ? `vs ${esc(G.ant.data)}: ${G.ant.delta >= 0 ? '+' : ''}${f1(G.ant.delta)} kgf (MDC ${f1(G.mdc)})` : 'anterior: outro aparelho'}</span>` : ''}` : '';
    S.rows.forEach((r) => {
      const c = alvo.querySelector(`[data-as="${r.k}"]`); if (!c) return;
      c.innerHTML = r.as ? `<span class="dn-pct" style="background:${COR_CLARA[r.cls]};color:${COR[r.cls]}">${pct(r.as.pct)}${r.as.fraco && r.cls !== 'leve' ? ' ↓' + r.as.fraco : ''}</span>${r.lsi != null ? ` <small>LSI ${pct(r.lsi)}</small>` : ''}` : '';
    });
    if (o('hq')) o('hq').innerHTML = S.hq.D || S.hq.E ? `Relação I/Q isométrica: ${S.hq.D ? 'D ' + pct(S.hq.D) : ''} ${S.hq.E ? '· E ' + pct(S.hq.E) : ''}` : '';
    o('mapa').innerHTML = S.rows.some((r) => r.d || r.e) || G ? mapaSvg(S.rows, G, ctx.sexo) : '';
    aplicar();
  };

  alvo.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b || !alvo.contains(b)) return;
    if (b.dataset.t) st.testes[b.dataset.t] = !st.testes[b.dataset.t];
    else if (b.dataset.acom !== undefined) st.acom = b.dataset.acom || '';
    else if (b.dataset.dom) st.dom = st.dom === b.dataset.dom ? '' : b.dataset.dom;
    else if (b.dataset.mov) { const k = b.dataset.mov; st.sel = st.sel.includes(k) ? st.sel.filter((x) => x !== k) : [...st.sel, k]; }
    else if (b.hasAttribute('data-copiar')) {
      const a = ctx.anterior.dina || {};
      Object.assign(st, { testes: { ...a.testes }, sel: [...(a.sel || [])], eq_grip: a.eq_grip || st.eq_grip, eq_seg: a.eq_seg || st.eq_seg, dom: a.dom || st.dom, acom: a.acom ?? st.acom });
    } else if (b.hasAttribute('data-laudo-dn')) return ctx.aoLaudo?.();
    else return;
    tela();
  });
  alvo.addEventListener('input', (ev) => {
    const i = ev.target;
    if (i.dataset.g) st.g[i.dataset.g[0]][+i.dataset.g[1]] = i.value;
    else if (i.dataset.s) { const [k, s] = i.dataset.s.split('.'); (st.seg[k] ||= {})[s] = i.value; }
    else if (i.dataset.k) st[i.dataset.k] = i.value;
    else return;
    atualizar();
  });
  alvo.addEventListener('change', (ev) => { if (ev.target.dataset.k) { st[ev.target.dataset.k] = ev.target.value; atualizar(); } });
  form.elements.m_peso?.addEventListener('input', atualizar);
  tela();
  return { estado: () => {
    const s = structuredClone(st);
    for (const k of Object.keys(s.seg)) if (!s.sel.includes(k)) delete s.seg[k];
    return calcGrip(s, ctx) || s.sel.length ? s : null;
  } };
}

// ---------- laudo premium ----------
export function laudoDina(p, r, me, anterior) {
  const j = window.open('', '_blank'); if (!j) return falha('Permita pop-ups deste site para imprimir.');
  const c = r.conteudo || {}, st = c.dina || {}, med = c.medidas || {};
  const peso = num(med.peso), alt = num(med.altura), imc = peso && alt ? peso / (alt / 100) ** 2 : null;
  const ctx = { sexo: p.sexo, idade: idade(p.data_nascimento, r.data_registro), peso: () => peso, anterior };
  const G = calcGrip(st, ctx), S = calcSeg(st, ctx), R = S.rows.filter((x) => x.d || x.e);
  const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  const pior = R.filter((x) => x.as).sort((a, b) => b.as.pct - a.as.pct)[0];
  const sexoTxt = { M: 'Masculino', F: 'Feminino' }[String(p.sexo || '').toUpperCase()[0]] || '—';
  const chipCl = (cl, t) => `<span class="pc" style="background:${COR_CLARA[cl]};color:${COR[cl]}">${t}</span>`;
  const bloco = (rot, t) => (t && String(t).trim() ? `<section class="sec"><h2>${esc(rot)}</h2><div class="txt">${esc(t)}</div></section>` : '');
  const kpi = (rot, val, sub, cor) => `<div class="kpi"><small>${rot}</small><b style="${cor ? 'color:' + cor : ''}">${val}</b><span>${sub || '&nbsp;'}</span></div>`;
  const barra = (lado, v, mx, fraco) => `<div class="br"><em>${lado}</em><i style="width:${mx ? Math.max(6, (v / mx) * 100) : 0}%;background:${fraco === lado ? '#F8781D' : '#3B4146'}"></i><span>${f1(v)} kgf</span></div>`;
  const porArt = MOV.map(([art]) => [art, R.filter((x) => x.art === art)]).filter(([, l]) => l.length);
  const temAnt = R.some((x) => x.aD || x.aE);
  const kpis = [
    G ? kpi('Preensão palmar máx.', `${f1(G.max)} <small>kgf</small>`, G.cut ? (G.ew ? 'Reduzida · EWGSOP2' : 'Preservada · EWGSOP2') : `mão ${G.lado}`, G.cut ? (G.ew ? COR.alta : COR.leve) : '') : '',
    G?.as ? kpi('Assimetria da preensão', pct(G.as.pct), G.as.pct > 10 ? `menor à ${LADO[G.as.fraco]}` : 'dentro de 10%', G.as.pct > 10 ? COR.moderada : COR.leve) : '',
    pior ? kpi('Maior assimetria segmentar', pct(pior.as.pct), `${pior.nome} · ${pior.art.toLowerCase()}${pior.as.fraco ? ' (' + pior.as.fraco + ')' : ''}`, COR[pior.cls]) : '',
    R.length ? kpi('Movimentos testados', R.length, `${R.filter((x) => x.cls === 'alta').length} com assimetria alta`) : '',
    st.acom && R.some((x) => x.lsi != null) ? kpi('LSI médio (lado acometido)', pct(R.filter((x) => x.lsi != null).reduce((s, x) => s + x.lsi, 0) / R.filter((x) => x.lsi != null).length), `lado ${LADO_M[st.acom]} · meta ≥ 90%`) : '',
    S.hq.D || S.hq.E ? kpi('Relação I/Q (isométrica)', `${S.hq.D ? pct(S.hq.D) : '—'} <small>D</small> · ${S.hq.E ? pct(S.hq.E) : '—'} <small>E</small>`, 'flexores ÷ extensores do joelho') : '',
  ].filter(Boolean).slice(0, 4);

  j.document.open();
  j.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Dinamometria — ${esc(p.nome_social || p.nome)} — ${data(r.data_registro)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:ital,wght@1,600;1,700&display=swap" rel="stylesheet">
  <style>
    @page{size:A4;margin:0} *{box-sizing:border-box}
    body{margin:0;font:9.4pt/1.45 Barlow,Arial,sans-serif;color:#23272A;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
    .marca{position:fixed;inset:0;background:url('${base}marca-dagua.png') center 58%/70% no-repeat;opacity:.035;pointer-events:none}
    .hd{background:#23272A;color:#fff;padding:9mm 13mm 6mm;position:relative;overflow:hidden;border-bottom:4px solid #F8781D}
    .hd::after{content:'';position:absolute;right:-18mm;top:-10mm;width:58mm;height:60mm;background:#F8781D;opacity:.12;transform:skewX(-18deg)}
    .hd .l1{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1}
    .hd img{height:30px} .hd .dt{text-align:right;font-size:8.5pt;color:#C3C9CC} .hd .dt b{display:block;color:#fff;font-size:11pt}
    h1{font-family:'Barlow Semi Condensed',Barlow,Arial;font-style:italic;font-weight:700;font-size:22pt;margin:14px 0 10px;letter-spacing:-.2px;position:relative;z-index:1}
    h1 .tr{display:inline-block;width:6px;height:22px;background:#F8781D;transform:skewX(-18deg);margin-right:10px;vertical-align:-2px}
    .pac{display:grid;grid-template-columns:2.2fr 1.2fr .9fr .8fr .8fr .8fr;gap:4px 14px;position:relative;z-index:1}
    .pac small{display:block;color:#8A9196;font-size:6.8pt;text-transform:uppercase;letter-spacing:.08em;font-weight:600} .pac span{font-weight:600;font-size:9.5pt}
    main{padding:6mm 13mm 22mm}
    .kpis{display:grid;grid-template-columns:repeat(${Math.max(kpis.length, 1)},1fr);gap:8px;margin-bottom:4px}
    .kpi{border:1px solid #E1E4E0;border-radius:10px;padding:8px 11px;background:#fff;position:relative;overflow:hidden}
    .kpi::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#F8781D}
    .kpi small{display:block;text-transform:uppercase;letter-spacing:.07em;color:#8A9196;font-size:6.6pt;font-weight:700}
    .kpi b{display:block;font-family:'Barlow Semi Condensed',Barlow;font-style:italic;font-weight:700;font-size:19pt;line-height:1.15}
    .kpi b small{display:inline;font-size:9pt;color:#8A9196;letter-spacing:0;text-transform:none} .kpi span{font-size:8pt;color:#5E666B}
    h2{font-family:'Barlow Semi Condensed',Barlow;font-style:italic;font-weight:700;font-size:13.5pt;margin:14px 0 6px;display:flex;align-items:center;gap:8px}
    h2::before{content:'';width:5px;height:15px;background:#F8781D;transform:skewX(-18deg)}
    .sec{page-break-inside:avoid} .sec.solta{page-break-inside:auto} .txt{white-space:pre-wrap}
    table{border-collapse:collapse;width:100%;font-size:8.6pt} th,td{padding:4px 6px;text-align:left;border-bottom:1px solid #E8EBE7}
    th{font-size:7pt;text-transform:uppercase;letter-spacing:.05em;color:#5E666B;background:#F4F5F3} td.n{font-variant-numeric:tabular-nums}
    .grip{display:grid;grid-template-columns:1.25fr 1fr;gap:12px;align-items:start}
    .crit{background:#F4F5F3;border-radius:10px;padding:9px 11px;font-size:8.6pt}
    .crit div{display:flex;justify-content:space-between;align-items:center;margin:3px 0}
    .pc{display:inline-block;border-radius:999px;padding:1px 9px;font-weight:700;font-size:8.2pt}
    .barras{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;align-items:start;margin-top:8px} .mapa{page-break-inside:avoid;background:#FBFBFA;border:1px solid #E8EBE7;border-radius:12px;padding:6px 8px 8px}
    .art{background:#F4F5F3;border-radius:10px;padding:7px 10px 4px;margin-bottom:7px;page-break-inside:avoid}
    .art>b{font-family:'Barlow Semi Condensed',Barlow;font-style:italic;font-size:10.5pt}
    .mv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;padding:4px 0;border-top:1px solid #E3E6E2}
    .mv:first-of-type{border-top:0} .mv .nm{grid-column:1/-1;font-size:8pt;font-weight:600;color:#5E666B}
    .br{display:flex;align-items:center;gap:5px;font-size:8.2pt;margin:1px 0} .br em{font-style:normal;font-weight:700;width:9px;color:#5E666B}
    .br i{display:block;height:8px;border-radius:4px;max-width:58%} .br span{font-variant-numeric:tabular-nums}
    .mapa svg{width:100%;height:auto}
    .leg{display:flex;gap:12px;justify-content:center;font-size:7.8pt;color:#5E666B;margin-top:2px} .leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
    .prot{font-size:7.8pt;color:#5E666B;background:#FBFBFA;border:1px solid #E8EBE7;border-radius:8px;padding:7px 10px;margin-top:12px;page-break-inside:avoid}
    .ass{margin:26px auto 0;width:70mm;text-align:center;border-top:1px solid #23272A;padding-top:5px;font-size:8.6pt;page-break-inside:avoid}
    .ref{font-size:7pt;color:#8A9196;margin-top:12px;page-break-inside:avoid} .ref ol{margin:3px 0 0;padding-left:14px}
    footer{position:fixed;left:0;right:0;bottom:0;height:13mm;display:flex;justify-content:space-between;align-items:center;padding:0 13mm;font-size:7.4pt;color:#8A9196;border-top:1px solid #E8EBE7;background:#fff}
    footer b{color:#F8781D}
    .bt{position:fixed;top:10px;right:10px;z-index:9;background:#F8781D;color:#fff;border:0;border-radius:999px;padding:8px 16px;font:600 13px Barlow,Arial;cursor:pointer}
    @media print{.bt{display:none}} @media screen{body{background:#E9ECE8}.folha{max-width:210mm;margin:0 auto;background:#fff;min-height:297mm;box-shadow:0 2px 18px rgba(0,0,0,.12);position:relative}footer{position:sticky}}
  </style></head><body><button class="bt" onclick="print()">Imprimir / salvar PDF</button><div class="folha"><div class="marca"></div>
  <header class="hd"><div class="l1"><img src="${base}logo-branco.png" alt="Clínica Cure"><div class="dt">Data da avaliação<b>${data(r.data_registro)}</b></div></div>
    <h1><span class="tr"></span>Relatório de Avaliação Dinamométrica</h1>
    <div class="pac"><div><small>Paciente</small><span>${esc(p.nome_social || p.nome)}</span></div>
      <div><small>Nascimento · idade</small><span>${p.data_nascimento ? `${data(p.data_nascimento)} · ${ctx.idade} anos` : '—'}</span></div>
      <div><small>Sexo</small><span>${sexoTxt}</span></div><div><small>Peso</small><span>${peso ? f1(peso) + ' kg' : '—'}</span></div>
      <div><small>Altura</small><span>${alt ? f1(alt / 100, 2) + ' m' : '—'}</span></div><div><small>IMC</small><span>${imc ? f1(imc) + ' kg/m²' : '—'}</span></div></div></header>
  <main>
    ${kpis.length ? `<div class="kpis">${kpis.join('')}</div>` : ''}
    ${bloco('Motivo da avaliação', c.queixa)}
    ${G ? `<section class="sec"><h2>Força de preensão palmar</h2><div class="grip"><div>
      <table><tr><th>Mão</th><th>1ª</th><th>2ª</th><th>3ª</th><th>Média</th><th>Máxima</th></tr>
      ${['d', 'e'].map((s) => `<tr><td><b>${s === 'd' ? 'Direita' : 'Esquerda'}</b>${st.dom === s.toUpperCase() ? ' <small>(dominante)</small>' : ''}</td>
        ${[0, 1, 2].map((i) => `<td class="n">${f1(num(st.g?.[s]?.[i]))}</td>`).join('')}<td class="n">${f1(s === 'd' ? G.mdD : G.mdE)}</td><td class="n"><b>${f1(s === 'd' ? G.mxD : G.mxE)}</b></td></tr>`).join('')}</table>
      <p style="margin:6px 0 0;font-size:8.2pt;color:#5E666B">${esc(G.eqNome)} · kgf · ${G.rel ? `${f1(G.rel, 2)} kgf/kg de massa corporal · ` : ''}${G.as ? `assimetria D×E ${pct(G.as.pct)}` : ''}</p></div>
      <div class="crit">${G.cut ? `<div><span>EWGSOP2 · corte ${G.cut.ew} kgf</span>${G.ew ? chipCl('alta', 'Reduzida') : chipCl('leve', 'Preservada')}</div>
        <div><span>AWGS2 · corte ${G.cut.aw} kgf</span>${G.aw ? chipCl('alta', 'Reduzida') : chipCl('leve', 'Preservada')}</div>` : '<div>Sexo não informado — classificação não aplicada.</div>'}
        ${G.as ? `<div><span>Assimetria entre mãos</span>${G.as.pct > 10 ? chipCl('moderada', pct(G.as.pct)) : chipCl('leve', pct(G.as.pct))}</div>` : ''}
        ${G.ant ? `<div><span>Anterior (${esc(G.ant.data)})</span>${G.ant.mesmoAparelho ? `<b>${f1(G.ant.max)} → ${f1(G.max)} kgf</b>` : '<span>outro aparelho</span>'}</div>
          ${G.ant.mesmoAparelho ? `<div><span>Variação × MDC95 (${f1(G.mdc)} kgf)</span>${Math.abs(G.ant.delta) >= G.mdc ? chipCl(G.ant.delta > 0 ? 'leve' : 'alta', (G.ant.delta > 0 ? '+' : '') + f1(G.ant.delta) + ' · real') : chipCl('moderada', (G.ant.delta >= 0 ? '+' : '') + f1(G.ant.delta) + ' · no erro')}</div>` : ''}` : ''}
        ${ctx.idade != null && ctx.idade < 60 && G.cut ? '<div style="font-size:7.6pt;color:#8A9196">Cortes validados em idosos; abaixo de 60 anos, usar como alerta.</div>' : ''}</div></div></section>` : ''}
    ${R.length ? `<section class="sec solta"><h2>Dinamometria segmentar e assimetria entre membros</h2>
      <div class="mapa">${mapaSvg(S.rows, G, p.sexo)}<div class="leg">${Object.keys(COR).map((k) => `<span><i style="background:${COR[k]}"></i>${NOME_CL[k]} ${k === 'leve' ? '0–10%' : k === 'moderada' ? '11–14%' : '≥ 15%'}</span>`).join('')}
        <span>tom claro = lado mais forte</span><span>tracejado = músculo profundo (projeção)</span></div></div>
      <div class="barras">
      ${porArt.map(([art, l]) => `<div class="art"><b>${art}</b>${l.map((x) => { const mx = Math.max(x.d || 0, x.e || 0); return `<div class="mv"><span class="nm">${esc(x.nome)}</span>
        <div>${barra('D', x.d, mx, x.as?.fraco)}${barra('E', x.e, mx, x.as?.fraco)}</div>${x.as ? chipCl(x.cls, pct(x.as.pct)) : ''}</div>`; }).join('')}</div>`).join('')}</div>
      <div class="leg" style="margin-top:2px"><span><i style="background:#F8781D"></i>barra laranja = lado mais fraco</span></div>
      <table style="margin-top:8px"><tr><th>Movimento</th><th>D (kgf)</th><th>E (kgf)</th>${peso ? '<th>D kgf/kg</th><th>E kgf/kg</th>' : ''}<th>Assimetria</th>${st.acom ? '<th>LSI</th>' : ''}${temAnt ? `<th>Anterior D / E</th><th>Δ D / E</th>` : ''}</tr>
        ${R.map((x) => `<tr><td>${esc(x.art)} · ${esc(x.nome.toLowerCase())}</td><td class="n">${f1(x.d)}</td><td class="n">${f1(x.e)}</td>
          ${peso ? `<td class="n">${f1(x.relD, 2)}</td><td class="n">${f1(x.relE, 2)}</td>` : ''}<td>${x.as ? chipCl(x.cls, pct(x.as.pct) + (x.as.fraco && x.cls !== 'leve' ? ' ↓' + x.as.fraco : '')) : '—'}</td>
          ${st.acom ? `<td class="n">${x.lsi != null ? `<b style="color:${x.lsi < 90 ? COR.alta : COR.leve}">${pct(x.lsi)}</b>` : '—'}</td>` : ''}
          ${temAnt ? `<td class="n">${f1(x.aD)} / ${f1(x.aE)}</td><td class="n">${x.dD != null ? (x.dD >= 0 ? '+' : '') + Math.round(x.dD) + '%' : '—'} / ${x.dE != null ? (x.dE >= 0 ? '+' : '') + Math.round(x.dE) + '%' : '—'}</td>` : ''}</tr>`).join('')}</table>
      ${S.hq.D || S.hq.E ? `<p style="font-size:8.2pt;color:#5E666B;margin:6px 0 0">Relação flexores/extensores do joelho (isométrica): ${S.hq.D ? '<b>D ' + pct(S.hq.D) + '</b>' : ''} ${S.hq.E ? '· <b>E ' + pct(S.hq.E) + '</b>' : ''}. Referência isocinética a 60°/s ≈ 54–66%; a razão isométrica pode diferir — acompanhar a evolução do próprio paciente.</p>` : ''}
    </section>` : ''}
    ${bloco('Conclusão', c.conclusao)}${bloco('Conduta e reavaliação', c.plano)}${bloco('Observações', c.obs)}
    <div class="prot"><b>Protocolo.</b> ${G ? 'Preensão palmar: sentado, ombro aduzido e neutro, cotovelo a 90°, antebraço e punho neutros (ASHT); 3 contrações máximas por mão, alternadas, com repouso de 30–60 s; considerado o maior valor. ' : ''}${R.length ? `Segmentar: dinamometria isométrica (${esc(st.eq_seg || 'dinamômetro manual')}) com estabilização do segmento, 3 tentativas de 3–5 s por lado, maior valor. Assimetria = (maior − menor) ÷ maior × 100; LSI = lado acometido ÷ não acometido × 100. ` : ''}Valores absolutos não são intercambiáveis entre aparelhos diferentes; reavaliar sempre com o mesmo equipamento e posicionamento. A dinamometria não substitui o exame clínico nem a avaliação de massa muscular e desempenho físico.</div>
    <div class="ass"><b>${esc(me?.nome || '')}</b><br>${esc(me?.conselho || '')} ${esc(me?.numero_conselho || '')}${me?.uf_conselho ? '/' + esc(me.uf_conselho) : ''}</div>
    <div class="ref"><b>Referências</b> (consultadas em 15/11/2026)<ol>
      ${G ? `<li>Cruz-Jentoft AJ et al. Sarcopenia: revised European consensus on definition and diagnosis (EWGSOP2). Age Ageing. 2019;48(1):16-31.</li>
      <li>Chen LK et al. Asian Working Group for Sarcopenia: 2019 consensus update (AWGS2). J Am Med Dir Assoc. 2020;21(3):300-307.</li>
      <li>Roberts HC et al. A review of the measurement of grip strength in clinical and epidemiological studies: towards a standardised approach. Age Ageing. 2011;40(4):423-9.</li>
      <li>Akgün İ et al. Digital handgrip assessment in musculoskeletal health: reliability, measurement precision and interchangeability. BMC Sports Sci Med Rehabil. 2026. doi:10.1186/s13102-026-02225-3.</li>
      <li>Mutalib SA et al. Modernising grip dynamometry: inter-instrument reliability between GripAble and Jamar. BMC Musculoskelet Disord. 2022;23:80.</li>` : ''}
      ${R.length ? `<li>Parkinson AO et al. The calculation, thresholds and reporting of inter-limb strength asymmetry: a systematic review. J Sports Sci Med. 2021;20(4):594-617.</li>
      <li>Grindem H et al. Simple decision rules can reduce reinjury risk by 84% after ACL reconstruction: the Delaware-Oslo ACL cohort study. Br J Sports Med. 2016;50(13):804-8.</li>
      <li>Bohannon RW. Considerations and practical options for measuring muscle strength: a narrative review. Biomed Res Int. 2019;2019:8194537.</li>` : ''}</ol></div>
  </main>
  <footer><span><b>Clínica Cure</b> — Saúde e Desempenho · curesaudeedesempenho.com · (47) 3801-2376</span><span>Gerado pelo Cure OS em ${new Date().toLocaleDateString('pt-BR')} · Informação sigilosa</span></footer>
  </div></body></html>`);
  j.document.close();
}
