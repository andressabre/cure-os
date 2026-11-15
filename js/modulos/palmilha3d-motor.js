// Motor de palmilha 3D (v2, 15/11/2026) — roda no navegador, sem servidor: o escaneamento não sai do computador.
// Referencial canônico: x = comprimento (calcanhar → dedos), y = largura com MEDIAL positivo (pé esquerdo é espelhado), z = altura; grade de 1 mm.
// Calibrado em 21 pares escaneamento × palmilha aprovada da Cure (erro de espessura no interior ≈ 1,1 mm; contorno ≈ 97% do desenho aprovado).
// Contorno = moldes próprios (curva contínua por Fourier) escalados pelo número BR; espessura = base + preenchimento do arco + borda + ajustes.

// ---------------- utilidades de grade ----------------
const grade = (nx, ny, v = 0) => ({ nx, ny, a: new Float32Array(nx * ny).fill(v) });
const at = (g, i, j) => g.a[i * g.ny + j];
const sig = (x, c, w) => 1 / (1 + Math.exp(-(x - c) / w));

function gauss1d(s) { const r = Math.ceil(3 * s), k = []; let t = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * s * s)); k.push(v); t += v; } return k.map((v) => v / t); }
function blur(a, nx, ny, s) {
  const k = gauss1d(s), r = (k.length - 1) / 2, tmp = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { let v = 0; for (let q = -r; q <= r; q++) { const ii = Math.min(nx - 1, Math.max(0, i + q)); v += k[q + r] * a[ii * ny + j]; } tmp[i * ny + j] = v; }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { let v = 0; for (let q = -r; q <= r; q++) { const jj = Math.min(ny - 1, Math.max(0, j + q)); v += k[q + r] * tmp[i * ny + jj]; } out[i * ny + j] = v; }
  return out;
}
function morf(m, nx, ny, it, dil) {
  let a = m;
  for (let n = 0; n < it; n++) {
    const b = new Uint8Array(a.length);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      let v = dil ? 0 : 1;
      for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj, x = ii < 0 || jj < 0 || ii >= nx || jj >= ny ? 0 : a[ii * ny + jj];
        if (dil && x) { v = 1; break; } if (!dil && !x) { v = 0; break; }
      }
      b[i * ny + j] = v;
    }
    a = b;
  }
  return a;
}
const fechar = (m, nx, ny, it) => morf(morf(m, nx, ny, it, true), nx, ny, it, false);
const abrir = (m, nx, ny, it) => morf(morf(m, nx, ny, it, false), nx, ny, it, true);
function rotular(m, nx, ny) {   // maior componente conexo
  const lab = new Int32Array(m.length), tam = [0]; let n = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue; n++; let c = 0; const pilha = [s]; lab[s] = n;
    while (pilha.length) { const p = pilha.pop(); c++; const i = (p / ny) | 0, j = p % ny;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const q = ii * ny + jj; if (m[q] && !lab[q]) { lab[q] = n; pilha.push(q); } } }
    tam.push(c);
  }
  const k = tam.indexOf(Math.max(...tam)); const out = new Uint8Array(m.length); for (let s = 0; s < m.length; s++) out[s] = lab[s] === k && k > 0 ? 1 : 0; return out;
}
function preencherBuracos(m, nx, ny) {   // inunda o fundo pela borda
  const fora = new Uint8Array(m.length), pilha = [];
  const push = (i, j) => { const q = i * ny + j; if (!m[q] && !fora[q]) { fora[q] = 1; pilha.push(q); } };
  for (let i = 0; i < nx; i++) { push(i, 0); push(i, ny - 1); } for (let j = 0; j < ny; j++) { push(0, j); push(nx - 1, j); }
  while (pilha.length) { const p = pilha.pop(), i = (p / ny) | 0, j = p % ny; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) push(ii, jj); } }
  const out = new Uint8Array(m.length); for (let s = 0; s < m.length; s++) out[s] = fora[s] ? 0 : 1; return out;
}
function distancia(m, nx, ny) {   // distância (mm) até a borda da máscara — chanfro 3-4
  const INF = 1e9, d = new Float32Array(m.length);
  for (let s = 0; s < m.length; s++) d[s] = m[s] ? INF : 0;
  const g = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : d[i * ny + j]);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const s = i * ny + j; if (!d[s]) continue; d[s] = Math.min(d[s], g(i - 1, j) + 3, g(i, j - 1) + 3, g(i - 1, j - 1) + 4, g(i - 1, j + 1) + 4); }
  for (let i = nx - 1; i >= 0; i--) for (let j = ny - 1; j >= 0; j--) { const s = i * ny + j; if (!d[s]) continue; d[s] = Math.min(d[s], g(i + 1, j) + 3, g(i, j + 1) + 3, g(i + 1, j + 1) + 4, g(i + 1, j - 1) + 4); }
  for (let s = 0; s < m.length; s++) d[s] /= 3; return d;
}
function preencherNaN(a, nx, ny) {   // completa lacunas pela média dos vizinhos (difusão)
  let falta = true, n = 0;
  while (falta && n++ < 400) { falta = false; const b = a.slice();
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const s = i * ny + j; if (!Number.isNaN(a[s])) continue; let v = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const x = a[ii * ny + jj]; if (!Number.isNaN(x)) { v += x; c++; } }
      if (c) b[s] = v / c; else falta = true; }
    a = b; }
  return a;
}
function eigSim3(A) {   // Jacobi para matriz simétrica 3×3 → autovalores/autovetores (colunas)
  const a = A.map((r) => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1; for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-10) break;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
  }
  return { val: [a[0][0], a[1][1], a[2][2]], vec: v };
}
function bilinear(g, x, y) {   // g: {x0,y0,nx,ny,a} grade de 1 mm
  const fi = x - g.x0, fj = y - g.y0, i = Math.floor(fi), j = Math.floor(fj);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) { const ii = Math.min(g.nx - 1, Math.max(0, Math.round(fi))), jj = Math.min(g.ny - 1, Math.max(0, Math.round(fj))); return g.a[ii * g.ny + jj]; }
  const u = fi - i, w = fj - j, A = g.a;
  return (1 - u) * (1 - w) * A[i * g.ny + j] + u * (1 - w) * A[(i + 1) * g.ny + j] + (1 - u) * w * A[i * g.ny + j + 1] + u * w * A[(i + 1) * g.ny + j + 1];
}
const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))] : NaN; };

// ---------------- 1. escaneamento (.obj) → mapa plantar canônico ----------------
export function lerObj(texto) {
  const v = [], f = [];
  for (const l of texto.split('\n')) {
    if (l.startsWith('v ')) { const p = l.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (l.startsWith('f ')) { const p = l.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1); for (let k = 1; k + 1 < p.length; k++) f.push(p[0], p[k], p[k + 1]); }
  }
  return { v: Float64Array.from(v), f: Uint32Array.from(f) };
}

export function processarEscaneamento(obj) {
  const { v, f } = obj; const usados = new Uint8Array(v.length / 3); for (const i of f) usados[i] = 1;
  const P = []; for (let i = 0; i < usados.length; i++) if (usados[i]) P.push([v[3 * i], v[3 * i + 1], v[3 * i + 2]]);
  for (let t = 0; t < f.length; t += 3) { const a = f[t], b = f[t + 1], c = f[t + 2]; P.push([(v[3 * a] + v[3 * b] + v[3 * c]) / 3, (v[3 * a + 1] + v[3 * b + 1] + v[3 * c + 1]) / 3, (v[3 * a + 2] + v[3 * b + 2] + v[3 * c + 2]) / 3]); }
  if (P.length < 500) throw new Error('Escaneamento vazio ou em formato não reconhecido (use .obj).');
  const m = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += (p[a] - m[a]) * (p[b] - m[b]);
  const { val, vec } = eigSim3(C); const ord = [0, 1, 2].sort((a, b) => val[b] - val[a]);
  let R = ord.map((k) => [vec[0][k], vec[1][k], vec[2][k]]);   // linhas = eixos (comprimento, largura, espessura)
  const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (det < 0) R[2] = R[2].map((x) => -x);
  // normais das faces: superfície plantar voltada para -z
  let nz = 0; for (let t = 0; t < f.length; t += 3) { const A = [0, 1, 2].map((k) => v[3 * f[t] + k]), B = [0, 1, 2].map((k) => v[3 * f[t + 1] + k]), D = [0, 1, 2].map((k) => v[3 * f[t + 2] + k]);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [D[0] - A[0], D[1] - A[1], D[2] - A[2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const L = Math.hypot(...n) || 1; nz += (n[0] * R[2][0] + n[1] * R[2][1] + n[2] * R[2][2]) / L; }
  if (nz > 0) { R[2] = R[2].map((x) => -x); R[1] = R[1].map((x) => -x); }
  const Q = P.map((p) => { const d = [p[0] - m[0], p[1] - m[1], p[2] - m[2]]; return R.map((r) => r[0] * d[0] + r[1] * d[1] + r[2] * d[2]); });
  // grade 1 mm: menor z por célula
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const q of Q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2; const nx = Math.ceil(x1 - x0) + 3, ny = Math.ceil(y1 - y0) + 3;
  let Z = new Float32Array(nx * ny).fill(NaN);
  for (const q of Q) { const s = Math.floor(q[0] - x0) * ny + Math.floor(q[1] - y0); if (!(Z[s] <= q[2])) Z[s] = q[2]; }
  let mk = new Uint8Array(nx * ny); for (let s = 0; s < mk.length; s++) mk[s] = Number.isNaN(Z[s]) ? 0 : 1;
  mk = rotular(abrir(preencherBuracos(fechar(mk, nx, ny, 3), nx, ny), nx, ny, 2), nx, ny);
  Z = blur(preencherNaN(Z, nx, ny), nx, ny, 1.2);
  let g = { x0: x0 + 0.5, y0: y0 + 0.5, nx, ny, Z, mk };
  g = orientar(g);
  return nivelar(g);
}

function orientar(g) {
  const { nx, ny } = g; const xs = []; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) xs.push(i);
  const i0 = Math.min(...xs), i1 = Math.max(...xs), L = i1 - i0;
  const larg = (a, b) => { let lo = Infinity, hi = -Infinity; for (let i = Math.round(i0 + a * L); i <= Math.round(i0 + b * L); i++) for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) { lo = Math.min(lo, j); hi = Math.max(hi, j); } return hi - lo; };
  const flipX = larg(0, 0.2) > larg(0.8, 1) && larg(0.05, 0.25) > larg(0.65, 0.85);
  const tr = (fx, fy) => { const Z = new Float32Array(nx * ny), mk = new Uint8Array(nx * ny);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const s = (fx ? nx - 1 - i : i) * ny + (fy ? ny - 1 - j : j); Z[i * ny + j] = g.Z[s]; mk[i * ny + j] = g.mk[s]; }
    g.Z = Z; g.mk = mk; };
  if (flipX) tr(true, false);
  // medial (+y) = lado mais alto no médio-pé
  const xs2 = []; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) xs2.push(i);
  const a0 = Math.min(...xs2), Ln = Math.max(...xs2) - a0;
  let sy = 0, c = 0; for (let i = Math.round(a0 + 0.3 * Ln); i < a0 + 0.65 * Ln; i++) for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) { sy += j; c++; }
  const jc = sy / c; let hi = 0, ch = 0, lo = 0, cl = 0;
  for (let i = Math.round(a0 + 0.3 * Ln); i < a0 + 0.65 * Ln; i++) for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) { if (j > jc) { hi += g.Z[i * ny + j]; ch++; } else { lo += g.Z[i * ny + j]; cl++; } }
  const espelhou = lo / cl > hi / ch;
  if (espelhou) tr(false, true);
  // origem: calcanhar em x=0; y centrado no eixo do grid original
  g.x0 = -a0; g.y0 = -(ny - 1) / 2;
  return g;
}

function nivelar(g) {
  const { nx, ny } = g; let L = 0; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) L = Math.max(L, g.x0 + i);
  const pts = [];
  for (const [a, b] of [[0.05, 0.28], [0.62, 0.82]]) {
    const z = [], ij = [];
    for (let i = 0; i < nx; i++) { const x = g.x0 + i; if (x < a * L || x > b * L) continue; for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) { z.push(g.Z[i * ny + j]); ij.push([x, g.y0 + j, g.Z[i * ny + j]]); } }
    const t = pct(z, 10); for (const p of ij) if (p[2] <= t) pts.push(p);
  }
  // mínimos quadrados z = c0 + c1 x + c2 y
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (const [x, y, z] of pts) { const u = [1, x, y]; for (let a = 0; a < 3; a++) { r[a] += u[a] * z; for (let b = 0; b < 3; b++) S[a][b] += u[a] * u[b]; } }
  const c = resolver3(S, r);
  const H = new Float32Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) H[i * ny + j] = Math.max(0, g.Z[i * ny + j] - (c[0] + c[1] * (g.x0 + i) + c[2] * (g.y0 + j)));
  let ymin = Infinity, ymax = -Infinity; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (g.mk[i * ny + j]) { ymin = Math.min(ymin, g.y0 + j); ymax = Math.max(ymax, g.y0 + j); }
  return { x0: g.x0, y0: g.y0, nx, ny, H, mask: g.mk, comprimento: L, largura: ymax - ymin };
}
function resolver3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let k2 = c; k2 < 4; k2++) M[r][k2] -= k * M[c][k2]; } }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

// ---------------- 2. moldes de contorno ----------------
const T_EST = [0.02, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.98];
export const MOLDES = {
  tenis: { nome: 'Tênis feminino', lat: [6.8, 9.4, 11.8, 13.2, 13.6, 15.0, 17.6, 19.6, 19.4, 17.0, 13.2, 9.7, 6.6], med: [6.8, 9.4, 11.8, 12.9, 12.8, 13.2, 13.9, 14.3, 15.4, 15.3, 13.0, 9.8, 6.8], extra: 0, calcado: 'tenis' },
  masculino: { nome: 'Tênis masculino', lat: [6.6, 9.5, 11.3, 13.0, 14.5, 16.4, 18.0, 19.0, 18.7, 17.0, 13.4, 9.9, 7.0], med: [6.8, 9.6, 11.2, 11.9, 11.8, 12.1, 12.7, 13.7, 14.8, 14.9, 12.4, 9.5, 6.3], extra: 0, calcado: 'tenis' },
  infantil: { nome: 'Infantil', lat: [7.2, 10.3, 12.8, 14.8, 16.1, 17.7, 19.8, 21.5, 21.6, 19.1, 14.5, 10.8, 7.4], med: [7.9, 10.9, 12.7, 13.5, 13.6, 13.9, 14.5, 15.1, 16.1, 15.8, 13.4, 10.8, 7.9], extra: 0, calcado: 'tenis' },
  chinelo: { nome: 'Chinelo', lat: [9.7, 12.3, 13.9, 15.4, 16.6, 18.1, 19.7, 21.7, 23.2, 22.9, 18.3, 13.3, 8.7], med: [9.2, 12.1, 13.8, 13.1, 11.5, 10.2, 10.2, 12.1, 14.0, 14.1, 12.3, 9.9, 7.6], extra: 8, calcado: 'chinelo' },
};
export const LARGURAS = { estreita: 0.96, normal: 1.0, larga: 1.06 };
export const comprimentoPorNumero = (br) => ((br + 2) / 1.5) * 10;

function pchip(xs, ys) {   // interpolação monotônica (Fritsch–Carlson)
  const n = xs.length, h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / d[i - 1] + (h[i] + 2 * h[i - 1]) / d[i]);
  return (x) => { let i = 0; while (i < n - 2 && x > xs[i + 1]) i++; const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]; };
}
export function molde(nome, L, largura = 'normal', harm = 14, n = 720) {
  const md = MOLDES[nome], f = typeof largura === 'number' ? largura : LARGURAS[largura] || 1;
  const ganho = (t) => (t > 0.45 ? f : 1 + (f - 1) * 0.5);
  const ts = [0, ...T_EST, 1], med = [0, ...md.med.map((m, k) => m * ganho(T_EST[k])), 0].map((v) => (v / 100) * L), lat = [0, ...md.lat.map((m, k) => m * ganho(T_EST[k])), 0].map((v) => (v / 100) * L);
  const pm = pchip(ts, med), pl = pchip(ts, lat), pts = [];
  const meio = n / 2;
  for (let k = 0; k < meio; k++) { const t = k / (meio - 1), cap = Math.sqrt(Math.max(0, Math.min(1, t / 0.06, (1 - t) / 0.05))); pts.push([t * L, Math.max(0, pm(t)) * cap + 1e-3]); }
  for (let k = meio - 1; k >= 0; k--) { const t = k / (meio - 1), cap = Math.sqrt(Math.max(0, Math.min(1, t / 0.06, (1 - t) / 0.05))); pts.push([t * L, -(Math.max(0, pl(t)) * cap + 1e-3)]); }
  // suavização por Fourier
  const N = pts.length, re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k < N; k++) { if (k > harm && k < N - harm) continue; let a = 0, b = 0; for (let t = 0; t < N; t++) { const ang = (-2 * Math.PI * k * t) / N; a += pts[t][0] * Math.cos(ang) - pts[t][1] * Math.sin(ang); b += pts[t][0] * Math.sin(ang) + pts[t][1] * Math.cos(ang); } re[k] = a; im[k] = b; }
  const out = [];
  for (let t = 0; t < N; t++) { let a = 0, b = 0; for (let k = 0; k < N; k++) { if (k > harm && k < N - harm) continue; const ang = (2 * Math.PI * k * t) / N; a += re[k] * Math.cos(ang) - im[k] * Math.sin(ang); b += re[k] * Math.sin(ang) + im[k] * Math.cos(ang); } out.push([a / N, b / N]); }
  let xmin = Infinity, xmax = -Infinity; for (const p of out) { xmin = Math.min(xmin, p[0]); xmax = Math.max(xmax, p[0]); }
  return out.map(([x, y]) => [((x - xmin) / (xmax - xmin)) * L, y]);
}

// ---------------- geometria 2D ----------------
export function dentroPoligono(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
function distSeg(px, py, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy); }
function distPoligono(P, x, y) { let d = Infinity; for (let i = 0, j = P.length - 1; i < P.length; j = i++) d = Math.min(d, distSeg(x, y, P[j], P[i])); return d; }
function linhaMedia(P, x) { const ys = []; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((xi - x) * (xj - x) <= 0 && xi !== xj) ys.push(yi + ((x - xi) / (xj - xi)) * (yj - yi)); } return [x, (Math.min(...ys) + Math.max(...ys)) / 2]; }
function reamostrar(P, passo) {
  const out = [], n = P.length; let acc = 0;
  out.push(P[0]);
  for (let i = 1; i <= n; i++) { const a = P[i - 1], b = P[i % n]; let L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t0 = 0;
    while (acc + L - t0 >= passo) { const t = t0 + (passo - acc); out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t0 = t; acc = 0; }
    acc += L - t0; }
  if (Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < passo * 0.5) out.pop();
  return out;
}
function envoltoria(pts) {   // envoltória convexa (cadeia monótona)
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// ---------------- 3. modelo de espessura (calibrado) ----------------
export const CALIBRACAO = {
  tenis: { base_calcanhar: 5.91, base_antepe: 3.54, base_ponta: 2.5, fator_arco: 0.86, copa_calcanhar: 10.87, teto_arco_medial: 25.94, teto_borda_lateral: 5.69, teto_antepe: 2.97 },
  chinelo: { base_calcanhar: 3.23, base_antepe: 2.4, base_ponta: 2.03, fator_arco: 0.75, copa_calcanhar: 7.44, teto_arco_medial: 21.7, teto_borda_lateral: 3.06, teto_antepe: 2.02 },
};
export const ROTULOS_PARAM = { base_calcanhar: 'Base no calcanhar (mm)', base_antepe: 'Base no antepé (mm)', base_ponta: 'Ponta dos dedos (mm)', fator_arco: 'Preenchimento do arco (0–1)',
  copa_calcanhar: 'Copa do calcanhar (mm)', teto_arco_medial: 'Altura máx. do arco medial (mm)', teto_borda_lateral: 'Altura máx. da borda lateral (mm)', teto_antepe: 'Altura máx. no antepé (mm)' };
const RECUO = { tenis: 3, chinelo: 2 };
export const ESPESSURA_MIN = 2.0;

function espessura(p, xf, yrel, H) {
  let base = p.base_calcanhar + (p.base_antepe - p.base_calcanhar) * sig(xf, 0.42, 0.05);
  base += (p.base_ponta - p.base_antepe) * sig(xf, 0.9, 0.025);
  const tmid = p.teto_borda_lateral + (p.teto_arco_medial - p.teto_borda_lateral) * sig(yrel, 8, 4);
  let teto = p.copa_calcanhar + (tmid - p.copa_calcanhar) * sig(xf, 0.28, 0.04);
  teto += (p.teto_antepe - teto) * sig(xf, 0.68, 0.04);
  return { T: base + Math.min(p.fator_arco * H, Math.max(teto - base, 0)), base };
}

// ---------------- ajustes (biblioteca) ----------------
export const AJUSTES = {
  arco_longitudinal: { nome: 'Arco longitudinal', campos: { altura_mm: 2 } },
  calco_infracalcaneo: { nome: 'Calço infracalcâneo', campos: { altura_mm: 4 } },
  antipronador: { nome: 'Antipronador (retropé)', campos: { graus: 4 } },
  antissupinador: { nome: 'Antissupinador (retropé)', campos: { graus: 4 } },
  antipronador_antepe: { nome: 'Antipronador do antepé', campos: { graus: 4 } },
  antissupinador_antepe: { nome: 'Antissupinador do antepé', campos: { graus: 4 } },
  botao_anterior: { nome: 'Botão anterior', campos: { altura_mm: 3 } },
  botao_anterior_gota: { nome: 'Botão anterior em gota', campos: { altura_mm: 3 } },
  barra_retrocapital: { nome: 'Barra retrocapital', campos: { altura_mm: 3, largura_mm: 9 } },
  barra_infracapital: { nome: 'Barra infracapital', campos: { altura_mm: 3, largura_mm: 9 } },
  barra_flexor_curto: { nome: 'Barra do flexor curto', campos: { altura_mm: 2.5, largura_mm: 7 } },
  infracuboide: { nome: 'Infracuboide / infraestiloide / abdutor do 5º', campos: { altura_mm: 2.5 } },
  infraestilocuboideano: { nome: 'Infraestilocuboideano', campos: { altura_mm: 2.5 } },
  elemento_abdutor_halux: { nome: 'Elemento abdutor do hálux', campos: { altura_mm: 2.5 } },
  botao_abdutor_halux: { nome: 'Botão abdutor do hálux', campos: { altura_mm: 2.5 } },
  infra_primeiro_meta: { nome: 'Infra 1º metatarso', campos: { altura_mm: 2 } },
  infra_primeiro_meta_cunha: { nome: 'Infra 1º meta em cunha', campos: { graus: 4 } },
  elemento_invertido: { nome: 'Elemento invertido (descarga)', campos: { profundidade_mm: 2, raio_mm: 12 } },
  zona_macia_calcanhar: { nome: 'Zona macia no calcanhar', campos: { raio_mm: 25 } },
};
const g2 = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2) / 2);

// Posição padrão (centro) de cada ajuste — pode ser arrastado (a.dx, a.dy em mm)
function centroAjuste(t, lm, L) {
  const [m1, m5, cc] = [lm.primeiro_metatarso, lm.quinto_metatarso, lm.calcaneo], yc = lm.eixo_y;
  const mx = (m1[0] + m5[0]) / 2, my = (m1[1] + m5[1]) / 2;
  return ({ arco_longitudinal: [0.42 * L, yc + 22], calco_infracalcaneo: cc, antipronador: cc, antissupinador: cc,
    antipronador_antepe: [mx - 10, my], antissupinador_antepe: [mx - 10, my], botao_anterior: [mx - 16, m1[1] * 0.4 + m5[1] * 0.6],
    botao_anterior_gota: [mx - 16, m1[1] * 0.4 + m5[1] * 0.6], barra_retrocapital: [mx - 14, my], barra_infracapital: [mx, my], barra_flexor_curto: [mx + 22, my],
    infracuboide: [m5[0] - 0.12 * L, m5[1] + 4], infraestilocuboideano: [m5[0] - 0.08 * L, m5[1] + 2], elemento_abdutor_halux: [m1[0] - 0.1 * L, m1[1] + 4],
    botao_abdutor_halux: [m1[0] - 0.05 * L, m1[1] + 3], infra_primeiro_meta: m1, infra_primeiro_meta_cunha: m1, elemento_invertido: m1, zona_macia_calcanhar: cc })[t] || [0.5 * L, yc];
}
function campoAjuste(a, x, y, lm, L) {
  const [c0x, c0y] = centroAjuste(a.tipo, lm, L), cx = c0x + (a.dx || 0), cy = c0y + (a.dy || 0);
  const m1 = lm.primeiro_metatarso, m5 = lm.quinto_metatarso, h = a.altura_mm ?? AJUSTES[a.tipo]?.campos.altura_mm ?? 0;
  const ang = Math.atan2(m1[0] - m5[0], m1[1] - m5[1]);   // inclinação da linha das cabeças
  const linha = (larg) => { const d = x - (cx + (y - cy) * Math.tan(ang)); return Math.exp(-((d / larg) ** 2)) * (y < m1[1] + 4 + (a.dy || 0) && y > m5[1] - 4 + (a.dy || 0) ? 1 : 0); };
  const tg = (gr) => Math.tan((gr * Math.PI) / 180);
  switch (a.tipo) {
    case 'arco_longitudinal': return h * g2(x, y, cx, cy, 0.12 * L, 11);
    case 'calco_infracalcaneo': return h * (1 - sig(x, 0.55 * L + (a.dx || 0), 12));
    case 'antipronador': return Math.max(0, y - cy) * tg(a.graus ?? 4) * (1 - sig(x, 0.36 * L + (a.dx || 0), 6));
    case 'antissupinador': return Math.max(0, cy - y) * tg(a.graus ?? 4) * (1 - sig(x, 0.36 * L + (a.dx || 0), 6));
    case 'antipronador_antepe': return Math.max(0, y - cy) * tg(a.graus ?? 4) * sig(x, cx - 15, 5);
    case 'antissupinador_antepe': return Math.max(0, cy - y) * tg(a.graus ?? 4) * sig(x, cx - 15, 5);
    case 'botao_anterior': return h * g2(x, y, cx, cy, 9, 7);
    case 'botao_anterior_gota': return h * g2(x, y, cx, cy, 11, 7) * (1 - 0.4 * Math.max(-1, Math.min(1, (x - cx) / 10)));
    case 'barra_retrocapital': case 'barra_infracapital': case 'barra_flexor_curto': return h * linha(a.largura_mm ?? 9);
    case 'infracuboide': case 'infraestilocuboideano': return h * g2(x, y, cx, cy, 12, 8);
    case 'elemento_abdutor_halux': return h * g2(x, y, cx, cy, 16, 6);
    case 'botao_abdutor_halux': return h * g2(x, y, cx, cy, 7, 6);
    case 'infra_primeiro_meta': return h * g2(x, y, cx, cy, 9, 8);
    case 'infra_primeiro_meta_cunha': return Math.max(0, y - (cy - 10)) * tg(a.graus ?? 4) * g2(x, y, cx, cy, 14, 40);
    case 'elemento_invertido': { const r = a.raio_mm ?? 12; return -(a.profundidade_mm ?? 2) * g2(x, y, cx, cy, r / 2, r / 2); }
    default: return 0;
  }
}
export function centroDoAjuste(a, lm, L) { const [x, y] = centroAjuste(a.tipo, lm, L); return [x + (a.dx || 0), y + (a.dy || 0)]; }

// ---------------- 4. pontos anatômicos ----------------
export function pontosAnatomicos(e) {
  const { nx, ny, H, mask } = e, L = e.comprimento, dist = distancia(mask, nx, ny);
  let sy = 0, c = 0; for (let i = 0; i < nx; i++) { const x = e.x0 + i; if (x < 0.3 * L || x > 0.65 * L) continue; for (let j = 0; j < ny; j++) if (mask[i * ny + j]) { sy += e.y0 + j; c++; } }
  const yc = sy / c;
  const menor = (f) => { let best = Infinity, bp = null; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const s = i * ny + j, x = e.x0 + i, y = e.y0 + j; if (mask[s] && f(x, y, dist[s]) && H[s] < best) { best = H[s]; bp = [x, y]; } } return bp; };
  const m1 = menor((x, y, d) => x > 0.62 * L && x < 0.8 * L && y - yc > 8 && d > 5) || [0.7 * L, yc + 25];
  const m5 = menor((x, y, d) => x > 0.58 * L && x < 0.74 * L && y - yc < -8 && d > 6 && d < 22) || [0.65 * L, yc - 25];
  let cx = 0, cy = 0, n = 0; for (let i = 0; i < nx; i++) { const x = e.x0 + i; if (x >= 0.25 * L) continue; for (let j = 0; j < ny; j++) if (mask[i * ny + j]) { cx += x; cy += e.y0 + j; n++; } }
  return { primeiro_metatarso: m1, quinto_metatarso: m5, calcaneo: [cx / n, cy / n], eixo_y: yc };
}

// ---------------- 5. contorno posicionado no pé ----------------
function eixoPe(e) {
  const { nx, ny, H, mask } = e, L = e.comprimento;
  const centro = (a, b) => { const xs = [], ys = []; for (let i = 0; i < nx; i++) { const x = e.x0 + i; if (x < a * L || x > b * L) continue; for (let j = 0; j < ny; j++) { const s = i * ny + j; if (mask[s] && H[s] < 25) { xs.push(x); ys.push(e.y0 + j); } } }
    return [xs.reduce((s, v) => s + v, 0) / xs.length, (pct(ys, 2) + pct(ys, 98)) / 2]; };
  return [centro(0.06, 0.14), centro(0.72, 0.78)];
}
export function contorno(e, proj) {
  const nome = proj.molde || (proj.calcado === 'chinelo' ? 'chinelo' : 'tenis'), md = MOLDES[nome];
  const Lc = comprimentoPorNumero(+proj.numero_br) + md.extra;
  let P = molde(nome, Lc, proj.largura || 'normal');
  const a0 = linhaMedia(P, 0.1 * Lc), a1 = linhaMedia(P, 0.75 * Lc), [b0, b1] = eixoPe(e);
  const ang = Math.atan2(b1[1] - b0[1], b1[0] - b0[0]) - Math.atan2(a1[1] - a0[1], a1[0] - a0[0]), c = Math.cos(ang), s = Math.sin(ang);
  const d = [b1[0] - b0[0], b1[1] - b0[1]], dl = Math.hypot(...d), rec = RECUO[md.calcado] ?? 3;
  P = P.map(([x, y]) => { const u = x - a0[0], w = y - a0[1]; return [b0[0] + c * u - s * w - (d[0] / dl) * rec, b0[1] + s * u + c * w - (d[1] / dl) * rec]; });
  return { P: reamostrar(P, 1.0), Lc, nome };
}

// ---------------- 6. gerar palmilha ----------------
// e: escaneamento processado; proj: { calcado, molde, numero_br, largura, parametros{}, ajustes[], borda_arredondada_mm, limite_invasao_mm, tolerancia_contorno_mm }
export function gerarPalmilha(e, proj) {
  const tipo = (MOLDES[proj.molde]?.calcado) || (proj.calcado === 'chinelo' ? 'chinelo' : 'tenis');
  const par = { ...CALIBRACAO[tipo], ...(proj.parametros || {}) };
  const { P, Lc, nome } = contorno(e, proj);
  const lm = { ...pontosAnatomicos(e), ...(proj.pontos_anatomicos || {}) };
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity; for (const [x, y] of P) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const gx0 = Math.floor(xmin) - 6, gy0 = Math.floor(ymin) - 6, nx = Math.ceil(xmax - gx0) + 7, ny = Math.ceil(ymax - gy0) + 7, L = e.comprimento;
  const He = { x0: e.x0, y0: e.y0, nx: e.nx, ny: e.ny, a: e.H }, Me = { x0: e.x0, y0: e.y0, nx: e.nx, ny: e.ny, a: Float32Array.from(e.mask) };
  const T = new Float32Array(nx * ny), B = new Float32Array(nx * ny), Hg = new Float32Array(nx * ny), dentro = new Uint8Array(nx * ny), noPe = new Uint8Array(nx * ny);
  const aj = (proj.ajustes || []).filter((a) => AJUSTES[a.tipo]);
  const zonas = aj.map(() => []);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const s = i * ny + j, x = gx0 + i, y = gy0 + j;
    dentro[s] = dentroPoligono(P, x, y) ? 1 : 0;
    const m = bilinear(Me, x, y) > 0.5; noPe[s] = m ? 1 : 0;
    const h = m ? bilinear(He, x, y) : 0; Hg[s] = h;
    const r = espessura(par, x / L, y - lm.eixo_y, h); let t = r.T; B[s] = r.base;
    aj.forEach((a, k) => { const f = campoAjuste(a, x, y, lm, L); t += f;
      const reg = a.tipo === 'zona_macia_calcanhar' ? Math.hypot(x - lm.calcaneo[0] - (a.dx || 0), y - lm.calcaneo[1] - (a.dy || 0)) < (a.raio_mm ?? 25) : Math.abs(f) > 0.3;
      if (reg && dentro[s] && a.densidade) zonas[k].push([x, y]); });
    T[s] = t;
  }
  let Ts = blur(T, nx, ny, 0.8);
  // suaviza a faixa da borda (ruído das paredes do escaneamento) e arredonda a quina superior
  const db = distancia(dentro, nx, ny), Tb = blur(Ts, nx, ny, 2.5), r = proj.borda_arredondada_mm ?? 1.5;
  for (let s = 0; s < Ts.length; s++) { const w = Math.max(0, 1 - db[s] / 12); Ts[s] = Ts[s] * (1 - w) + Tb[s] * w;
    if (r > 0 && db[s] < r) Ts[s] -= r - Math.sqrt(Math.max(0, r * r - (r - db[s]) ** 2)); }
  // alertas
  const alertas = [], verm = new Uint8Array(nx * ny); let inv = 0, fino = 0, fora = 0; const lim = proj.limite_invasao_mm ?? 4, tol = proj.tolerancia_contorno_mm ?? 6;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const s = i * ny + j;
    if (dentro[s] && noPe[s] && Ts[s] - (B[s] + Hg[s]) > lim) { inv++; verm[s] = 1; }
    if (dentro[s] && Ts[s] < ESPESSURA_MIN) { fino++; verm[s] = 1; }
    if (!dentro[s] && noPe[s] && Hg[s] < 6 && db[s] === 0) { const x = gx0 + i, y = gy0 + j; if (distPoligono(P, x, y) > tol) { fora++; verm[s] = 1; } } }
  if (inv > 15) alertas.push(`Elemento invade a planta do pé em ${inv} mm² (mais de ${lim} mm acima da pele).`);
  if (fino > 15) alertas.push(`Espessura abaixo de ${ESPESSURA_MIN} mm em ${fino} mm² (limite de impressão em TPU, bico 0,6).`);
  if (fora > 250) alertas.push(`Pé ultrapassa o contorno do calçado em ${fora} mm² (considere largura "larga" ou número maior).`);
  for (const a of aj) {
    if (['antipronador', 'antissupinador', 'antipronador_antepe', 'antissupinador_antepe', 'infra_primeiro_meta_cunha'].includes(a.tipo) && (a.graus ?? 4) > 6) alertas.push(`${AJUSTES[a.tipo].nome} de ${a.graus}°: acima de 6° aumenta a carga medial no joelho.`);
    if (a.tipo === 'calco_infracalcaneo' && (a.altura_mm ?? 0) > 10) alertas.push('Calço acima de 10 mm: provavelmente não cabe no calçado (considere elevação externa).');
  }
  for (let s = 0; s < Ts.length; s++) Ts[s] = Math.max(Ts[s], ESPESSURA_MIN);
  const G = { x0: gx0, y0: gy0, nx, ny, a: Ts };
  let hmax = 0; for (let s = 0; s < Ts.length; s++) if (dentro[s]) hmax = Math.max(hmax, Ts[s]);
  const info = { molde: nome, calcado: tipo, numero_br: +proj.numero_br, largura: proj.largura || 'normal', comprimento_palmilha_mm: +Lc.toFixed(1),
    largura_mm: +(ymax - ymin).toFixed(1), altura_max_mm: +hmax.toFixed(1), comprimento_pe_mm: +L.toFixed(1), parametros: par, pontos_anatomicos: lm };
  const zonasOut = aj.map((a, k) => (a.densidade && zonas[k].length > 30 ? { nome: AJUSTES[a.tipo].nome, tipo: a.tipo, densidade: a.densidade, contorno: envoltoria(zonas[k]) } : null)).filter(Boolean);
  return { info, alertas, contorno: P, grade: G, dentro, vermelho: verm, zonas: zonasOut };
}

// ---------------- 7. malha fechada (triangulação restrita com poly2tri) ----------------
export function malhaFechada(res, poly2tri, passoInterno = 1.6) {
  const P = res.contorno, G = res.grade;
  const contorno = P.map(([x, y]) => new poly2tri.Point(x, y));
  const sw = new poly2tri.SweepContext(contorno);
  const steiner = [];
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity; for (const [x, y] of P) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  for (let x = xmin + passoInterno / 2; x < xmax; x += passoInterno) for (let y = ymin + passoInterno / 2; y < ymax; y += passoInterno) {
    const xx = x + (Math.round(y / passoInterno) % 2 ? passoInterno / 2 : 0);   // malha em quincôncio
    if (dentroPoligono(P, xx, y) && distPoligono(P, xx, y) > 1.0) steiner.push(new poly2tri.Point(xx, y));
  }
  sw.addPoints(steiner); sw.triangulate();
  const tris = sw.getTriangles(), idx = new Map(), V = [], F = [];
  const id = (p) => { const k = p.x + ',' + p.y; if (!idx.has(k)) { idx.set(k, V.length / 3); V.push(p.x, p.y, bilinear(G, p.x, p.y)); } return idx.get(k); };
  for (const t of tris) { const [a, b, c] = t.getPoints(); const ia = id(a), ib = id(b), ic = id(c);
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); if (cr > 0) F.push(ia, ib, ic); else F.push(ia, ic, ib); }
  const nTop = V.length / 3;
  for (let k = 0; k < nTop; k++) V.push(V[3 * k], V[3 * k + 1], 0);
  const nf = F.length; for (let k = 0; k < nf; k += 3) F.push(F[k] + nTop, F[k + 2] + nTop, F[k + 1] + nTop);
  // paredes ao longo do contorno (sentido do polígono define a normal para fora)
  let area = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) area += (P[j][0] - P[i][0]) * (P[j][1] + P[i][1]);
  const ccw = area > 0;   // soma (x_ant − x)(y_ant + y) = 2 × área com sinal
  for (let i = 0; i < P.length; i++) { const a = id(contorno[i]), b = id(contorno[(i + 1) % P.length]);
    if (ccw) F.push(a, a + nTop, b, b, a + nTop, b + nTop); else F.push(a, b, a + nTop, b, b + nTop, a + nTop); }
  return { pos: Float32Array.from(V), idx: Uint32Array.from(F) };
}

// Prisma de uma zona (modificador de densidade para o fatiador)
export function malhaZona(contorno, altura, poly2tri) {
  const pts = contorno.map(([x, y]) => new poly2tri.Point(x, y));
  const sw = new poly2tri.SweepContext(pts); sw.triangulate();
  const V = [], F = [], n = contorno.length, map = new Map(); contorno.forEach(([x, y], k) => { map.set(x + ',' + y, k); V.push(x, y, -0.5); });
  contorno.forEach(([x, y]) => V.push(x, y, altura));
  for (const t of sw.getTriangles()) { const [a, b, c] = t.getPoints().map((p) => map.get(p.x + ',' + p.y)); F.push(a, c, b, a + n, b + n, c + n); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; F.push(i, j, j + n, i, j + n, i + n); }
  return { pos: Float32Array.from(V), idx: Uint32Array.from(F) };
}

export function stlBinario(m, nome = 'palmilha') {
  const nt = m.idx.length / 3, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  const cab = new TextEncoder().encode(('Cure OS ' + nome).slice(0, 79)); new Uint8Array(buf, 0, cab.length).set(cab);
  dv.setUint32(80, nt, true);
  for (let t = 0; t < nt; t++) {
    const o = 84 + t * 50, p = [0, 1, 2].map((k) => [m.pos[3 * m.idx[3 * t + k]], m.pos[3 * m.idx[3 * t + k] + 1], m.pos[3 * m.idx[3 * t + k] + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], L = Math.hypot(...n) || 1;
    dv.setFloat32(o, n[0] / L, true); dv.setFloat32(o + 4, n[1] / L, true); dv.setFloat32(o + 8, n[2] / L, true);
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) dv.setFloat32(o + 12 + k * 12 + c * 4, p[k][c], true);
  }
  return buf;
}

// Checagem da malha: arestas usadas exatamente 2 vezes e com orientação oposta (fechada e consistente)
export function checarMalha(m) {
  const cont = new Map();
  for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = m.idx[t + k], b = m.idx[t + ((k + 1) % 3)], key = a < b ? a + '_' + b : b + '_' + a, sgn = a < b ? 1 : -1;
    const c = cont.get(key) || [0, 0]; c[0]++; c[1] += sgn; cont.set(key, c); }
  let abertas = 0, inconsist = 0; for (const [n, s] of cont.values()) { if (n !== 2) abertas++; else if (s !== 0) inconsist++; }
  return { fechada: abertas === 0, bordas_abertas: abertas, arestas_invertidas: inconsist };
}
