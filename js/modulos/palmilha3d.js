// Projeto de palmilha 3D (modelo "fisio_palmilha3d", aba Avaliações, db/055, 15/11/2026).
// Escaneamento .obj do Sense → palmilha moldada, contorno pelo número do calçado, ajustes arrastáveis, alertas em vermelho e STL para fatiar.
// O processamento roda no navegador (palmilha3d-motor.js). O escaneamento fica compactado (.obj.gz) no bucket "prontuario" (pasta do autor);
// no registro ficam só o caminho e os parâmetros: reabrir o projeto gera a mesma palmilha.
import { sb, estado, $, $$, esc, toast, falha } from '../core.js';
import { lerObj, processarEscaneamento, gerarPalmilha, malhaFechada, malhaZona, stlBinario, checarMalha, centroDoAjuste,
  MOLDES, LARGURAS, AJUSTES, CALIBRACAO, ROTULOS_PARAM, comprimentoPorNumero } from './palmilha3d-motor.js';

const POLY2TRI = 'https://cdn.jsdelivr.net/npm/poly2tri@1.5.0/+esm';
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
const LADOS = { dir: 'Pé direito', esq: 'Pé esquerdo' };
const f1 = (n, d = 1) => Number(n).toFixed(d).replace('.', ',');

// Protocolos de partida (OpenEvidence/literatura; a validar pelo fisioterapeuta). Os da clínica ficam em clinicas.config.palmilha_protocolos.
export const PROTOCOLOS = {
  pe_pronado: { nome: 'Pé pronado (pronação excessiva)', ajustes: [{ tipo: 'arco_longitudinal', altura_mm: 2 }, { tipo: 'antipronador', graus: 4 }],
    avisos: ['Cunha medial acima de 6° aumenta o momento de adução do joelho (dose-resposta): mais correção não é necessariamente melhor.'], ref: 'Costa et al., Gait Posture 2021; Thong-On & Harutaichun, Sci Rep 2023' },
  pe_cavo: { nome: 'Pé cavo / supinado', parametros: { fator_arco: 0.6 }, ajustes: [{ tipo: 'calco_infracalcaneo', altura_mm: 5 },
    { tipo: 'elemento_invertido', profundidade_mm: 2, raio_mm: 12 }, { tipo: 'antissupinador_antepe', graus: 4 }],
    avisos: ['Evitar arco alto e rígido: reduz a absorção de impacto e pode bloquear a eversão compensatória do retropé.'], ref: 'Manoli & Graham, Foot Ankle Int 2005' },
  fascite_plantar: { nome: 'Fascite plantar', ajustes: [{ tipo: 'arco_longitudinal', altura_mm: 2 }, { tipo: 'zona_macia_calcanhar', raio_mm: 25, densidade: 12 }],
    avisos: ['Calcanheira isolada aumenta a pressão no retropé: combinar suporte do arco com amortecimento do calcanhar.'], ref: 'Cooper, JAMA 2023; Martin et al., JOSPT 2014' },
  discrepancia: { nome: 'Discrepância de comprimento dos membros', ajustes: [{ tipo: 'calco_infracalcaneo', altura_mm: 6 }],
    avisos: ['Escolha o lado do calço (só D ou só E) = lado mais curto. Elevação interna acima de 10 mm geralmente não cabe no calçado: considerar elevação externa.'], ref: 'Campbell et al., Cochrane 2021' },
  pe_diabetico: { nome: 'Pé diabético (prevenção de úlcera)', parametros: { fator_arco: 1.0 }, ajustes: [{ tipo: 'elemento_invertido', profundidade_mm: 1.5, raio_mm: 10, densidade: 12 }],
    avisos: ['ALTO RISCO: contato total e material macio; validar com baropodometria (meta < 200 kPa ou redução ≥ 30%).', 'Ferida ativa não é indicação de palmilha: encaminhar.'],
    ref: 'Giurato et al., Acta Diabetol 2026; IWGDF' },
};

let _p2t = null, _three = null;
const poly2tri = async () => (_p2t ||= (await import(POLY2TRI)).default || (await import(POLY2TRI)));
const three = async () => (_three ||= await import(THREE_URL));
const CACHE = new Map();   // caminho → escaneamento processado (sessão)

async function gz(texto) { const s = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip')); return await new Response(s).blob(); }
async function gunzip(blob) { const s = blob.stream().pipeThrough(new DecompressionStream('gzip')); return await new Response(s).text(); }

async function enviarEscaneamento(arquivo, pacienteId) {
  if (!/\.obj$/i.test(arquivo.name)) throw new Error('Envie o escaneamento em .obj (exportado do Sense).');
  const texto = await arquivo.text();
  const proc = processarEscaneamento(lerObj(texto));   // valida antes de enviar
  const caminho = `${estado.clinica.id}/${estado.profissionalId}/${pacienteId}/palmilha-${crypto.randomUUID()}.obj.gz`;
  const { error } = await sb.storage.from('prontuario').upload(caminho, await gz(texto), { contentType: 'application/gzip' });
  if (error) throw error;
  CACHE.set(caminho, proc);
  return { arquivo: caminho, nome: arquivo.name, comprimento: Math.round(proc.comprimento), largura: Math.round(proc.largura) };
}
async function escaneamento(caminho) {
  if (CACHE.has(caminho)) return CACHE.get(caminho);
  const { data, error } = await sb.storage.from('prontuario').download(caminho);
  if (error) throw error;
  const proc = processarEscaneamento(lerObj(await gunzip(data)));
  CACHE.set(caminho, proc); return proc;
}
const escolherObj = () => new Promise((res) => { const i = Object.assign(document.createElement('input'), { type: 'file', accept: '.obj' }); i.onchange = () => res(i.files[0] || null); i.click(); });
const baixar = (buf, nome) => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([buf], { type: 'model/stl' })), download: nome }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

// ---------------- painel ----------------
export function montarPalmilha(alvo, form, st, ctx = {}) {
  const p = ctx.paciente || {};
  st.pes ||= {}; st._g ||= {};
  st.proj ||= { molde: String(p.sexo || '').toUpperCase().startsWith('M') ? 'masculino' : 'tenis', numero_br: '', largura: 'normal', ajustes: [], parametros: {}, borda_arredondada_mm: 1.5 };
  const pr = st.proj; pr.ajustes ||= []; pr.parametros ||= {};
  let protClinica = estado.clinica?.config?.palmilha_protocolos || {}, vis = 'dir', res = {}, malhas = {}, gerando = false, avisosProt = [];
  const tipoCalc = () => MOLDES[pr.molde]?.calcado || 'tenis';
  const todosProt = () => ({ ...PROTOCOLOS, ...Object.fromEntries(Object.entries(protClinica).map(([k, v]) => ['c_' + k, { ...v, clinica: true }])) });

  const escreverTexto = () => {
    const linhas = [`Molde ${MOLDES[pr.molde]?.nome || pr.molde}, nº ${pr.numero_br} (palmilha ${f1(comprimentoPorNumero(+pr.numero_br) + (MOLDES[pr.molde]?.extra || 0), 0)} mm), largura ${pr.largura}.`];
    for (const l of ['dir', 'esq']) { const r = res[l]; if (!r) continue;
      linhas.push(`${LADOS[l]}: ${f1(r.info.comprimento_palmilha_mm, 0)} × ${f1(r.info.largura_mm, 0)} mm; altura máxima ${f1(r.info.altura_max_mm)} mm (pé escaneado ${f1(r.info.comprimento_pe_mm, 0)} mm).`); }
    if (pr.ajustes.length) linhas.push('Ajustes: ' + pr.ajustes.map((a) => { const c = AJUSTES[a.tipo]; const v = [a.altura_mm != null && `${f1(a.altura_mm)} mm`, a.graus != null && `${f1(a.graus)}°`,
      a.profundidade_mm != null && `rebaixo ${f1(a.profundidade_mm)} mm`, a.densidade && `preenchimento ${a.densidade}%`, a.lado && a.lado !== 'ambos' && (a.lado === 'dir' ? 'só D' : 'só E')].filter(Boolean).join(', ');
      return `${c?.nome || a.tipo}${v ? ` (${v})` : ''}`; }).join('; ') + '.');
    const al = [...new Set(Object.entries(res).flatMap(([l, r]) => r.alertas.map((t) => `${LADOS[l]}: ${t}`)))];
    if (al.length) linhas.push('Alertas: ' + al.join(' '));
    const el = form.elements.c_prescricao; if (!el) return;
    const novo = linhas.join('\n'), prev = st._g.prescricao || '', cur = el.value;
    if (!cur.trim() || cur === prev) el.value = novo; else if (prev && cur.includes(prev)) el.value = cur.replace(prev, novo); else el.value = cur.replace(/\s*$/, '') + '\n' + novo;
    st._g.prescricao = novo;
  };

  const linhaAjuste = (a, k) => {
    const c = AJUSTES[a.tipo]?.campos || {};
    return `<div class="p3-aj" data-k="${k}"><select data-f="tipo">${Object.entries(AJUSTES).map(([t, d]) => `<option value="${t}" ${t === a.tipo ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}</select>
      ${Object.keys(c).map((f) => `<label>${{ altura_mm: 'altura mm', graus: 'graus', largura_mm: 'largura mm', profundidade_mm: 'rebaixo mm', raio_mm: 'raio mm' }[f]}<input type="number" step="0.5" data-f="${f}" value="${esc(a[f] ?? c[f])}"></label>`).join('')}
      <label>preench. %<input type="number" step="5" min="5" max="100" data-f="densidade" value="${esc(a.densidade ?? '')}" placeholder="—" title="Densidade do preenchimento nesta zona (vira um modificador no fatiador)"></label>
      <label>lado<select data-f="lado">${[['ambos', 'D e E'], ['dir', 'só D'], ['esq', 'só E']].map(([v, t]) => `<option value="${v}" ${(a.lado || 'ambos') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${a.dx || a.dy ? `<button class="btn pequeno" data-centro title="Voltar à posição automática">⟲ posição</button>` : ''}
      <button class="btn pequeno" data-tirar title="Remover">✕</button></div>`;
  };

  const tela = () => {
    const P = todosProt(), cal = { ...CALIBRACAO[tipoCalc()] };
    alvo.innerHTML = `<div class="p3">
      <div class="p3-pes">${['dir', 'esq'].map((l) => { const e = st.pes[l]; return `<div class="p3-pe"><b>${LADOS[l]}</b>
        ${e ? `<span class="muted">${esc(e.nome)} · pé ${e.comprimento} × ${e.largura} mm</span> <button class="btn pequeno" data-env="${l}">Trocar</button> <button class="btn pequeno" data-sem="${l}">Tirar</button>`
          : `<button class="btn pequeno primario" data-env="${l}">Enviar escaneamento (.obj)</button>`}</div>`; }).join('')}</div>
      <div class="grade-form">
        <label>Molde<select id="p3-molde">${Object.entries(MOLDES).map(([k, m]) => `<option value="${k}" ${k === pr.molde ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>
        <label>Nº do calçado (BR)<input id="p3-num" type="number" min="18" max="48" step="1" value="${esc(pr.numero_br)}" placeholder="ex.: 37"></label>
        <label>Largura<select id="p3-larg">${Object.keys(LARGURAS).map((k) => `<option ${k === pr.largura ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label>Protocolo<select id="p3-prot"><option value="">— aplicar protocolo —</option>${Object.entries(P).map(([k, v]) => `<option value="${k}">${v.clinica ? '★ ' : ''}${esc(v.nome)}</option>`).join('')}</select></label>
      </div>
      ${avisosProt.length ? `<div class="dica">⚠️ ${avisosProt.map(esc).join('<br>')}</div>` : ''}
      <div class="p3-cab"><b>Ajustes</b> <span class="muted">— posição automática pelos pontos anatômicos; arraste os números no mapa para mover</span></div>
      <div id="p3-ajs">${pr.ajustes.map(linhaAjuste).join('') || '<p class="muted">Nenhum ajuste.</p>'}</div>
      <button class="btn pequeno" id="p3-add">+ Ajuste</button>
      <details class="p3-det"><summary>Parâmetros da palmilha <span class="muted">(padrão calibrado nos casos da Cure — ${tipoCalc()})</span></summary>
        <div class="grade-form">${Object.entries(ROTULOS_PARAM).map(([k, r]) => `<label>${esc(r)}<input type="number" step="${k === 'fator_arco' ? 0.05 : 0.5}" data-par="${k}" value="${esc(pr.parametros[k] ?? cal[k])}"></label>`).join('')}
          <label>Arredondar borda superior (mm)<input type="number" step="0.5" min="0" max="3" id="p3-borda" value="${esc(pr.borda_arredondada_mm ?? 1.5)}"></label></div>
        <button class="btn pequeno" id="p3-padrao">Restaurar padrão</button></details>
      <details class="p3-det"><summary>Protocolos da clínica</summary>
        <div class="linha-acoes" style="justify-content:flex-start"><input id="p3-pnome" placeholder="Nome do protocolo (ex.: Corredor pé plano)" style="min-width:260px">
          <button class="btn pequeno" id="p3-psalvar">Salvar ajustes atuais como protocolo</button></div>
        ${Object.keys(protClinica).length ? `<p class="muted">${Object.entries(protClinica).map(([k, v]) => `★ ${esc(v.nome)} <a href="#" data-pdel="${esc(k)}">excluir</a>`).join(' · ')}</p>` : ''}</details>
      <div class="linha-acoes" style="justify-content:flex-start"><button class="btn primario" id="p3-gerar">${Object.keys(res).length ? '↻ Atualizar palmilha' : '▶ Gerar palmilha'}</button>
        <span class="muted" id="p3-st"></span></div>
      <div id="p3-vis"></div></div>`;
    ligar();
    if (Object.keys(res).length) visual();
  };

  const ler = () => {
    pr.molde = $('#p3-molde', alvo).value; pr.numero_br = $('#p3-num', alvo).value; pr.largura = $('#p3-larg', alvo).value;
    pr.borda_arredondada_mm = +$('#p3-borda', alvo).value;
    const cal = CALIBRACAO[tipoCalc()]; pr.parametros = {};
    $$('[data-par]', alvo).forEach((i) => { const v = +i.value; if (i.value !== '' && Math.abs(v - cal[i.dataset.par]) > 1e-6) pr.parametros[i.dataset.par] = v; });
    $$('.p3-aj', alvo).forEach((d) => { const a = pr.ajustes[+d.dataset.k]; $$('[data-f]', d).forEach((i) => {
      const f = i.dataset.f; if (f === 'tipo' || f === 'lado') a[f] = i.value; else if (i.value === '') delete a[f]; else a[f] = +i.value; }); });
  };

  const ligar = () => {
    $$('[data-env]', alvo).forEach((b) => (b.onclick = async () => {
      const arq = await escolherObj(); if (!arq) return;
      b.disabled = true; b.textContent = 'Processando…';
      try { st.pes[b.dataset.env] = await enviarEscaneamento(arq, p.id); delete res[b.dataset.env]; toast('Escaneamento enviado.'); }
      catch (e) { falha(e, 'Escaneamento'); }
      ler(); tela();
    }));
    $$('[data-sem]', alvo).forEach((b) => (b.onclick = () => { ler(); delete st.pes[b.dataset.sem]; delete res[b.dataset.sem]; tela(); }));
    $('#p3-molde', alvo).onchange = () => { ler(); tela(); };
    $('#p3-prot', alvo).onchange = (ev) => { const k = ev.target.value; if (!k) return; ler(); const pt = todosProt()[k];
      pr.ajustes = structuredClone(pt.ajustes || []); pr.parametros = { ...(pt.parametros || {}) }; avisosProt = [...(pt.avisos || []), ...(pt.ref ? ['Referência: ' + pt.ref] : [])];
      pr.protocolo = pt.nome; tela(); };
    $('#p3-add', alvo).onclick = () => { ler(); pr.ajustes.push({ tipo: 'arco_longitudinal' }); tela(); };
    $$('[data-tirar]', alvo).forEach((b) => (b.onclick = () => { ler(); pr.ajustes.splice(+b.closest('.p3-aj').dataset.k, 1); tela(); }));
    $$('[data-centro]', alvo).forEach((b) => (b.onclick = () => { ler(); const a = pr.ajustes[+b.closest('.p3-aj').dataset.k]; delete a.dx; delete a.dy; tela(); }));
    $$('.p3-aj [data-f="tipo"]', alvo).forEach((s) => (s.onchange = () => { ler(); const a = pr.ajustes[+s.closest('.p3-aj').dataset.k];
      for (const f of ['altura_mm', 'graus', 'largura_mm', 'profundidade_mm', 'raio_mm']) delete a[f]; tela(); }));
    $('#p3-padrao', alvo).onclick = () => { ler(); pr.parametros = {}; pr.borda_arredondada_mm = 1.5; tela(); };
    $('#p3-psalvar', alvo).onclick = salvarProtocolo;
    $$('[data-pdel]', alvo).forEach((a) => (a.onclick = async (ev) => { ev.preventDefault(); const nv = { ...protClinica }; delete nv[a.dataset.pdel]; await gravarProtocolos(nv); }));
    $('#p3-gerar', alvo).onclick = () => { ler(); gerar(); };
  };

  async function gravarProtocolos(nv) {
    const { data: cl, error: e1 } = await sb.from('clinicas').select('config').eq('id', estado.clinica.id).single();
    if (e1) return falha(e1, 'Protocolos');
    const config = { ...(cl?.config || {}), palmilha_protocolos: nv };
    const { error } = await sb.from('clinicas').update({ config }).eq('id', estado.clinica.id);
    if (error) return falha(error, 'Salvar protocolo (só a gestão altera a configuração da clínica)');
    protClinica = nv; if (estado.clinica.config) estado.clinica.config.palmilha_protocolos = nv; toast('Protocolos atualizados.'); ler(); tela();
  }
  async function salvarProtocolo() {
    ler(); const nome = $('#p3-pnome', alvo).value.trim();
    if (!nome) return toast('Dê um nome ao protocolo.', true);
    if (!pr.ajustes.length && !Object.keys(pr.parametros).length) return toast('Não há ajustes nem parâmetros para salvar.', true);
    const chave = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    const aj = structuredClone(pr.ajustes).map((a) => { delete a.dx; delete a.dy; return a; });
    await gravarProtocolos({ ...protClinica, [chave]: { nome, ajustes: aj, parametros: { ...pr.parametros }, molde: pr.molde } });
  }

  async function gerar() {
    if (gerando) return;
    if (!(+pr.numero_br >= 18)) return toast('Informe o número do calçado (BR).', true);
    const lados = ['dir', 'esq'].filter((l) => st.pes[l]);
    if (!lados.length) return toast('Envie pelo menos um escaneamento.', true);
    gerando = true; const stt = $('#p3-st', alvo); stt.textContent = 'Gerando…';
    try {
      const P2T = await poly2tri();
      for (const l of lados) {
        stt.textContent = `Gerando ${LADOS[l].toLowerCase()}…`; await new Promise((r) => setTimeout(r, 20));
        const e = await escaneamento(st.pes[l].arquivo);
        const proj = { ...pr, ajustes: pr.ajustes.filter((a) => !a.lado || a.lado === 'ambos' || a.lado === l) };
        const r = gerarPalmilha(e, proj), m = malhaFechada(r, P2T), ck = checarMalha(m);
        if (!ck.fechada || ck.arestas_invertidas) r.alertas.push('Malha com problema de fechamento: revise antes de imprimir.');
        res[l] = r; malhas[l] = m;
      }
      st.resultado = Object.fromEntries(Object.entries(res).map(([l, r]) => [l, { ...r.info, parametros: undefined, alertas: r.alertas }]));
      if (!res[vis]) vis = lados[0];
      escreverTexto(); tela();
    } catch (e) { falha(e, 'Gerar palmilha'); stt.textContent = ''; }
    gerando = false;
  }

  // ---------------- visualização: mapa 2D (arrastar) + 3D ----------------
  function visual() {
    const box = $('#p3-vis', alvo), r = res[vis];
    const al = Object.entries(res).flatMap(([l, x]) => x.alertas.map((t) => `<li><b>${LADOS[l]}:</b> ${esc(t)}</li>`));
    box.innerHTML = `<div class="p3-abas">${Object.keys(res).map((l) => `<button class="btn pequeno ${l === vis ? 'primario' : ''}" data-vis="${l}">${LADOS[l]}</button>`).join('')}
        <span class="muted">${f1(r.info.comprimento_palmilha_mm, 0)} × ${f1(r.info.largura_mm, 0)} mm · altura máx. ${f1(r.info.altura_max_mm)} mm</span></div>
      ${al.length ? `<ul class="p3-alertas">${al.join('')}</ul>` : '<p class="p3-ok">✓ Sem alertas.</p>'}
      <div class="p3-telas"><div><canvas id="p3-mapa"></canvas><div class="muted p3-leg">Vista de cima · cor = espessura · <span style="color:#c62828">vermelho = alerta</span> · arraste os números</div></div>
        <div><div id="p3-3d"></div><div class="muted p3-leg">Arraste para girar · roda do mouse para aproximar</div></div></div>
      <div class="linha-acoes" style="justify-content:flex-start">${Object.keys(res).map((l) => `<button class="btn" data-stl="${l}">⬇ STL ${LADOS[l].toLowerCase()}</button>`).join('')}
        ${Object.values(res).some((x) => x.zonas.length) ? '<button class="btn" id="p3-zonas">⬇ Zonas de preenchimento (modificadores)</button>' : ''}</div>`;
    $$('[data-vis]', box).forEach((b) => (b.onclick = () => { vis = b.dataset.vis; visual(); }));
    $$('[data-stl]', box).forEach((b) => (b.onclick = () => baixar(stlBinario(malhas[b.dataset.stl], 'palmilha'), nomeArq(b.dataset.stl) + '.stl')));
    const bz = $('#p3-zonas', box); if (bz) bz.onclick = async () => { const P2T = await poly2tri();
      for (const [l, x] of Object.entries(res)) for (const z of x.zonas) baixar(stlBinario(malhaZona(z.contorno, x.info.altura_max_mm + 3, P2T), 'zona'), `${nomeArq(l)}_zona_${z.tipo}_${z.densidade}pct.stl`);
      toast('No fatiador: importe a palmilha e adicione cada zona como "modificador" com a densidade do nome do arquivo.'); };
    mapa($('#p3-mapa', box), r);
    vista3d($('#p3-3d', box), malhas[vis], r).catch(() => { $('#p3-3d', box).innerHTML = '<p class="muted">Visualização 3D indisponível neste navegador.</p>'; });
  }
  const nomeArq = (l) => `palmilha_${(p.nome || 'paciente').split(/\s+/).map((s) => s[0]).join('').toUpperCase()}_${l === 'dir' ? 'D' : 'E'}_n${pr.numero_br}_${pr.molde}`;

  function cor(t, tmax) { const u = Math.min(1, Math.max(0, (t - 2) / Math.max(4, tmax - 2))); return [Math.round(220 - 170 * u), Math.round(235 - 140 * u), Math.round(250 - 60 * u)]; }

  function mapa(cv, r) {
    const G = r.grade, k = 2.2, W = G.ny * k, H = G.nx * k, espelho = vis === 'esq' ? 1 : -1;   // D: medial à esquerda da tela (vista de cima)
    cv.width = W; cv.height = H; const ctx = cv.getContext('2d'), img = ctx.createImageData(G.ny, G.nx);
    const tmax = r.info.altura_max_mm;
    for (let i = 0; i < G.nx; i++) for (let j = 0; j < G.ny; j++) { const s = i * G.ny + j, px = (G.nx - 1 - i) * G.ny + (espelho < 0 ? G.ny - 1 - j : j), o = px * 4;
      if (!r.dentro[s]) { img.data[o + 3] = 0; continue; }
      const c = r.vermelho[s] ? [198, 40, 40] : cor(G.a[s], tmax); img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }
    const tmp = Object.assign(document.createElement('canvas'), { width: G.ny, height: G.nx }); tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, W, H);
    const tela = (x, y) => [(espelho < 0 ? G.ny - 1 - (y - G.y0) : y - G.y0) * k, (G.nx - 1 - (x - G.x0)) * k];
    const mundo = (sx, sy) => { const x = G.x0 + G.nx - 1 - sy / k, jj = sx / k; return [x, espelho < 0 ? G.y0 + G.ny - 1 - jj : G.y0 + jj]; };
    ctx.strokeStyle = '#37474F'; ctx.lineWidth = 1.2; ctx.beginPath(); r.contorno.forEach(([x, y], n) => { const [a, b] = tela(x, y); n ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); ctx.stroke();
    const lm = r.info.pontos_anatomicos, L = r.info.comprimento_pe_mm;
    for (const [nm, pt] of [['1º', lm.primeiro_metatarso], ['5º', lm.quinto_metatarso], ['C', lm.calcaneo]]) { const [a, b] = tela(...pt); ctx.fillStyle = '#455A64'; ctx.beginPath(); ctx.arc(a, b, 3, 0, 7); ctx.fill(); ctx.font = '10px sans-serif'; ctx.fillText(nm, a + 5, b + 3); }
    const ajs = pr.ajustes.map((a, n) => ({ a, n, c: tela(...centroDoAjuste(a, lm, L)) })).filter(({ a }) => !a.lado || a.lado === 'ambos' || a.lado === vis);
    for (const { n, c } of ajs) { ctx.fillStyle = '#E65100'; ctx.beginPath(); ctx.arc(c[0], c[1], 10, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(n + 1), c[0], c[1] + 4); ctx.textAlign = 'left'; }
    let drag = null;
    const pos = (ev) => { const b = cv.getBoundingClientRect(); return [((ev.clientX - b.left) * cv.width) / b.width, ((ev.clientY - b.top) * cv.height) / b.height]; };
    cv.onpointerdown = (ev) => { const [sx, sy] = pos(ev); const alvoAj = ajs.find(({ c }) => Math.hypot(c[0] - sx, c[1] - sy) < 14); if (!alvoAj) return;
      drag = { ...alvoAj, ini: mundo(sx, sy), dx0: alvoAj.a.dx || 0, dy0: alvoAj.a.dy || 0 }; cv.setPointerCapture(ev.pointerId); };
    cv.onpointermove = (ev) => { if (!drag) return; const [x, y] = mundo(...pos(ev)); drag.a.dx = Math.round(drag.dx0 + x - drag.ini[0]); drag.a.dy = Math.round(drag.dy0 + y - drag.ini[1]);
      mapa(cv, r); };
    cv.onpointerup = () => { if (!drag) return; drag = null; gerar(); };
  }

  async function vista3d(el, m, r) {
    const T = await three(); el.innerHTML = '';
    const W = Math.min(520, el.clientWidth || 520), H = 380;
    const ren = new T.WebGLRenderer({ antialias: true }); ren.setSize(W, H); ren.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); ren.setClearColor(0xf4f6f8); el.appendChild(ren.domElement);
    const cena = new T.Scene(), cam = new T.PerspectiveCamera(35, W / H, 1, 3000);
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(m.pos, 3)); geo.setIndex(new T.BufferAttribute(m.idx, 1));
    const G = r.grade, cores = new Float32Array(m.pos.length), tmax = r.info.altura_max_mm;
    for (let v = 0; v < m.pos.length / 3; v++) { const x = m.pos[3 * v], y = m.pos[3 * v + 1], i = Math.round(x - G.x0), j = Math.round(y - G.y0), s = i * G.ny + j;
      const c = s >= 0 && s < r.vermelho.length && r.vermelho[s] && m.pos[3 * v + 2] > 0.01 ? [198, 40, 40] : cor(m.pos[3 * v + 2], tmax); cores.set(c.map((q) => q / 255), 3 * v); }
    geo.setAttribute('color', new T.BufferAttribute(cores, 3)); geo.computeVertexNormals(); geo.computeBoundingBox();
    const c0 = new T.Vector3(); geo.boundingBox.getCenter(c0); geo.translate(-c0.x, -c0.y, 0);
    if (vis === 'esq') geo.scale(1, -1, 1), geo.computeVertexNormals();   // pé esquerdo visto como esquerdo
    const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: T.DoubleSide }));
    cena.add(mesh, new T.AmbientLight(0xffffff, 0.55)); const luz = new T.DirectionalLight(0xffffff, 0.9); luz.position.set(-120, -160, 260); cena.add(luz);
    let az = -0.9, el2 = 0.75, dist = 420;
    const desenhar = () => { cam.position.set(dist * Math.cos(el2) * Math.cos(az), dist * Math.cos(el2) * Math.sin(az), dist * Math.sin(el2)); cam.up.set(0, 0, 1); cam.lookAt(0, 0, 4); ren.render(cena, cam); };
    let arr = null; const cv = ren.domElement;
    cv.onpointerdown = (ev) => { arr = [ev.clientX, ev.clientY, az, el2]; cv.setPointerCapture(ev.pointerId); };
    cv.onpointermove = (ev) => { if (!arr) return; az = arr[2] - (ev.clientX - arr[0]) * 0.01; el2 = Math.max(-1.4, Math.min(1.5, arr[3] + (ev.clientY - arr[1]) * 0.01)); desenhar(); };
    cv.onpointerup = () => (arr = null);
    cv.onwheel = (ev) => { ev.preventDefault(); dist = Math.max(150, Math.min(900, dist * (ev.deltaY > 0 ? 1.1 : 0.9))); desenhar(); };
    desenhar();
  }

  tela();
  if (Object.keys(st.pes).length && +pr.numero_br) setTimeout(() => gerar(), 50);   // reabrir projeto = gerar de novo com os mesmos parâmetros
  return { estado: () => { if ($('#p3-molde', alvo)) ler(); const { _g, ...resto } = st; return Object.keys(st.pes).length || pr.ajustes.length ? { ...resto, _g } : null; } };
}
