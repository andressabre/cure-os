// Leitores puros de extrato bancário (OFX 1.x SGML, OFX 2 XML, CSV) e motor de sugestão da conciliação.
// Sem DOM e sem banco: testável em node (ferramentas/testes-js/extrato-banco.test.mjs).
// Formato devolvido: { banco, conta, moeda, inicio, fim, saldo, saldo_data, movimentos: [{ id_banco, data, valor, descricao, documento, tipo }] }
// valor: positivo = crédito (entrou), negativo = débito (saiu). Datas 'AAAA-MM-DD' (sem conversão de fuso).

// ---------------------------------------------------------------- utilidades
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const desent = (s) => String(s ?? '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#'
  ? String.fromCharCode(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
const limpa = (s) => desent(s).replace(/\s+/g, ' ').trim();
export const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const r2 = (v) => Math.round(v * 100) / 100;

// Hash estável (cyrb53) → texto base36. Mesmo texto = mesmo id em qualquer máquina.
export function hashTexto(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Número brasileiro (1.234,56) ou americano (1,234.56). modo: 'br' | 'us' | undefined (adivinha pelo próprio texto).
export function numero(txt, modo) {
  let s = String(txt ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\s*[Dd]$/.test(s) && !/\d[Dd]\d/.test(s)) { neg = true; s = s.replace(/\s*[Dd]$/, ''); }   // "123,45 D"
  s = s.replace(/\s*[Cc]$/, '').replace(/R\$|\s| /g, '');
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
  if (/^[-+]/.test(s)) { if (s[0] === '-') neg = !neg; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const temP = s.includes('.'), temV = s.includes(',');
  if (!modo) modo = temP && temV ? (s.lastIndexOf(',') > s.lastIndexOf('.') ? 'br' : 'us')
    : temV ? (/,\d{3}$/.test(s) && /^\d{1,3}(,\d{3})+$/.test(s) ? 'us' : 'br')
    : (temP && /^\d{1,3}(\.\d{3})+$/.test(s) && !/\.\d{1,2}$/.test(s) ? 'br' : 'us');
  s = modo === 'br' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const v = Number(s);
  return Number.isFinite(v) ? r2(neg ? -v : v) : null;
}

// Data: dd/mm/aaaa, dd/mm/aa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd, aaaammdd (OFX, com ou sem hora/fuso).
export function dataISO(txt) {
  const s = String(txt ?? '').trim();
  let a, m, d, x;
  if ((x = s.match(/^(\d{4})(\d{2})(\d{2})/)) && !/^\d{4}[-/]/.test(s)) [, a, m, d] = x;
  else if ((x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [, a, m, d] = x;
  else if ((x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s|$|T)/))) { [, d, m, a] = x; if (a.length === 2) a = '20' + a; }
  else return null;
  a = Number(a); m = Number(m); d = Number(d);
  if (a < 1990 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const periodo = (movs) => { const ds = movs.map((m) => m.data).sort(); return { inicio: ds[0] || null, fim: ds[ds.length - 1] || null }; };

// Decodifica o arquivo lido como ArrayBuffer: windows-1252 quando o cabeçalho pede (CHARSET:1252, ISO-8859-1)
// ou quando o UTF-8 tem byte inválido; senão UTF-8.
export function decodificar(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const ini = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const pede1252 = /CHARSET:\s*(1252|8859|ISO-8859-1|WINDOWS-1252)/i.test(ini) || /encoding\s*=\s*["'](windows-1252|iso-8859-1|latin1)["']/i.test(ini);
  if (!pede1252) { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); } catch { /* cai no 1252 */ } }
  return new TextDecoder('windows-1252').decode(bytes);
}

export const pareceOFX = (t) => /OFXHEADER|<OFX>|<\?OFX/i.test(String(t).slice(0, 4000));

// ---------------------------------------------------------------- OFX
// Funciona para SGML (tags sem fechamento) e XML: o valor de uma tag folha é o texto até o próximo "<" ou fim de linha.
const tagVal = (bloco, tag) => { const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')); return m ? limpa(m[1]) : ''; };
const blocos = (txt, tag) => {
  const out = [], re = new RegExp(`<${tag}>`, 'gi'); let m; const pos = [];
  while ((m = re.exec(txt))) pos.push(m.index);
  pos.forEach((p, i) => {
    const fimTag = txt.slice(p).search(new RegExp(`</${tag}>`, 'i'));
    const prox = i + 1 < pos.length ? pos[i + 1] - p : Infinity;
    const fimLista = txt.slice(p).search(/<\/BANKTRANLIST>/i);
    const fim = Math.min(fimTag < 0 ? Infinity : fimTag, prox, fimLista < 0 ? Infinity : fimLista);
    out.push(txt.slice(p, fim === Infinity ? undefined : p + fim));
  });
  return out;
};

export function lerOFX(texto) {
  const t = String(texto ?? '');
  const corpo = t.slice(Math.max(0, t.search(/<OFX>/i)));
  if (!/<OFX>/i.test(t)) return { erro: 'Arquivo não parece OFX (sem <OFX>).' };
  const contaBloco = blocos(corpo, 'BANKACCTFROM')[0] || blocos(corpo, 'CCACCTFROM')[0] || '';
  const lista = blocos(corpo, 'BANKTRANLIST')[0] || corpo;
  const saldoBloco = blocos(corpo, 'LEDGERBAL')[0] || '';
  const vistos = new Map(), iguais = new Map();
  const movimentos = [];
  for (const b of blocos(corpo, 'STMTTRN')) {
    const data = dataISO(tagVal(b, 'DTPOSTED')) || dataISO(tagVal(b, 'DTUSER'));
    const valor = numero(tagVal(b, 'TRNAMT'), /,\d{1,2}$/.test(tagVal(b, 'TRNAMT')) ? 'br' : 'us');
    if (!data || valor == null) continue;
    const nome = tagVal(b, 'NAME'), memo = tagVal(b, 'MEMO');
    const descricao = [nome, memo].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i
      && !(i === 1 && semAcento(a[0]).includes(semAcento(x))) && !(i === 0 && a[1] && semAcento(a[1]).includes(semAcento(x)))).join(' · ') || tagVal(b, 'TRNTYPE');
    let fit = tagVal(b, 'FITID');
    if (!fit) { const k = `${data}|${valor.toFixed(2)}|${semAcento(descricao)}`; const n = (iguais.get(k) || 0) + 1; iguais.set(k, n); fit = 'h:' + hashTexto(`${k}|${n}`); }
    const n = (vistos.get(fit) || 0) + 1; vistos.set(fit, n);
    movimentos.push({ id_banco: n > 1 ? `${fit}#${n}` : fit, data, valor, descricao, documento: tagVal(b, 'CHECKNUM') || tagVal(b, 'REFNUM') || null, tipo: tagVal(b, 'TRNTYPE') || null });
  }
  const p = periodo(movimentos);
  const saldo = saldoBloco ? numero(tagVal(saldoBloco, 'BALAMT'), /,\d{1,2}$/.test(tagVal(saldoBloco, 'BALAMT')) ? 'br' : 'us') : null;
  return {
    banco: tagVal(contaBloco, 'BANKID') || tagVal(corpo, 'ORG') || null,
    conta: tagVal(contaBloco, 'ACCTID') || null,
    moeda: tagVal(corpo, 'CURDEF') || null,
    inicio: dataISO(tagVal(lista, 'DTSTART')) || p.inicio,
    fim: dataISO(tagVal(lista, 'DTEND')) || p.fim,
    saldo, saldo_data: saldo == null ? null : dataISO(tagVal(saldoBloco, 'DTASOF')) || null,
    movimentos,
  };
}

// ---------------------------------------------------------------- CSV
function separador(linhas) {
  const amostra = linhas.filter((l) => l.trim()).slice(0, 30);
  let melhor = null;
  for (const sep of [';', '\t', ',']) {
    const contagens = amostra.map((l) => dividir(l, sep).length).filter((n) => n > 1);
    if (!contagens.length) continue;
    const freq = {}; contagens.forEach((n) => (freq[n] = (freq[n] || 0) + 1));
    const [cols, vezes] = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const nota = vezes * 10 + Number(cols);
    if (!melhor || nota > melhor.nota) melhor = { sep, nota };
  }
  return melhor?.sep || ';';
}
export function dividir(linha, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (q) { if (ch === '"') { if (linha[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const RX = {
  data: /^(data|date|dt)\b|^data[ _]?(lan[cç]|mov|transa|opera)/i,
  credito: /cr[eé]dit|entrada|inflow|^valor ?\(?c\)?$/i,
  debito: /d[eé]bit|sa[ií]da|outflow|^valor ?\(?d\)?$/i,
  valor: /^(valor|amount|quantia|montante)|valor ?\(?r\$\)?|^vlr/i,
  descricao: /hist[oó]rico|descri|lan[cç]amento|memo|detalhe|estabelecimento|t[ií]tulo|title|complemento|favorecido|^nome/i,
  documento: /documento|^doc\b|^n[º°o.]?\s*doc|refer|^n[º°o]\.?$|^id\b|identificador/i,
  natureza: /^(tipo|natureza|d\/c|c\/d|dc|cd|sinal)$/i,
};
const ehSaldo = (s) => /^saldo\b|^s\s*a\s*l\s*d\s*o\b|^total\b/i.test(String(s).trim());

function mapearCabecalho(cab) {
  const mapa = {}, usado = new Set();
  const acha = (chave, filtro = () => true) => { const i = cab.findIndex((c, j) => !usado.has(j) && RX[chave].test(c.trim()) && !/saldo/i.test(c) && filtro(c)); if (i >= 0) { mapa[chave] = i; usado.add(i); } };
  acha('data'); acha('credito'); acha('debito'); acha('valor'); acha('descricao'); acha('documento'); acha('natureza');
  return mapa;
}

function inferirSemCabecalho(linhas) {
  const n = Math.max(...linhas.map((l) => l.length));
  const taxa = (fn) => Array.from({ length: n }, (_, j) => linhas.filter((l) => fn(l[j] ?? '')).length / linhas.length);
  const dt = taxa((v) => !!dataISO(v)), nu = taxa((v) => numero(v) != null && /\d[.,]\d{2}$|^-?\d+$/.test(v.trim()));
  const tx = taxa((v) => /[a-zA-ZÀ-ú]{3}/.test(v));
  const mapa = {};
  const iData = dt.findIndex((x) => x >= 0.8); if (iData < 0) return null; mapa.data = iData;
  const nums = nu.map((x, j) => [x, j]).filter(([x, j]) => x >= 0.8 && j !== iData);
  if (!nums.length) return null; mapa.valor = nums[0][1];
  const textos = tx.map((x, j) => [x, j]).filter(([x, j]) => x >= 0.5 && j !== iData && j !== mapa.valor);
  if (!textos.length) return null;
  mapa.descricao = textos.sort((a, b) => b[0] - a[0])[0][1];
  return mapa;
}

// lerCSV(texto) ou lerCSV(texto, { mapa: { data, descricao, valor | credito+debito, documento? }, linhaCabecalho?: n (-1 = sem cabeçalho), separador? })
export function lerCSV(texto, opcoes = {}) {
  const todas = String(texto ?? '').replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const sep = opcoes.separador || separador(todas);
  const linhas = todas.map((l) => dividir(l, sep));
  const naoVazias = linhas.map((l, i) => [l, i]).filter(([l]) => l.some((c) => c !== ''));
  if (!naoVazias.length) return { erro: 'Arquivo vazio.', cabecalho: [], amostra: [], separador: sep, linhaCabecalho: -1 };

  let hdr = opcoes.linhaCabecalho, mapa = opcoes.mapa ? { ...opcoes.mapa } : null;
  if (hdr == null) {
    hdr = -1;
    for (const [l, i] of naoVazias.slice(0, 25)) {
      const m = mapearCabecalho(l);
      if (m.data != null && (m.valor != null || m.credito != null || m.debito != null) && !l.some((c) => dataISO(c))) { hdr = i; if (!mapa) mapa = m; break; }
    }
    // Cabeçalho com nomes desconhecidos: a linha sem data logo antes da 1ª linha com data (ou a 1ª linha, se for só texto)
    if (hdr < 0) {
      const k = naoVazias.slice(0, 40).findIndex(([l]) => l.some((c) => dataISO(c)));
      const cand = k > 0 ? naoVazias[k - 1] : naoVazias[0];
      if (cand && !cand[0].some((c) => dataISO(c) || numero(c) != null) && cand[0].length > 1) hdr = cand[1];
    }
  }
  const dados = linhas.slice(hdr + 1).filter((l) => l.some((c) => c !== ''));
  const cabecalho = hdr >= 0 ? linhas[hdr] : Array.from({ length: Math.max(...dados.slice(0, 20).map((l) => l.length), 0) }, (_, j) => `Coluna ${j + 1}`);
  if (!mapa) mapa = inferirSemCabecalho(dados.filter((l) => dataISO(l[0]) || l.some((c) => dataISO(c))).slice(0, 50));
  if (mapa && mapa.descricao == null) { const i = cabecalho.findIndex((c, j) => !Object.values(mapa).includes(j) && dados.slice(0, 20).some((l) => /[a-zA-ZÀ-ú]{3}/.test(l[j] || ''))); if (i >= 0) mapa.descricao = i; }
  const falhou = (erro) => ({ erro, cabecalho, amostra: dados.slice(0, 8), separador: sep, linhaCabecalho: hdr });
  if (!mapa || mapa.data == null || (mapa.valor == null && mapa.credito == null && mapa.debito == null))
    return falhou('Não identifiquei as colunas de data e valor. Indique cada coluna.');

  // BR ou US decide-se pela coluna inteira (evita ler "1.234" como 1,234)
  const colsValor = [mapa.valor, mapa.credito, mapa.debito].filter((x) => x != null);
  const amostraV = dados.flatMap((l) => colsValor.map((j) => l[j] || '')).filter(Boolean);
  const br = amostraV.filter((v) => /,\d{1,2}(\s*[CD])?\)?-?$/i.test(v.trim())).length, us = amostraV.filter((v) => /\.\d{1,2}(\s*[CD])?\)?-?$/i.test(v.trim()) && !/,\d{1,2}$/.test(v)).length;
  const modo = br >= us ? 'br' : 'us';

  const iguais = new Map(), movimentos = [];
  let descartadas = 0;
  for (const l of dados) {
    const data = dataISO(l[mapa.data]);
    const descricao = mapa.descricao != null ? limpa(l[mapa.descricao]) : '';
    if (!data || ehSaldo(descricao)) { descartadas++; continue; }
    let valor = null;
    if (mapa.valor != null) {
      valor = numero(l[mapa.valor], modo);
      if (valor != null && mapa.natureza != null) { const nat = semAcento(l[mapa.natureza]); if (/^D|DEBITO|SAIDA|-/.test(nat)) valor = -Math.abs(valor); else if (/^C|CREDITO|ENTRADA|\+/.test(nat)) valor = Math.abs(valor); }
    }
    if (valor == null || valor === 0) {
      const c = mapa.credito != null ? numero(l[mapa.credito], modo) : null, d = mapa.debito != null ? numero(l[mapa.debito], modo) : null;
      if (c || d) valor = r2(Math.abs(c || 0) - Math.abs(d || 0));
    }
    if (valor == null || valor === 0) { descartadas++; continue; }
    const k = `${data}|${valor.toFixed(2)}|${semAcento(descricao)}`; const n = (iguais.get(k) || 0) + 1; iguais.set(k, n);
    movimentos.push({ id_banco: 'csv:' + hashTexto(`${k}|${n}`), data, valor, descricao,
      documento: mapa.documento != null ? limpa(l[mapa.documento]) || null : null, tipo: valor > 0 ? 'CREDIT' : 'DEBIT' });
  }
  if (!movimentos.length) return falhou('Nenhuma linha com data e valor válidos nas colunas escolhidas.');
  const p = periodo(movimentos);
  return { banco: null, conta: null, moeda: 'BRL', ...p, saldo: null, saldo_data: null, movimentos, mapa, separador: sep, linhaCabecalho: hdr, descartadas };
}

export function lerExtrato(texto, opcoes) { return pareceOFX(texto) ? lerOFX(texto) : lerCSV(texto, opcoes); }

// ---------------------------------------------------------------- sugestão de conciliação
export const brlTxt = (v) => 'R$ ' + Math.abs(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const diasEntre = (a, b) => Math.round(Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);
const VAZIAS = new Set(['LTDA', 'EIRELI', 'SERVICOS', 'SERVICO', 'BRASIL', 'PLANO', 'PLANOS', 'SAUDE', 'ASSISTENCIA', 'MEDICA', 'MEDICO',
  'COOPERATIVA', 'TRABALHO', 'CONVENIO', 'CLINICA', 'PAGAMENTO', 'PAGTO', 'TRANSF', 'TRANSFERENCIA', 'REPASSE', 'LOTE', 'PARTICULAR']);

// Nome do pagador/favorecido do lançamento aparece na descrição do banco?
function bonusNome(desc, l) {
  const d = ' ' + semAcento(desc).replace(/[^A-Z0-9]+/g, ' ') + ' ';
  const nomes = [l.fornecedor, l.contratos?.nome].filter(Boolean);
  for (const nome of nomes) {
    const n = semAcento(nome).replace(/[^A-Z0-9]+/g, ' ').trim();
    if (n.length >= 3 && d.includes(' ' + n + ' ')) return { pts: 15, nome };
    const tok = n.split(' ').filter((w) => w.length >= 4 && !VAZIAS.has(w) && !/^\d+$/.test(w));
    if (tok.some((w) => d.includes(' ' + w + ' '))) return { pts: 8, nome };
  }
  return null;
}

// sugerir(movimento, lancamentosAbertos) → candidatos [{ lancamento, lancamento_id, nivel: 'certo'|'provavel', pontos, motivo, diferenca }]
// Crédito × "receber" previsto; débito × "pagar" previsto. diferenca = banco − previsto.
export function sugerir(mov, abertos = []) {
  const tipo = mov.valor > 0 ? 'receber' : 'pagar', v = Math.abs(Number(mov.valor));
  const out = [];
  for (const l of abertos) {
    if (l.status !== 'previsto' || l.tipo !== tipo || !l.vencimento) continue;
    const p = Number(l.valor_previsto), dias = diasEntre(mov.data, l.vencimento);
    const quando = dias === 0 ? 'vencimento no mesmo dia' : `vencimento a ${dias} dia${dias > 1 ? 's' : ''}`;
    let nivel, pontos, motivo;
    if (Math.abs(v - p) <= 0.01) {
      if (dias <= 5) { nivel = 'certo'; pontos = 100 - dias * 2; motivo = `valor igual · ${quando}`; }
      else if (dias <= 45) { nivel = 'provavel'; pontos = 70 - dias * 0.5; motivo = `valor igual · ${quando}`; }
    } else if (tipo === 'receber' && l.lote_id && v < p && v >= p * 0.7 && dias <= 45) {
      nivel = 'provavel'; pontos = 55 - dias * 0.5 - ((p - v) / p) * 20;
      motivo = `provável — valor menor (possível glosa de ${brlTxt(p - v)}) · ${quando}`;
    }
    if (!nivel) continue;
    const b = bonusNome(mov.descricao, l);
    if (b) { pontos += b.pts; motivo += ` · “${b.nome}” na descrição do banco`; }
    out.push({ lancamento: l, lancamento_id: l.id, nivel, pontos: r2(pontos), motivo, diferenca: r2(v - p) });
  }
  return out.sort((a, b) => b.pontos - a.pontos || String(a.lancamento.vencimento).localeCompare(b.lancamento.vencimento));
}

// Sugestão para vários movimentos: um lançamento só fica "certo" para UM movimento (o de maior pontuação);
// empate entre movimentos, ou dois "certos" iguais para o mesmo movimento → "escolher".
// → Map(mov.id → { situacao: 'certo'|'provavel'|'escolher'|'nenhum', melhor, candidatos })
export function distribuir(movimentos, abertos) {
  const res = new Map(), donos = new Map();
  for (const m of movimentos) {
    const cands = sugerir(m, abertos);
    res.set(m.id, { situacao: cands.length ? cands[0].nivel : 'nenhum', melhor: cands[0] || null, candidatos: cands });
    const c0 = cands[0];
    if (c0?.nivel === 'certo') {
      if (cands[1]?.nivel === 'certo' && cands[1].pontos === c0.pontos) res.get(m.id).situacao = 'escolher';
      else (donos.get(c0.lancamento_id) || donos.set(c0.lancamento_id, []).get(c0.lancamento_id)).push([m.id, c0.pontos]);
    }
  }
  for (const lista of donos.values()) {
    if (lista.length < 2) continue;
    const max = Math.max(...lista.map(([, p]) => p)), topo = lista.filter(([, p]) => p === max);
    for (const [id, p] of lista) {
      const r = res.get(id);
      if (topo.length > 1 || p < max) r.situacao = topo.length > 1 && p === max ? 'escolher' : 'provavel';
    }
  }
  return res;
}

// Forma de pagamento pela descrição do banco (só usada se o lançamento não tiver forma)
export function formaPelaDescricao(desc) {
  const d = semAcento(desc);
  return /\bPIX\b/.test(d) ? 'pix' : /\b(TED|DOC|TRANSF)/.test(d) ? 'ted' : /BOLETO|COBRANCA|TITULO/.test(d) ? 'boleto'
    : /DEB(ITO)? AUT/.test(d) ? 'debito_automatico' : null;
}
