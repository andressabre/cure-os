// Avaliação postural por foto — protocolo SAPO (Software para Avaliação Postural; Duarte, Ferreira, Maldonado e Freitas, 2005;
// validação: Ferreira et al., Clinics 2010;65(7):675-81). Modelo de prontuário "fisio_postural" (db/049, 15/11/2026).
// Fotos no bucket privado "prontuario" (pasta do autor: só ele lê, pela RLS). Pontos guardados normalizados (0–1) em conteudo.sapo.
// Calibração opcional por fio de prumo com 2 marcas: corrige a vertical da foto e dá a escala (cm). Sem fio de prumo, a vertical é a da foto.
// Medidas e sinais seguem as definições SAPO; o texto descreve o lado/direção em palavras. Nenhum ponto de corte "normal/anormal" é aplicado:
// pequenas assimetrias fazem parte do padrão em pé (Ferreira et al., J Manipulative Physiol Ther 2011;34(6):371-80).
import { sb, estado, $, $$, esc, toast, falha, data } from '../core.js';
import { enviarArquivo, escolherArquivo } from './documentos.js';

const f1 = (n, d = 1) => Number(n).toFixed(d).replace('.', ',');
const bil = (k, nome, fem) => [[k + 'D', `${nome} ${fem ? 'direita' : 'direito'}`], [k + 'E', `${nome} ${fem ? 'esquerda' : 'esquerdo'}`]];
const LAT = [['tr', 'Trago'], ['c7', 'Processo espinhoso de C7'], ['ac', 'Acrômio'], ['eias', 'EIAS (espinha ilíaca ântero-superior)'],
  ['eips', 'EIPS (espinha ilíaca póstero-superior)'], ['tc', 'Trocânter maior'], ['j', 'Linha articular do joelho'], ['ml', 'Maléolo lateral'],
  ['mt', 'Entre as cabeças do 2º e 3º metatarsos']];
export const VISTAS = {
  ant: { nome: 'Anterior', dica: 'O lado direito do paciente fica à ESQUERDA da foto.', pontos: [...bil('tr', 'Trago'), ...bil('ac', 'Acrômio'),
    ...bil('eias', 'EIAS', true), ...bil('tc', 'Trocânter maior'),
    ['jD', 'Linha articular do joelho direito'], ['ptD', 'Ponto medial da patela direita'], ['ttD', 'Tuberosidade da tíbia direita'],
    ['jE', 'Linha articular do joelho esquerdo'], ['ptE', 'Ponto medial da patela esquerda'], ['ttE', 'Tuberosidade da tíbia esquerda'],
    ['mlD', 'Maléolo lateral direito'], ['mmD', 'Maléolo medial direito'], ['mlE', 'Maléolo lateral esquerdo'], ['mmE', 'Maléolo medial esquerdo']],
    linhas: [['trD', 'trE'], ['acD', 'acE'], ['eiasD', 'eiasE'], ['ttD', 'ttE'], ['tcD', 'jD', 'mlD'], ['tcE', 'jE', 'mlE'], ['eiasD', 'mmD'], ['eiasE', 'mmE']] },
  post: { nome: 'Posterior', dica: 'O lado direito do paciente fica à DIREITA da foto.', pontos: [['t3', 'Processo espinhoso de T3'],
    ...bil('esc', 'Ângulo inferior da escápula'),
    ['pnD', 'Ponto médio da perna direita'], ['tdD', 'Tendão do calcâneo direito (altura média dos maléolos)'], ['caD', 'Calcâneo direito'],
    ['pnE', 'Ponto médio da perna esquerda'], ['tdE', 'Tendão do calcâneo esquerdo (altura média dos maléolos)'], ['caE', 'Calcâneo esquerdo']],
    linhas: [['escD', 't3', 'escE'], ['pnD', 'tdD', 'caD'], ['pnE', 'tdE', 'caE']] },
  latD: { nome: 'Lateral direita', dica: 'Lado direito voltado para a câmera.', pontos: LAT, frente: 1,
    linhas: [['c7', 'tr'], ['ac', 'tr'], ['ac', 'tc', 'ml'], ['eias', 'eips'], ['tc', 'j', 'ml'], ['ml', 'mt']] },
  latE: { nome: 'Lateral esquerda', dica: 'Lado esquerdo voltado para a câmera.', pontos: LAT, frente: -1,
    linhas: [['c7', 'tr'], ['ac', 'tr'], ['ac', 'tc', 'ml'], ['eias', 'eips'], ['tc', 'j', 'ml'], ['ml', 'mt']] },
};
const ORDEM = ['ant', 'post', 'latD', 'latE'];

// ---------- geometria ----------
const deg = (r) => (r * 180) / Math.PI;
const horiz = (a, b) => deg(Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])));
const vert = (a, b) => deg(Math.atan2(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])));
const ang3 = (a, o, b) => { const u = [a[0] - o[0], a[1] - o[1]], w = [b[0] - o[0], b[1] - o[1]];
  return deg(Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w) || 1))))); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const IA = (m, n) => ((m - n) / ((m + n) / 2)) * 100;   // índice de assimetria SAPO (%)
// x da reta a→b na altura y (para saber de que lado da reta um ponto está)
const xNaReta = (a, b, y) => a[0] + ((y - a[1]) / ((b[1] - a[1]) || 1e-9)) * (b[0] - a[0]);

// Pontos em px num sistema com X horizontal e Y vertical verdadeiros (fio de prumo); cmPx = cm por pixel
export function coords(v) {
  if (!v?.w) return null;
  const P = (p) => [p.x * v.w, p.y * v.h];
  let ex = [1, 0], ey = [0, 1], cmPx = null;
  if (v.prumo?.length === 2) {
    let [a, b] = v.prumo.map(P); if (b[1] < a[1]) [a, b] = [b, a];
    const u = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...u);
    if (L > 5) { ey = [u[0] / L, u[1] / L]; ex = [ey[1], -ey[0]]; if (v.cm > 0) cmPx = v.cm / L; }
  }
  const p = {};
  for (const [k, q0] of Object.entries(v.pts || {})) { const q = P(q0); p[k] = [q[0] * ex[0] + q[1] * ex[1], q[0] * ey[0] + q[1] * ey[1]]; }
  return { p, cmPx };
}

// ---------- medidas (definições SAPO) ----------
// Cada medida: { k, vista, rot, v, un, dir, txt, desvio } — desvio = quanto foge do alinhado (para escolher os destaques)
export function medidas(sapo) {
  const M = [], V = sapo.vistas || {};
  const push = (m) => M.push({ un: '°', ...m });
  const c = coords(V.ant);
  if (c) {
    const p = c.p, has = (...k) => k.every((x) => p[x]);
    const nivel = (k, a, b, rot, fem, frase) => { if (!has(a, b)) return; const v = horiz(p[a], p[b]), baixo = p[a][1] > p[b][1] ? 'D' : 'E';
      const lado = baixo === 'D' ? (fem ? 'direita' : 'direito') : (fem ? 'esquerda' : 'esquerdo');
      push({ k, vista: 'ant', rot, v, dir: v < 0.05 ? 'nivelado' : `${lado} mais baix${fem ? 'a' : 'o'}`, desvio: v,
        txt: v < 0.05 ? `${rot}: nivelados.` : frase ? frase(v, baixo) : `${rot}: desnível de ${f1(v)}°, ${lado} mais baix${fem ? 'a' : 'o'}.` }); };
    nivel('cabeca', 'trD', 'trE', 'Cabeça (tragos)', false, (v, b) => `Cabeça (tragos): inclinação lateral de ${f1(v)}° para a ${b === 'D' ? 'direita' : 'esquerda'}.`);
    nivel('acromios', 'acD', 'acE', 'Acrômios');
    nivel('eias', 'eiasD', 'eiasE', 'EIAS', true);
    if (has('acD', 'acE', 'eiasD', 'eiasE')) {
      const s = (a, b) => deg(Math.atan2(p[b][1] - p[a][1], p[b][0] - p[a][0])), v = Math.abs(s('acD', 'acE') - s('eiasD', 'eiasE'));
      push({ k: 'acr_eias', vista: 'ant', rot: 'Acrômios × EIAS', v, desvio: v, txt: `Ângulo entre a linha dos acrômios e a das EIAS: ${f1(v)}°.` });
    }
    const meio = has('eiasD', 'eiasE') ? (p.eiasD[0] + p.eiasE[0]) / 2 : has('tcD', 'tcE') ? (p.tcD[0] + p.tcE[0]) / 2 : null;
    for (const L of ['D', 'E']) {
      const nome = L === 'D' ? 'direito' : 'esquerdo';
      if (has('tc' + L, 'j' + L, 'ml' + L) && meio !== null) {
        const v = ang3(p['tc' + L], p['j' + L], p['ml' + L]), off = p['j' + L][0] - xNaReta(p['tc' + L], p['ml' + L], p['j' + L][1]);
        const medial = Math.sign(off) === Math.sign(meio - p['j' + L][0]), dir = 180 - v < 0.05 ? 'alinhado' : medial ? 'joelho medializado (valgo)' : 'joelho lateralizado (varo)';
        push({ k: 'mi' + L, vista: 'ant', rot: `Ângulo frontal do MI ${nome}`, v, dir, desvio: 180 - v, txt: `Membro inferior ${nome} (ângulo frontal): ${f1(v)}°, ${dir}.` });
      }
      if (has('tc' + L, 'tt' + L, 'pt' + L)) {
        const v = ang3(p['tc' + L], p['tt' + L], p['pt' + L]), cl = has('eias' + L) ? 180 - ang3(p['eias' + L], p['pt' + L], p['tt' + L]) : null;
        push({ k: 'q' + L, vista: 'ant', rot: `Ângulo Q ${nome}`, v, extra: cl, desvio: 0,
          txt: `Ângulo Q ${nome}: ${f1(v)}° (protocolo SAPO: trocânter–tuberosidade–patela)${cl !== null ? `; ${f1(cl)}° pela definição clássica (EIAS–patela–tuberosidade)` : ''}.` });
      }
    }
    if (has('eiasD', 'mmD', 'eiasE', 'mmE')) {
      const d = dist(p.eiasD, p.mmD), e = dist(p.eiasE, p.mmE), v = IA(d, e), cm = c.cmPx ? (d - e) * c.cmPx : null;
      const maior = Math.abs(v) < 0.05 ? '' : v > 0 ? 'direito maior' : 'esquerdo maior';
      push({ k: 'mmii', vista: 'ant', rot: 'Comprimento dos MMII (IA)', v, un: '%', dir: maior || 'iguais', cm, desvio: 0,
        txt: `Comprimento aparente dos membros inferiores (EIAS–maléolo medial): ${maior ? `${maior}, assimetria de ${f1(Math.abs(v))}%` : 'sem diferença'}${cm !== null && maior ? ` (≈ ${f1(Math.abs(cm))} cm)` : ''}. A fotogrametria não substitui a escanometria.` });
    }
    nivel('tibias', 'ttD', 'ttE', 'Tuberosidades das tíbias', true);
  }
  const cp = coords(V.post);
  if (cp) {
    const p = cp.p, has = (...k) => k.every((x) => p[x]);
    if (has('t3', 'escD', 'escE')) {
      const d = Math.abs(p.escD[0] - p.t3[0]), e = Math.abs(p.escE[0] - p.t3[0]), v = IA(d, e);
      const dir = Math.abs(v) < 0.05 ? 'simétricas' : v > 0 ? 'direita mais afastada da coluna' : 'esquerda mais afastada da coluna';
      push({ k: 'escapula', vista: 'post', rot: 'Escápulas × T3 (IA)', v, un: '%', dir, desvio: 0,
        txt: `Escápulas em relação a T3: ${Math.abs(v) < 0.05 ? 'simétricas' : `assimetria de ${f1(Math.abs(v))}%, a ${dir}`}.` });
    }
    const meio = p.t3 ? p.t3[0] : has('caD', 'caE') ? (p.caD[0] + p.caE[0]) / 2 : null;
    for (const L of ['D', 'E']) {
      if (!has('pn' + L, 'td' + L, 'ca' + L) || meio === null) continue;
      const nome = L === 'D' ? 'direito' : 'esquerdo', ca = p['ca' + L];
      const v = ang3(p['pn' + L], p['td' + L], ca), off = ca[0] - xNaReta(p['pn' + L], p['td' + L], ca[1]);
      const lateral = Math.sign(off) === Math.sign(ca[0] - meio), dir = 180 - v < 0.05 ? 'alinhado' : lateral ? 'valgo' : 'varo';
      push({ k: 'retrope' + L, vista: 'post', rot: `Ângulo perna/retropé ${nome}`, v, dir, desvio: 180 - v, txt: `Retropé ${nome} (ângulo perna/retropé): ${f1(v)}°, ${dir}.` });
    }
  }
  for (const vk of ['latD', 'latE']) {
    const cl = coords(V[vk]); if (!cl) continue;
    const p = cl.p, has = (...k) => k.every((x) => p[x]), sfx = vk === 'latD' ? 'D' : 'E';
    const s = has('mt', 'ml') ? Math.sign(p.mt[0] - p.ml[0]) || VISTAS[vk].frente : VISTAS[vk].frente;   // para onde é a frente na foto
    const frente = (a, b) => (p[b][0] - p[a][0]) * s > 0;   // b está à frente de a?
    const P = (m) => push({ vista: vk, ...m, k: m.k + sfx });
    if (has('tr', 'c7')) { const v = horiz(p.c7, p.tr); P({ k: 'cabH', rot: 'Cabeça: trago–C7 × horizontal', v, desvio: 0,
      txt: `Ângulo trago–C7 com a horizontal: ${f1(v)}° (quanto menor, mais anteriorizada a cabeça).` }); }
    if (has('tr', 'ac')) { const v = vert(p.ac, p.tr), dir = v < 0.05 ? 'alinhada' : frente('ac', 'tr') ? 'anteriorizada' : 'posteriorizada';
      P({ k: 'cabV', rot: 'Cabeça: acrômio–trago × vertical', v, dir, desvio: v, txt: `Cabeça em relação ao acrômio: ${f1(v)}° com a vertical, ${dir}.` }); }
    if (has('ac', 'tc')) { const v = vert(p.tc, p.ac), dir = v < 0.05 ? 'alinhado' : frente('tc', 'ac') ? 'inclinado para a frente' : 'inclinado para trás';
      P({ k: 'tronco', rot: 'Tronco: acrômio–trocânter × vertical', v, dir, desvio: v, txt: `Tronco: ${f1(v)}° com a vertical, ${dir}.` }); }
    if (has('ac', 'tc', 'ml')) { const v = ang3(p.ac, p.tc, p.ml), off = (p.tc[0] - xNaReta(p.ac, p.ml, p.tc[1])) * s;
      const dir = 180 - v < 0.05 ? 'alinhado' : off > 0 ? 'quadril (pelve) à frente da linha acrômio–maléolo' : 'quadril (pelve) atrás da linha acrômio–maléolo';
      P({ k: 'quadril', rot: 'Ângulo do quadril', v, dir, desvio: 180 - v, txt: `Ângulo do quadril (acrômio–trocânter–maléolo): ${f1(v)}°, ${dir}.` }); }
    if (has('ac', 'ml')) { const v = vert(p.ml, p.ac), dir = v < 0.05 ? 'alinhado' : frente('ml', 'ac') ? 'inclinado para a frente' : 'inclinado para trás';
      P({ k: 'corpo', rot: 'Corpo: acrômio–maléolo × vertical', v, dir, desvio: v, txt: `Alinhamento vertical do corpo: ${f1(v)}°, ${dir}.` }); }
    if (has('eias', 'eips')) { const v = horiz(p.eias, p.eips), dir = v < 0.05 ? 'neutra' : p.eias[1] > p.eips[1] ? 'inclinação anterior (anteversão)' : 'inclinação posterior (retroversão)';
      P({ k: 'pelve', rot: 'Pelve: EIAS–EIPS × horizontal', v, dir, desvio: v, txt: `Pelve (EIAS–EIPS): ${f1(v)}° com a horizontal, ${dir}.` }); }
    if (has('tc', 'j', 'ml')) { const v = ang3(p.tc, p.j, p.ml), off = (p.j[0] - xNaReta(p.tc, p.ml, p.j[1])) * s;
      const dir = 180 - v < 0.05 ? 'alinhado' : off < 0 ? 'hiperextensão (recurvato)' : 'flexo';
      P({ k: 'joelho', rot: 'Ângulo do joelho', v, dir, desvio: 180 - v, txt: `Joelho (trocânter–joelho–maléolo): ${f1(v)}°, ${dir}.` }); }
    if (has('j', 'ml')) { const v = deg(Math.atan2(p.ml[1] - p.j[1], (p.j[0] - p.ml[0]) * s)), dir = v < 90 ? 'perna inclinada para a frente' : v > 90 ? 'perna inclinada para trás' : 'perna vertical';
      P({ k: 'tornozelo', rot: 'Tornozelo: perna × horizontal', v, dir, desvio: Math.abs(90 - v), txt: `Tornozelo (perna × horizontal, pela frente): ${f1(v)}°, ${dir}.` }); }
  }
  return M;
}

// ---------- texto ----------
const NOME_VISTA = Object.fromEntries(ORDEM.map((k) => [k, VISTAS[k].nome.toLowerCase()]));
const CURTO = { cabeca: 'cabeça (tragos)', acromios: 'acrômios', eias: 'EIAS', acr_eias: 'acrômios × EIAS', miD: 'MI direito (frontal)', miE: 'MI esquerdo (frontal)',
  tibias: 'tuberosidades das tíbias', retropeD: 'retropé direito', retropeE: 'retropé esquerdo', cabV: 'cabeça × acrômio', tronco: 'tronco', quadril: 'quadril',
  corpo: 'corpo', pelve: 'pelve', joelho: 'joelho', tornozelo: 'tornozelo' };
const curto = (m) => CURTO[m.k] || CURTO[m.k.replace(/[DE]$/, '')] || m.rot;
export function gerar(sapo, ctx) {
  const M = medidas(sapo), por = (v) => M.filter((m) => m.vista === v).map((m) => m.txt).join('\n');
  const usadas = ORDEM.filter((k) => sapo.vistas?.[k]?.foto);
  const lat = ['latD', 'latE'].filter((k) => M.some((m) => m.vista === k)).map((k) => `${VISTAS[k].nome}:\n${por(k)}`).join('\n\n');
  const top = M.filter((m) => m.desvio >= 0.5).sort((a, b) => b.desvio - a.desvio).slice(0, 5)
    .map((m) => `${curto(m)} ${f1(m.v)}°${m.dir ? ', ' + m.dir : ''}${m.vista.startsWith('lat') ? ` (${NOME_VISTA[m.vista]})` : ''}`);
  const mi = M.find((m) => m.k === 'mmii');
  let comp = '';
  const ant = ctx?.anterior?.med;
  if (ant) {
    const linhas = M.filter((m) => ant[m.k] && (m.desvio >= 0.5 || m.k === 'mmii')).slice(0, 8)
      .map((m) => `${m.rot}: ${f1(ant[m.k].v)}${m.un}${ant[m.k].dir ? ' (' + ant[m.k].dir + ')' : ''} → ${f1(m.v)}${m.un}${m.dir ? ' (' + m.dir + ')' : ''}`);
    if (linhas.length) comp = `Comparação com a avaliação de ${ctx.anterior.data}: ${linhas.join('; ')}.`;
  }
  const conclusao = usadas.length ? [
    `Avaliação postural por fotogrametria, protocolo SAPO (vista${usadas.length > 1 ? 's' : ''} ${usadas.map((k) => NOME_VISTA[k]).join(', ')}).`,
    top.length ? `Maiores desvios medidos: ${top.join('; ')}.` : '',
    mi && mi.dir !== 'iguais' ? `Comprimento aparente dos MMII com o ${mi.dir} (IA ${f1(Math.abs(mi.v))}%) — confirmar por escanometria se for relevante para a conduta.` : '',
    comp,
    'Pequenas assimetrias fazem parte do padrão postural em pé (Ferreira et al., 2011). Correlacionar com a queixa, o exame físico e a baropodometria.',
  ].filter(Boolean).join('\n') : '';
  return { anterior: por('ant'), posterior: por('post'), lateral: lat, conclusao };
}

// ---------- desenho ----------
function desenhar(ctx, img, v, vk, W, H, opc = {}) {
  ctx.drawImage(img, 0, 0, W, H);
  const P = (k) => v.pts?.[k] && [v.pts[k].x * W, v.pts[k].y * H], r = Math.max(3, W / 160);
  ctx.lineWidth = Math.max(1.5, W / 400);
  if (v.prumo?.length) { ctx.strokeStyle = '#00B4D8'; ctx.fillStyle = '#00B4D8';
    const q = v.prumo.map((p) => [p.x * W, p.y * H]); q.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); });
    if (q.length === 2) { ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(...q[0]); ctx.lineTo(...q[1]); ctx.stroke(); ctx.setLineDash([]); } }
  ctx.strokeStyle = 'rgba(248,120,29,.9)';
  for (const ln of VISTAS[vk].linhas) { const q = ln.map(P); if (q.some((x) => !x)) continue;
    ctx.beginPath(); ctx.moveTo(...q[0]); q.slice(1).forEach((x) => ctx.lineTo(...x)); ctx.stroke(); }
  for (const [k] of VISTAS[vk].pontos) { const q = P(k); if (!q) continue;
    ctx.fillStyle = k === opc.ativo ? '#E63946' : '#F8781D'; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.fill(); ctx.lineWidth = 1; ctx.stroke(); }
}

const URLS = {};   // caminho no Storage → URL assinada (ou objectURL logo após o envio)
async function urlFoto(caminho) {
  if (URLS[caminho]) return URLS[caminho];
  const { data: d, error } = await sb.storage.from('prontuario').createSignedUrl(caminho, 3600);
  if (error) throw error; return (URLS[caminho] = d.signedUrl);
}
function carregar(url) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Não foi possível abrir a foto.')); i.src = url; });
}

// ---------- painel no editor ----------
// alvo: contêiner · form: formulário do editor (campos c_<k>) · st: conteudo.sapo salvo ou {} · ctx: { pacienteId, anterior: {med, data} }
export function montarSapo(alvo, form, st, ctx = {}) {
  st.vistas ||= {}; st._g ||= {};
  const incompleta = (k) => st.vistas[k]?.foto && VISTAS[k].pontos.some(([x]) => !st.vistas[k].pts?.[x] && !(st.vistas[k].pulados || []).includes(x));
  let vk = ORDEM.find(incompleta) || ORDEM.find((k) => !st.vistas[k]?.foto) || 'ant', alvoPt = null, modo = null, img = null, arrasto = null, limpar = 0;
  const imgs = {};
  const V = () => (st.vistas[vk] ||= { pts: {}, cm: 100 });
  const proximo = () => VISTAS[vk].pontos.find(([k]) => !V().pts[k] && !(V().pulados || []).includes(k))?.[0] || null;
  const nomePt = (k) => VISTAS[vk].pontos.find(([x]) => x === k)?.[1] || k;

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

  const tela = () => {
    const v = st.vistas[vk] || {}, total = VISTAS[vk].pontos.length, feitos = Object.keys(v.pts || {}).length;
    const atual = modo === 'prumo' ? null : alvoPt || proximo();
    const meds = medidas(st).filter((m) => m.vista === vk);
    alvo.innerHTML = `
      <div class="sp-abas">${ORDEM.map((k) => { const x = st.vistas[k], n = Object.keys(x?.pts || {}).length;
        return `<button type="button" class="ck${k === vk ? ' on' : ''}" data-vista="${k}">${esc(VISTAS[k].nome)}${x?.foto ? ` <small>${n}/${VISTAS[k].pontos.length}</small>` : ''}</button>`; }).join('')}
        <details class="sp-como"><summary>Como fotografar</summary><small>Câmera em tripé a ≥ 3 m, na altura da metade da estatura; paciente e fio de prumo no mesmo plano,
        perpendicular à câmera; fio com 2 marcas a distância conhecida (ex.: 100 cm); marcadores (isopor) nos pontos palpados; contorno dos pés no tapete
        e giro de 90° entre as vistas (protocolo SAPO). Roupa que deixe ver os pontos. A foto fica só no seu prontuário.</small></details></div>
      <div class="sp-area">
        <div class="sp-foto">${v.foto ? '<canvas class="sp-cv"></canvas><canvas class="sp-lupa" width="132" height="132" hidden></canvas>'
          : `<div class="sp-vazio"><button type="button" class="btn primario" data-foto>📷 Escolher foto da vista ${esc(VISTAS[vk].nome.toLowerCase())}</button><small class="muted">${esc(VISTAS[vk].dica)}</small></div>`}</div>
        <div class="sp-lado">
          ${v.foto ? `<div class="sp-instr">${modo === 'prumo' ? `Clique na marca <b>${(v.prumo || []).length ? 'inferior' : 'superior'}</b> do fio de prumo`
            : atual ? `Clique em: <b>${esc(nomePt(atual))}</b>` : '✓ Pontos desta vista concluídos'}<br><small class="muted">${esc(VISTAS[vk].dica)} Arraste um ponto para ajustar.</small></div>
          <div class="linha-acoes" style="margin:6px 0">
            ${atual && modo !== 'prumo' ? '<button type="button" class="btn pequeno" data-pular>Pular ponto</button>' : ''}
            <button type="button" class="btn pequeno" data-prumo>${(v.prumo || []).length === 2 ? '↻ Fio de prumo' : 'Marcar fio de prumo'}</button>
            <button type="button" class="btn pequeno" data-foto>Trocar foto</button>
            <button type="button" class="btn pequeno" data-limpar>${limpar ? 'Confirmar: limpar pontos' : 'Limpar pontos'}</button></div>
          <label class="sp-cm">Distância entre as marcas do fio <input type="number" min="1" step="1" value="${esc(v.cm ?? 100)}" data-cm> cm
            <small class="muted">${(v.prumo || []).length === 2 ? '✓ vertical corrigida e escala em cm' : 'sem fio: usa a vertical da foto e não mede em cm'}</small></label>
          <ol class="sp-pts">${VISTAS[vk].pontos.map(([k, n]) => `<li><a href="#" data-pt="${k}" class="${k === atual ? 'atual' : ''}">${v.pts?.[k] ? '✓' : (v.pulados || []).includes(k) ? '–' : '○'} ${esc(n)}</a></li>`).join('')}</ol>
          <small class="muted">${feitos}/${total} pontos</small>` : ''}
          ${meds.length ? `<table class="sp-med">${meds.map((m) => `<tr><td>${esc(m.rot)}</td><td><b>${f1(m.v)}${m.un}</b>${m.dir ? ' · ' + esc(m.dir) : ''}</td></tr>`).join('')}</table>` : ''}
        </div></div>
      <div class="linha-acoes" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn pequeno" data-laudo>🖨 Mini laudo com fotos</button></div>`;

    $$('[data-vista]', alvo).forEach((b) => (b.onclick = () => { vk = b.dataset.vista; alvoPt = null; modo = null; limpar = 0; tela(); }));
    $$('[data-foto]', alvo).forEach((b) => (b.onclick = trocarFoto));
    $('[data-pular]', alvo)?.addEventListener('click', () => { const k = atual; (V().pulados ||= []).push(k); delete V().pts[k]; alvoPt = null; mudou(); });
    $('[data-prumo]', alvo)?.addEventListener('click', () => { V().prumo = []; modo = 'prumo'; mudou(); });
    $('[data-limpar]', alvo)?.addEventListener('click', () => {
      if (!limpar) { limpar = setTimeout(() => { limpar = 0; tela(); }, 3000); return tela(); }
      clearTimeout(limpar); limpar = 0; V().pts = {}; V().pulados = []; V().prumo = []; alvoPt = null; mudou();
    });
    $('[data-cm]', alvo)?.addEventListener('change', (e) => { V().cm = Number(e.target.value) || null; mudou(); });
    $$('[data-pt]', alvo).forEach((a) => (a.onclick = (e) => { e.preventDefault(); modo = null; alvoPt = a.dataset.pt; V().pulados = (V().pulados || []).filter((x) => x !== alvoPt); tela(); }));
    $('[data-laudo]', alvo).onclick = () => ctx.aoLaudo?.();
    if (v.foto) montarCanvas(atual);
  };

  const mudou = () => { aplicar(); tela(); };

  async function trocarFoto() {
    const f = await escolherArquivo(); if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Escolha uma foto (JPG ou PNG).', true);
    try {
      toast('Enviando foto…');
      const up = await enviarArquivo(f, `${estado.profissionalId}/${ctx.pacienteId}`, 'prontuario');
      const url = URL.createObjectURL(f); URLS[up.arquivo] = url;
      const im = await carregar(url);
      st.vistas[vk] = { foto: up.arquivo, w: im.naturalWidth, h: im.naturalHeight, pts: {}, pulados: [], prumo: [], cm: st.vistas[vk]?.cm ?? 100 };
      imgs[vk] = im; alvoPt = null; modo = null; mudou();
    } catch (e) { falha(e, 'Foto'); }
  }

  async function montarCanvas(atual) {
    const v = V(), cv = $('.sp-cv', alvo), lupa = $('.sp-lupa', alvo), caixa = $('.sp-foto', alvo);
    try { img = imgs[vk] ||= await carregar(await urlFoto(v.foto)); } catch (e) { caixa.innerHTML = `<div class="sp-vazio">${esc(e.message)}</div>`; return; }
    if (!cv.isConnected) return;
    const larg = caixa.clientWidth || 480, W = Math.min(larg, Math.max(600, window.innerHeight * 0.8) * (v.w / v.h)), H = W * (v.h / v.w), dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const redesenhar = () => desenhar(g, img, v, vk, W, H, { ativo: arrasto });
    redesenhar();
    const local = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
    let inicio = null;
    const perto = (q) => { let best = null, bd = 9 / W; for (const [k, p] of Object.entries(v.pts)) { const d = Math.hypot((p.x - q.x), (p.y - q.y) * (H / W)); if (d < bd) { bd = d; best = k; } } return best; };
    const mostrarLupa = (e, q) => {
      lupa.hidden = false; const lg = lupa.getContext('2d'), R = (132 / 3) * (v.w / W), sx = q.x * v.w, sy = q.y * v.h;
      lg.fillStyle = '#000'; lg.fillRect(0, 0, 132, 132); lg.drawImage(img, sx - R / 2, sy - R / 2, R, R, 0, 0, 132, 132);
      lg.strokeStyle = '#E63946'; lg.lineWidth = 1; lg.beginPath(); lg.moveTo(66, 0); lg.lineTo(66, 132); lg.moveTo(0, 66); lg.lineTo(132, 66); lg.stroke();
      lupa.style.left = q.x > 0.5 ? '6px' : ''; lupa.style.right = q.x > 0.5 ? '' : '6px';
    };
    cv.onpointerdown = (e) => {
      e.preventDefault(); const q = local(e);
      if (modo === 'prumo') { (v.prumo ||= []).push(q); if (v.prumo.length >= 2) modo = null; return mudou(); }
      // Clique marca o ponto da vez; só vira arrasto se começar sobre um ponto já marcado e o cursor andar
      cv.setPointerCapture(e.pointerId); inicio = { q, k: perto(q), x: e.clientX, y: e.clientY }; mostrarLupa(e, q);
    };
    cv.onpointermove = (e) => {
      const q = local(e); if (e.pointerType !== 'touch' || inicio) mostrarLupa(e, q);
      if (inicio?.k && !arrasto && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 4) arrasto = inicio.k;
      if (arrasto) { v.pts[arrasto] = q; redesenhar(); }
    };
    cv.onpointerup = (e) => {
      lupa.hidden = true; const ini = inicio; inicio = null;
      if (arrasto) { arrasto = null; return mudou(); }
      if (!ini) return;
      if (!atual) return toast('Todos os pontos desta vista estão marcados. Arraste um ponto para ajustar ou escolha-o na lista.');
      v.pts[atual] = local(e); alvoPt = null; mudou();
    };
    cv.onpointerleave = () => { if (!arrasto) lupa.hidden = true; };
  }

  tela();
  if (Object.keys(st.vistas).length) aplicar();
  return {
    estado: () => {
      const vistas = Object.fromEntries(Object.entries(st.vistas).filter(([, v]) => v?.foto));
      if (!Object.keys(vistas).length) return null;
      const med = Object.fromEntries(medidas({ vistas }).map((m) => [m.k, { v: +m.v.toFixed(2), un: m.un, dir: m.dir || '', rot: m.rot }]));
      return { vistas, med, _g: st._g };
    },
  };
}

// ---------- mini laudo com fotos ----------
// p: paciente · r: { data_registro, conteudo } · me: profissional (nome, conselho...). Abre a janela já no clique (bloqueador de pop-up).
export async function laudoPostural(p, r, me) {
  const j = window.open('', '_blank'); if (!j) return falha('Permita pop-ups deste site para imprimir.');
  j.document.write('<p style="font:14px Arial;padding:20px">Montando o laudo…</p>');
  const c = r.conteudo || {}, sapo = c.sapo || { vistas: {} };
  const figs = [];
  for (const vk of ORDEM) {
    const v = sapo.vistas?.[vk]; if (!v?.foto) continue;
    try {
      const im = await carregar(await urlFoto(v.foto)), H = 900, W = Math.round(H * (v.w / v.h));
      const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
      desenhar(cv.getContext('2d'), im, v, vk, W, H);
      figs.push(`<figure><img src="${cv.toDataURL('image/jpeg', 0.82)}" alt=""><figcaption>${esc(VISTAS[vk].nome)}</figcaption></figure>`);
    } catch { figs.push(`<figure><div class="sem">Foto indisponível</div><figcaption>${esc(VISTAS[vk].nome)}</figcaption></figure>`); }
  }
  const M = medidas(sapo);
  const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  const bloco = (rot, t) => (t && String(t).trim() ? `<h3>${esc(rot)}</h3><div class="txt">${esc(t)}</div>` : '');
  j.document.open();
  j.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Avaliação postural — ${esc(p.nome_social || p.nome)}</title><style>
    @page{size:A4;margin:14mm} body{font:10.5pt/1.45 Arial,sans-serif;color:#222;margin:0}
    header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #F8781D;padding-bottom:8px;margin-bottom:10px}
    header img{height:40px} h1{font-size:14pt;margin:0} h3{font-size:11pt;margin:12px 0 3px;color:#F8781D} .txt{white-space:pre-wrap}
    .figs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0;page-break-inside:avoid}
    figure{margin:0;text-align:center} figure img{max-width:100%;max-height:105mm;border:1px solid #ddd;border-radius:4px} figcaption{font-size:9pt;color:#555}
    .sem{height:200px;display:flex;align-items:center;justify-content:center;background:#f3f3f3;color:#888}
    table{border-collapse:collapse;width:100%;font-size:9.5pt;page-break-inside:avoid} td,th{border-bottom:1px solid #e3e3e3;padding:3px 4px;text-align:left}
    th{background:#FFF3EA} footer{margin-top:14px;font-size:8.5pt;color:#666;border-top:1px solid #ccc;padding-top:6px}
    .bt{position:fixed;top:8px;right:8px} @media print{.bt{display:none}}
  </style></head><body><button class="bt" onclick="print()">Imprimir / salvar PDF</button>
  <header><img src="${base}logo.png" alt="Cure"><div style="text-align:right"><h1>Avaliação postural por fotogrametria</h1>
    ${esc(me?.nome || '')} · ${esc(me?.conselho || '')} ${esc(me?.numero_conselho || '')}${me?.uf_conselho ? '/' + esc(me.uf_conselho) : ''}</div></header>
  <p><strong>Paciente:</strong> ${esc(p.nome_social || p.nome)}${p.data_nascimento ? ` · <strong>Nascimento:</strong> ${data(p.data_nascimento)}` : ''} · <strong>Data da avaliação:</strong> ${data(r.data_registro)}</p>
  ${bloco('Motivo e queixa', c.queixa)}
  ${figs.length ? `<div class="figs">${figs.join('')}</div>` : ''}
  ${M.length ? `<table><tr><th>Vista</th><th>Medida (protocolo SAPO)</th><th>Valor</th><th>Interpretação</th></tr>${M.map((m) =>
    `<tr><td>${esc(VISTAS[m.vista].nome)}</td><td>${esc(m.rot)}</td><td>${f1(m.v)}${m.un}${m.extra != null ? ` <small>(clássico ${f1(m.extra)}°)</small>` : ''}${m.cm != null ? ` <small>(≈ ${f1(Math.abs(m.cm))} cm)</small>` : ''}</td><td>${esc(m.dir || '')}</td></tr>`).join('')}</table>` : ''}
  ${bloco('Conclusão', c.conclusao)}${bloco('Conduta e reavaliação', c.plano)}${bloco('Observações', c.obs)}
  <footer>Método: fotogrametria com marcação de pontos anatômicos pelo protocolo SAPO; medidas angulares em graus e assimetrias pelo índice IA = (D − E) / média × 100.
    A fotogrametria não substitui exames de imagem (ex.: escanometria). Referências: Duarte M, Ferreira EA, Maldonado EP, Freitas AZ. Documentação sobre o SAPO — Software para Avaliação Postural (2005);
    Ferreira EAG et al. Postural assessment software (PAS/SAPO): validation and reliability. Clinics (2010);65(7):675-81;
    Ferreira EA et al. Quantitative assessment of postural alignment in young adults. J Manipulative Physiol Ther (2011);34(6):371-80.<br>
    Clínica Cure — Saúde e Desempenho · Gerado pelo Cure OS em ${new Date().toLocaleString('pt-BR')}. Informação sigilosa.</footer></body></html>`);
  j.document.close();
}
