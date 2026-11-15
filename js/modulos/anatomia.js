// Atlas anatômico vetorial próprio da Clínica Cure (15/11/2026) — base do mapa de força do laudo de dinamometria.
// Desenho original (não derivado de imagens de terceiros): músculos superficiais individualizados, sombreado e direção das fibras,
// vistas anterior e posterior, modelo masculino e feminino (proporções próprias + mama, pelve e abdome distintos).
// Camadas: (1) base anatômica cinza, (2) máscara de cada músculo recebe a cor calculada pelo sistema, (3) rótulos ficam no módulo chamador.
// Coordenadas da meia-figura da esquerda de quem olha (centro x = 100, altura 0–412); a outra metade é espelhada.

const r1 = (n) => Math.round(n * 10) / 10;
// Catmull-Rom fechado → curvas Bézier (contorno orgânico a partir de poucos pontos)
function caminho(pts) {
  const n = pts.length; let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])},${r1(p2[1])}`;
  }
  return d + 'Z';
}
const aberto = (pts) => `M${pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' L')}`;

// Proporções femininas: largura relativa por altura (ombros e cintura mais estreitos, pelve e quadril mais largos)
const FAIXAS_F = [[0, 0.94], [56, 0.92], [70, 0.86], [100, 0.88], [130, 0.89], [160, 0.83], [178, 0.88], [200, 1.04], [222, 1.08], [250, 1.03], [300, 0.96], [340, 0.95], [412, 0.94]];
function fator(y) {
  for (let i = 1; i < FAIXAS_F.length; i++) if (y <= FAIXAS_F[i][0]) {
    const [y0, k0] = FAIXAS_F[i - 1], [y1, k1] = FAIXAS_F[i]; return k0 + ((k1 - k0) * (y - y0)) / (y1 - y0);
  }
  return FAIXAS_F[FAIXAS_F.length - 1][1];
}
const deformar = (pts, fem) => (fem ? pts.map(([x, y]) => [100 + (x - 100) * fator(y), y]) : pts);

// ---------- silhueta (comum às duas vistas) ----------
const TRONCO = [[100, 50], [89, 51], [88, 61], [80, 66], [70, 70], [64, 76], [66, 92], [72, 105], [76, 120], [78, 140], [80, 160], [80.5, 176], [78, 190],
  [75.5, 204], [72, 220], [70, 240], [70, 262], [72.5, 284], [77, 300], [76, 313], [72, 332], [73, 352], [78, 375], [82, 392], [80, 401], [77, 406], [80, 411],
  [97, 411], [96.5, 402], [94, 392], [94.5, 372], [96.5, 345], [95.5, 322], [94.5, 306], [96, 290], [98, 262], [99.4, 234], [100, 227], [100, 190], [100, 120], [100, 60]];
const BRACO = [[66, 72], [57, 81], [52.5, 98], [52, 124], [51, 148], [49, 167], [45.5, 198], [42.5, 224], [41, 239], [47, 238], [51, 246],
  [55, 220], [60, 192], [63, 168], [66.5, 142], [71, 116], [73.5, 102], [73, 86]];
const MAO_F = [[41, 239], [36.5, 250], [33, 266], [34.5, 285], [38, 289], [42, 286], [45.5, 276], [48.5, 262], [51, 246], [47, 238]];
const MAO_B = MAO_F;
const MAO_PALMA = [[41.2, 238.5], [47.6, 238], [51, 246.5], [49.6, 258], [47.5, 262.5], [36.4, 262.5], [36.5, 252]];
const POLEGAR = [[48.5, 246], [51.2, 249], [53.2, 258], [52.4, 266], [50.6, 266.4], [49.6, 258], [47.8, 251]];
const PE_F = [[81, 394], [78.5, 403], [76.5, 407], [79.5, 411.5], [97.5, 411.5], [97, 403], [94.5, 394], [88, 391]];
const PE_B = [[81.5, 393], [79.5, 402], [80.5, 410.5], [96.5, 410.5], [96, 401], [94, 393], [88, 391]];

// ---------- músculos: [id, pontos, ângulo das fibras (graus, 0 = horizontal), profundo?] ----------
const ANT = [
  ['scm', [[89.5, 52], [93.5, 54], [98, 63], [97.5, 68], [93, 66.5], [88.5, 57]], 62],
  ['trap', [[88.5, 58], [84, 64], [73, 69.5], [66.5, 74], [71, 76.5], [82, 71], [89, 65]], -20],
  ['delt', [[64.5, 73.5], [72, 77], [74.5, 91], [70.5, 108], [65, 123], [58.5, 128], [54, 117], [52.5, 100], [55.5, 84]], 80],
  ['pec', [[98.5, 72.5], [85, 72], [73, 80], [70.5, 96], [72.5, 108], [80, 117.5], [92, 120], [98.5, 116]], 18],
  ['serr', [[74.5, 113], [80, 118.5], [81.5, 130], [79.5, 142], [76.5, 142], [74.5, 126]], -35],
  ['ra1', [[90.5, 122], [98.8, 122], [98.8, 139.5], [90.5, 140.5]], 90],
  ['ra2', [[90.5, 143], [98.8, 142.5], [98.8, 158], [90.5, 159]], 90],
  ['ra3', [[90.5, 161.5], [98.8, 161], [98.8, 177], [90.5, 178]], 90],
  ['ra4', [[90.5, 181], [98.8, 180], [98.8, 218], [96, 220], [92, 206]], 90],
  ['obl', [[80.5, 128], [88.5, 124], [89, 142], [89, 176], [90, 200], [86.5, 212], [80.5, 197], [80.5, 170], [80.5, 148]], 58],
  ['bic', [[66.5, 104], [70.5, 117], [68, 140], [64, 160], [60.5, 165], [57.5, 152], [56.5, 128], [60, 110]], 86],
  ['brach', [[55, 138], [57, 151], [56.5, 165], [52.5, 163], [52.2, 148]], 84],
  ['brrad', [[50, 160], [56.5, 165.5], [54.5, 190], [48.5, 214], [44.5, 214], [45.5, 190]], 76],
  ['flex', [[58.5, 170], [63, 170], [60.5, 194], [54.5, 224], [50.5, 237], [46.5, 236], [48.5, 215], [54.5, 191]], 80],
  ['iliop', [[81.5, 205], [88.5, 205], [93, 217], [88, 223], [82, 214]], 60, true],
  ['tfl', [[76.5, 198], [80.5, 206], [78.5, 226], [73.5, 237], [71.3, 222], [72.5, 206]], 76],
  ['add', [[88.5, 218], [97, 224], [99, 241], [96.5, 263], [92.5, 251], [89.5, 234]], 68],
  ['sart', [[80, 197], [84, 200], [90, 236], [96, 272], [97, 296], [93.2, 298], [91.3, 276], [85.3, 240], [78.5, 204]], 62],
  ['rf', [[82.5, 213], [87.5, 214], [89.3, 240], [88.5, 272], [85.5, 289], [81.5, 289], [78.5, 266], [78.5, 236]], 90],
  ['vl', [[73.3, 233], [78.3, 237], [78.3, 266], [81.3, 290], [77.5, 298], [73.3, 286], [71.3, 262], [71.3, 243]], 84],
  ['vm', [[90, 262], [93.3, 270], [94.3, 290], [89.5, 298.5], [84.5, 294], [86.5, 284], [89, 273]], 68],
  ['tib', [[80.3, 312], [85.3, 312], [86.3, 340], [85.3, 370], [88.3, 388], [85.3, 390], [81.3, 370], [79.3, 340]], 86],
  ['fib', [[75.3, 314], [79.1, 314.5], [79, 340], [80.2, 372], [78.3, 378], [75.3, 350], [73.3, 330]], 88],
  ['gasm', [[90, 312], [95, 316], [96, 334], [93.5, 352], [89.5, 346], [88.3, 328]], 90],
  ['sol', [[89.3, 352], [94, 354], [94.2, 372], [91.3, 380], [89.3, 368]], 88],
];
const POST = [
  ['trap', [[100, 52], [90, 54], [88.5, 62], [70, 72], [66, 76.5], [76, 84], [88, 100], [94, 120], [100, 150]], -22],
  ['supra', [[74.5, 79], [88, 86.5], [86.5, 91], [74, 85]], 8, true],
  ['delt', [[64.5, 74], [70.5, 78], [72.5, 92], [68.5, 110], [62.5, 126], [57.5, 128], [53.5, 116], [52.5, 98], [56, 82]], 82],
  ['infra', [[74, 89], [87.5, 99.5], [92, 112], [84.5, 118.5], [76.5, 112], [72.5, 100]], 22],
  ['teres', [[72.5, 112], [82, 118], [84, 124.5], [76, 124.5], [70.5, 118]], 12],
  ['lat', [[76.5, 119], [84, 122], [94, 124], [100, 150], [100, 186], [92, 190], [84, 182], [80, 160], [78, 140]], -55],
  ['fasc', [[94, 152], [100, 152], [100, 190], [94, 192.5], [91.5, 176]], 90],
  ['tri', [[60, 100], [68.5, 108], [68.5, 130], [65.5, 155], [60.5, 166], [55.5, 160], [53.5, 138], [54.5, 112]], 88],
  ['ext', [[52.5, 164], [60.5, 168], [58.5, 196], [52.5, 226], [47.5, 238], [43.5, 236], [44.5, 210], [48.5, 186]], 80],
  ['gmed', [[80, 190], [92, 190], [94.5, 200], [84.5, 206], [76.5, 211], [76, 200]], -30],
  ['rotext', [[83, 213], [97, 213], [97, 223], [83, 223]], 5, true],
  ['gmax', [[100, 196], [92, 196.5], [80, 206.5], [74.5, 224], [78, 240], [90, 244.5], [100, 238]], -38],
  ['itb', [[72.3, 226], [76.3, 232], [77.3, 296], [74.3, 296], [70.6, 262]], 90],
  ['bf', [[76.5, 244], [82.5, 244.5], [83.3, 270], [80.3, 298], [76.3, 298], [75.3, 272]], 80],
  ['st', [[84.5, 245], [90, 245], [90.3, 270], [88.3, 296], [84.3, 296], [83.6, 270]], 88],
  ['sm', [[90.8, 246.5], [96.5, 248], [97.3, 272], [93.3, 296], [89.3, 296], [91.2, 270]], 92],
  ['addm', [[93, 239.5], [99.4, 236], [99.2, 254], [96.5, 262], [93.3, 252]], 70],
  ['gasl', [[76.5, 302], [84.3, 304], [85.3, 330], [82.3, 350], [78.3, 346], [75.3, 326]], 90],
  ['gasm', [[86.3, 304], [95.3, 304], [97, 326], [93.3, 354], [88.3, 352], [86.3, 330]], 90],
  ['sol', [[75.3, 341], [80, 350], [84.3, 356], [91.3, 356], [96.3, 342], [95.3, 366], [90.3, 380], [80.3, 380], [76.3, 362]], 90],
  ['fibp', [[73.3, 322], [76, 324], [76.3, 360], [79.3, 384], [77.3, 386], [73.3, 358]], 90],
  ['tibp', [[91, 358], [95.8, 352], [95.2, 378], [92.3, 388], [89.3, 378]], 88, true],
];
// Variante feminina: reto do abdome sem segmentação marcada; demais formas seguem as proporções femininas
const RA_FEM = [['ra', [[90.5, 122], [98.8, 122], [98.8, 218], [96, 220], [91.5, 204], [90.5, 170]], 90]];
const MAMA = [[97.5, 104], [88, 101], [79.5, 106], [76.5, 116], [79.5, 125.5], [87.5, 130], [95.5, 128.5], [98.5, 120]];

// Tendões e pele visíveis (claros, sem cor de resultado)
const CLAROS = {
  F: [['patela', [[81, 293], [88, 293], [89.5, 301], [85, 307], [80.5, 301]]], ['lig_pat', [[82.6, 305], [87, 305], [86.4, 314], [83.2, 314]]],
    ['punho', [[41.5, 236], [48, 235.5], [49.5, 241], [42, 242]]], ['tornoz', [[82.5, 385], [93, 385], [93.3, 392], [82, 392]]],
    ['alba', [[98.9, 121], [100, 121], [100, 222], [99.2, 222]]], ['ingu', [[80.5, 196], [83, 197], [96, 221], [94.5, 222.5]]]],
  B: [['aquiles', [[84.2, 368], [89, 368], [88.6, 394], [85, 394]]], ['punho', [[41.5, 236], [48, 235.5], [49.5, 241], [42, 242]]],
    ['popl', [[80.5, 297], [92, 297], [91, 304], [81.5, 304]]], ['espinha', [[99.2, 54], [100, 54], [100, 150], [99.2, 150]]]],
};
// (reservado) contornos faciais — o rosto é feito por sombreado esculpido na cabeça
const FACE = [
  ['front', [[100, 9], [91, 10.5], [87, 17], [89, 22], [100, 21.5]], 90], ['temp', [[86.5, 18], [89, 23], [88.5, 31], [85.5, 30], [85.2, 22]], 70],
  ['orb', [[96.5, 25], [92, 24], [88.6, 27.5], [91.5, 31], [96.5, 30.5]], 0], ['mass', [[86.8, 33], [91, 34], [92, 43], [89, 46], [86.6, 40]], 80],
  ['oris', [[100, 40.8], [96.5, 41], [95.6, 43], [96.8, 45], [100, 45.2]], 0]];

// Movimento → músculos (primário primeiro) por vista; profundos aparecem tracejados (projeção na superfície)
export const MUSCULOS = {
  tz_df: { F: ['tib'] },
  tz_fp: { B: ['gasm', 'gasl', 'sol'], F: ['gasm', 'sol'] },
  tz_inv: { B: ['tibp'], F: ['tib'] },
  tz_ev: { F: ['fib'], B: ['fibp'] },
  jo_ext: { F: ['rf', 'vl', 'vm'] },
  jo_flex: { B: ['bf', 'st', 'sm'] },
  qd_flex: { F: ['iliop', 'rf', 'sart', 'tfl'] },
  qd_ext: { B: ['gmax'] },
  qd_abd: { B: ['gmed'], F: ['tfl'] },
  qd_adu: { F: ['add'], B: ['addm'] },
  qd_ri: { F: ['tfl'], B: ['gmed'] },
  qd_re: { B: ['rotext', 'gmax'] },
  om_flex: { F: ['delt'] },
  om_abd: { B: ['delt', 'supra'] },
  om_ri: { F: ['pec'], B: ['teres'] },
  om_re: { B: ['infra'] },
  co_flex: { F: ['bic', 'brach', 'brrad'] },
  co_ext: { B: ['tri'] },
  grip: { F: ['flex'], B: ['ext'] },
};
export const PROFUNDOS = new Set([...ANT, ...POST].filter((m) => m[3]).map((m) => m[0]));

const centro = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

// pint: { idMusculo: { cor, op: { esq, dir } } } — esq/dir = metade da esquerda/direita de quem olha
export function corpo(vk, sexo, pint = {}) {
  const fem = String(sexo || '').toUpperCase()[0] === 'F';
  const lista = (vk === 'F' ? ANT : POST).flatMap((m) => (fem && m[0] === 'ra1' ? RA_FEM : fem && /^ra[234]$/.test(m[0]) ? [] : [m]));
  const M = lista.map(([id, pts, ang, prof]) => ({ id, pts: deformar(pts, fem), ang, prof }));
  const angs = [...new Set([...M, ...FACE.map(([id, pts, ang]) => ({ ang }))].map((m) => Math.round(m.ang / 5) * 5))];
  const cil = (a) => `cl${vk}${a < 0 ? 'm' + -a : a}`;
  const fibra = (a) => `fb${vk}${a < 0 ? 'm' + -a : a}`;
  const defs = `<defs>
    <radialGradient id="mg${vk}" cx=".42" cy=".34" r=".78"><stop offset="0" stop-color="#FBFBFA"/><stop offset=".55" stop-color="#DDE0DC"/><stop offset="1" stop-color="#B4B9B5"/></radialGradient>
    <radialGradient id="mama${vk}" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#FAFAF9"/><stop offset=".7" stop-color="#E3E6E2"/><stop offset="1" stop-color="#BFC4C0"/></radialGradient>
    <radialGradient id="pele${vk}" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#F7F7F5"/><stop offset="1" stop-color="#CDD1CD"/></radialGradient>
    <linearGradient id="sil${vk}" x1="0" x2="1"><stop offset="0" stop-color="#C9CDC9"/><stop offset="1" stop-color="#D3D7D3"/></linearGradient>
    <filter id="vol${vk}" x="-10%" y="-5%" width="120%" height="110%"><feGaussianBlur in="SourceAlpha" stdDeviation="3.6" result="b"/>
      <feComposite in="SourceAlpha" in2="b" operator="arithmetic" k2="1" k3="-1" result="borda"/><feFlood flood-color="#3E4643" flood-opacity=".62"/><feComposite in2="borda" operator="in"/></filter>
    <filter id="sulco${vk}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".55"/></filter>
    <pattern id="prof${vk}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#fff" stroke-opacity=".55" stroke-width="1"/></pattern>
    ${angs.map((a) => `<pattern id="${fibra(a)}" width="2.1" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(${a - 90})"><path d="M.6 0 Q.9 3 .6 6" stroke="#2E3337" stroke-opacity="${fem ? 0.075 : 0.095}" stroke-width=".38" fill="none"/></pattern>
      <linearGradient id="${cil(a)}" gradientTransform="rotate(${a - 90} .5 .5)"><stop offset="0" stop-color="#C4C9C5"/><stop offset=".3" stop-color="#E9EBE8"/><stop offset=".5" stop-color="#FAFBFA"/><stop offset=".72" stop-color="#E4E7E3"/><stop offset="1" stop-color="#BDC2BE"/></linearGradient>`).join('')}
    <filter id="sb${vk}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".9"/></filter>
    <linearGradient id="luz${vk}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#1F2326" stop-opacity=".10"/></linearGradient>
  </defs>`;
  const metade = (lado) => {
    const pele = (pts, extra = '') => `<path d="${caminho(deformar(pts, fem))}" fill="url(#pele${vk})" stroke="#9AA19C" stroke-width=".5"${extra}/>`;
    let s = `<path d="${caminho(deformar(TRONCO, fem))}" fill="url(#sil${vk})"/><path d="${caminho(deformar(BRACO, fem))}" fill="url(#sil${vk})"/>`;
    const dedo = (x, y0, y1, w = 1.45, inc = 0) => [[x - w, y0], [x + w, y0], [x + w + inc * 0.6, y1 - 1.6], [x + inc, y1], [x - w + inc * 0.6, y1 - 1.6]];
    const dedos = vk === 'F' ? [dedo(37.2, 259, 280.5, 1.35, -0.8), dedo(40.1, 261, 286, 1.45, -0.4), dedo(43.1, 261, 285, 1.45), dedo(46, 259, 280, 1.3, 0.5)]
      : [dedo(37.4, 259, 280, 1.35, -0.8), dedo(40.3, 261, 285, 1.45, -0.4), dedo(43.2, 261, 284.5, 1.45), dedo(46, 259, 279.5, 1.3, 0.5)];
    s += dedos.map((d) => pele(d)).join('') + pele(MAO_PALMA) + pele(POLEGAR) + pele(vk === 'F' ? PE_F : PE_B);
    s += [[[84, 405], [84.5, 410]], [[88, 404.5], [88.3, 410.5]], [[92, 404], [92.2, 410.5]]].map((d) => `<path d="${aberto(deformar(d, fem))}" stroke="#AEB4AF" stroke-width=".4" fill="none"/>`).join('');
    const sup = M.filter((m) => !m.prof);
    s += `<g filter="url(#sb${vk})" opacity=".28" transform="translate(.3 .5)">${sup.map((m) => `<path d="${caminho(m.pts)}" fill="#4A5250"/>`).join('')}</g>`;
    for (const m of sup) {
      const d = caminho(m.pts), p = pint[m.id], a = Math.round(m.ang / 5) * 5;
      s += `<path d="${d}" fill="url(#${cil(a)})"/>`;
      if (p) s += `<path d="${d}" fill="${p.cor}" fill-opacity="${p.op[lado] * 0.82}" style="mix-blend-mode:multiply"/>`;
      s += `<path d="${d}" fill="url(#${fibra(a)})" stroke="${p ? p.cor : '#8A918C'}" stroke-opacity="${p ? 0.9 : 0.9}" stroke-width="${p ? 0.55 : 0.3}"/>`;
    }
    s += `<g filter="url(#sulco${vk})" fill="none" stroke="#5B6360" stroke-width=".9" opacity=".32">${sup.map((m) => `<path d="${caminho(m.pts)}"/>`).join('')}</g>`;

    if (fem && vk === 'F') s += `<path d="${caminho(deformar(MAMA, fem))}" fill="url(#mama${vk})" fill-opacity=".92" stroke="#A3A9A5" stroke-width=".4"/>`
      + (pint.pec ? `<path d="${caminho(deformar(MAMA, fem))}" fill="${pint.pec.cor}" fill-opacity="${pint.pec.op[lado] * 0.35}"/>` : '');
    s += CLAROS[vk].map(([, pts]) => pele(pts)).join('');
    // profundos: só aparecem quando testados (contorno tracejado + hachura)
    for (const m of M) {
      const p = pint[m.id]; if (!m.prof || !p) continue;
      const d = caminho(m.pts);
      s += `<path d="${d}" fill="${p.cor}" fill-opacity="${p.op[lado] * 0.85}"/><path d="${d}" fill="url(#prof${vk})" stroke="${p.cor}" stroke-width=".9" stroke-dasharray="2 1.4"/>`;
    }
    return s;
  };
  // cabeça (comum, sem espelhar)
  const cab = `<ellipse cx="100" cy="29" rx="${fem ? 14.6 : 15.5}" ry="${fem ? 22 : 23}" fill="url(#pele${vk})" stroke="#9AA19C" stroke-width=".5"/>
    ${vk === 'F' ? `<ellipse cx="${fem ? 85.8 : 84.8}" cy="31" rx="1.8" ry="4.2" fill="#D4D8D4"/><ellipse cx="${fem ? 114.2 : 115.2}" cy="31" rx="1.8" ry="4.2" fill="#D4D8D4"/>
      <g filter="url(#sulco${vk})" fill="#4E5653">
        <ellipse cx="93.6" cy="28.5" rx="3.4" ry="2.1" opacity=".38"/><ellipse cx="106.4" cy="28.5" rx="3.4" ry="2.1" opacity=".38"/>
        <ellipse cx="100" cy="35.5" rx="1.5" ry="3.6" opacity=".16"/><ellipse cx="100" cy="38.6" rx="2.6" ry=".9" opacity=".32"/>
        <ellipse cx="100" cy="42.6" rx="3.3" ry=".55" opacity=".42"/><ellipse cx="100" cy="46.6" rx="3.6" ry="1.2" opacity=".14"/>
        <ellipse cx="${fem ? 88.6 : 87.8}" cy="37" rx="1.8" ry="6" opacity=".16"/><ellipse cx="${fem ? 111.4 : 112.2}" cy="37" rx="1.8" ry="6" opacity=".16"/></g>
      <g fill="#fff"><ellipse cx="100" cy="17" rx="7" ry="4" opacity=".35"/><ellipse cx="100" cy="33" rx=".8" ry="2.6" opacity=".4"/></g>`
      : `<path d="M${fem ? 87 : 86},20 Q100 ${fem ? 2 : 5} ${fem ? 113 : 114},20" fill="none" stroke="#B9BEBA" stroke-width=".6"/>`}
`;
  const sil = caminho(deformar(TRONCO, fem)), br = caminho(deformar(BRACO, fem));
  const luz = `<g fill="url(#luz${vk})" style="mix-blend-mode:multiply"><path d="${sil}"/><path d="${br}"/><path transform="translate(200 0) scale(-1 1)" d="${sil}"/><path transform="translate(200 0) scale(-1 1)" d="${br}"/></g>`;
  const cabD = `<ellipse cx="100" cy="29" rx="${fem ? 14.6 : 15.5}" ry="${fem ? 22 : 23}"/>`;
  const vol = `<g filter="url(#vol${vk})" style="mix-blend-mode:multiply">${cabD}</g>`
    + ['', ' transform="translate(200 0) scale(-1 1)"'].map((t) => `<g filter="url(#vol${vk})" style="mix-blend-mode:multiply"${t}><path d="${sil}"/></g><g filter="url(#vol${vk})" style="mix-blend-mode:multiply"${t}><path d="${br}"/></g>`).join('');
  const svg = `${defs}${cab}<g>${metade('esq')}</g><g transform="translate(200 0) scale(-1 1)">${metade('dir')}</g>${vol}${luz}`;
  // âncora do rótulo: centro do músculo na metade indicada
  const ancora = (id, lado) => {
    const m = M.find((x) => x.id === id); if (!m) return null;
    const [x, y] = centro(m.pts); return [lado === 'esq' ? x : 200 - x, y];
  };
  return { svg, ancora };
}
