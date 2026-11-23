// Conferência de pagamento: relatório do profissional × Demonstrativo de Pagamento da operadora (Amil), cruzados pela SENHA.
// Funções puras (sem core.js, testam em node). Nada daqui grava no banco: a gestora confere na tela e baixa o CSV.
// Entrada = linhas de texto (PDF reconstruído por posição, ou planilha com as células unidas por espaço).

const num = (s) => { s = String(s).trim(); return s === '-' || s === '' ? 0 : Number(s.replace(/\./g, '').replace(',', '.')); };
const cents = (v) => Math.round(Number(v) * 100);
const dataIso = (d) => { const m = String(d).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null; const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };

// Demonstrativo de Pagamento: uma linha por guia (nº guia prestador, nº guia operadora, senha, tipo, processado, liberado, glosa) e uma por lote (protocolo).
export function lerDemonstrativoAmil(linhas) {
  const guias = [], lotes = []; let pagamento = null;
  linhas.forEach((l, i) => {
    if (l.includes('9. Data de Pagamento')) { const m = linhas.slice(i + 1, i + 6).join('\n').match(/(\d\d\/\d\d\/\d{4})/); if (m) pagamento = dataIso(m[1]); }
    let m = l.match(/^\s*(\d\d\/\d\d\/\d{4})\s+(\d{10})\s+(\d+)\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s*$/);
    if (m) lotes.push({ dataProtocolo: dataIso(m[1]), protocolo: m[2], lote: m[3], informado: num(m[4]), processado: num(m[5]), liberado: num(m[6]), glosa: num(m[7]) });
    m = l.match(/^\s*(\d{9})\s+(\d{9})\s+(\S+)\s+(\w+)\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)\s*$/);
    if (m) guias.push({ guia: m[1], senha: m[3], tipo: m[4], processado: num(m[5]), liberado: num(m[6]), glosa: num(m[7]) });
  });
  const L = lotes[0] || {};
  return guias.map((g) => ({ ...g, pagamento, protocolo: L.protocolo || null, lote: L.lote || null, dataProtocolo: L.dataProtocolo || null }));
}

// Relatório do profissional: "Nome  valor  data  senha  [observação]" (tolerante a espaços de PDF e a planilha).
export function lerRelatorioProfissional(linhas, rotulo = '') {
  const itens = [], naoLidas = [];
  for (const bruta of linhas) {
    const l = bruta.replace(/\s+/g, ' ').trim(); if (!l) continue;
    const m = l.match(/^(.+?) (?:R\$ ?)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+\.\d{2}) (\d{1,2}\/\d{1,2}\/\d{2,4}) ([A-Z]{1,3}\d{8,})(?: (.*))?$/);
    if (m) itens.push({ origem: rotulo, nome: m[1].trim(), valor: m[2].includes(',') ? num(m[2]) : Number(m[2]), data: dataIso(m[3]), senha: m[4], obs: (m[5] || '').trim() });
    else if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l) && /[A-Z]{1,3}\d{8,}/.test(l)) naoLidas.push(l);
  }
  return { itens, naoLidas };
}

export const SITUACOES = { pago: 'Pago', glosa_parcial: 'Glosa parcial', glosado: 'Glosado', aguardando: 'Aguardando', atrasado: 'Atrasado' };

// Cruza por senha. `hoje` e `prazoDias` definem quando "Aguardando" vira "Atrasado" (a contar da data do atendimento).
export function cruzar(itens, guiasAmil, { hoje = new Date().toISOString().slice(0, 10), prazoDias = 60 } = {}) {
  const porSenha = new Map(); guiasAmil.forEach((g) => { const a = porSenha.get(g.senha) || []; a.push(g); porSenha.set(g.senha, a); });
  const contaSenha = new Map(); itens.forEach((i) => contaSenha.set(i.senha, (contaSenha.get(i.senha) || 0) + 1));
  const dias = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
  const linhas = itens.map((it) => {
    const gs = porSenha.get(it.senha) || [], avisos = [];
    if (contaSenha.get(it.senha) > 1) avisos.push('Senha repetida no relatório do profissional');
    if (gs.length > 1) avisos.push('Senha em mais de um demonstrativo');
    let situacao, repasse, g = gs[0] || null;
    if (!g) {
      situacao = it.data && dias(it.data, hoje) > prazoDias ? 'atrasado' : 'aguardando'; repasse = null;
    } else {
      const proc = gs.reduce((s, x) => s + x.processado, 0), lib = gs.reduce((s, x) => s + x.liberado, 0), glo = gs.reduce((s, x) => s + x.glosa, 0);
      if (glo > 0 && lib <= 0) { situacao = 'glosado'; repasse = 0; }                         // glosa total: perde 100% do repasse (regra a confirmar)
      else if (glo > 0) { situacao = 'glosa_parcial'; repasse = Math.round(cents(it.valor) * (lib / (proc || lib + glo))) / 100; }   // proporcional ao pago
      else { situacao = 'pago'; repasse = it.valor; }
    }
    return { ...it, situacao, repasse, guia: g ? g.guia : null, pagamento: g ? g.pagamento : null, protocolo: g ? g.protocolo : null,
      liberadoOperadora: g ? gs.reduce((s, x) => s + x.liberado, 0) : null, glosaOperadora: g ? gs.reduce((s, x) => s + x.glosa, 0) : null, avisos: avisos.filter(Boolean) };
  });
  return linhas;
}

export function resumo(linhas, guiasAmil) {
  const senhas = new Set(linhas.map((l) => l.senha));
  const r = { total: linhas.length, porSituacao: {}, repasseAPagar: 0, repasseNaoPago: 0, guiasDeOutros: guiasAmil.filter((g) => !senhas.has(g.senha)).length };
  linhas.forEach((l) => {
    r.porSituacao[l.situacao] = (r.porSituacao[l.situacao] || 0) + 1;
    if (l.repasse != null) r.repasseAPagar += cents(l.repasse); else r.repasseNaoPago += cents(l.valor);
  });
  r.repasseAPagar /= 100; r.repasseNaoPago /= 100;
  return r;
}

export function csv(linhas) {
  const q = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cab = ['Origem', 'Nome', 'Data', 'Senha', 'Valor do relatório', 'Situação', 'Repasse a pagar', 'Guia', 'Pagamento da operadora', 'Observação', 'Avisos'];
  return '﻿' + [cab, ...linhas.map((l) => [l.origem, l.nome, l.data, l.senha, String(l.valor).replace('.', ','), SITUACOES[l.situacao],
    l.repasse == null ? '' : String(l.repasse).replace('.', ','), l.guia, l.pagamento, l.obs, l.avisos.join(' | ')])].map((r) => r.map(q).join(';')).join('\r\n');
}

// Reconstrói linhas de texto a partir dos itens do PDF.js ({ str, x, y }): mesma altura (y) = mesma linha, da esquerda para a direita.
export function linhasDeItens(itens, tolerancia = 2) {
  const grupos = [];
  [...itens].filter((i) => i.str && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x).forEach((i) => {
    const g = grupos.find((x) => Math.abs(x.y - i.y) <= tolerancia);
    if (g) g.itens.push(i); else grupos.push({ y: i.y, itens: [i] });
  });
  return grupos.map((g) => g.itens.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join('   '));
}
