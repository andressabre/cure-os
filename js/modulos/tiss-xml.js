// Gerador do XML de envio de lote (TISS 4.03.00, guia SP/SADT).
// Puro: recebe o JSON de dados_xml_lote() e devolve { xml, hash, bytes, pendencias }.
// Validado contra os XSD oficiais da ANS (tissV4_03_00.xsd) — ver ferramentas/validar-xml-tiss.sh.

const CONSELHO = { CRAS: '01', COREN: '02', CRF: '03', CRFA: '04', CREFITO: '05', CRM: '06', CRN: '07', CRO: '08', CRP: '09' };
const UF = { RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25',
  PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53' };
const TABELAS = ['18', '19', '20', '22', '90', '98', '00'];

const dig = (v) => String(v ?? '').replace(/\D/g, '');
// Só caracteres representáveis em ISO-8859-1, sem quebras, cortado no tamanho do campo
const texto = (v, max) => String(v ?? '').normalize('NFC').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const dec = (v) => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
const conselho = (c) => CONSELHO[String(c || '').toUpperCase().replace(/[^A-Z]/g, '')] || '10';
const uf = (u) => UF[String(u || '').toUpperCase()] || null;
// Razão social cadastrada pode ter observação depois do travessão ("Clínica Motivar – CNPJ novo (...)")
const nomeContratado = (r) => texto(String(r || '').split(/\s[–-]\s/)[0], 70);

// Árvore simples: [nome, filhos | valor]. Valor nulo/vazio = elemento omitido (campos opcionais).
const el = (nome, conteudo) => [nome, conteudo];
const opt = (nome, v) => (v == null || v === '' ? null : el(nome, v));

function serializar(no, nivel, partes, valores) {
  if (!no) return;
  const [nome, c] = no, ind = '  '.repeat(nivel);
  if (Array.isArray(c)) {
    partes.push(`${ind}<ans:${nome}>`);
    c.forEach((f) => serializar(f, nivel + 1, partes, valores));
    partes.push(`${ind}</ans:${nome}>`);
  } else {
    const v = String(c);
    valores.push(v);
    partes.push(`${ind}<ans:${nome}>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</ans:${nome}>`);
  }
}

function guiaSadt(g, k, pend) {
  const ref = `Guia ${g.numero}`;
  const s = g.solicitante;
  if (!dig(g.carteirinha)) pend.push({ bloqueia: true, msg: `${ref}: paciente sem carteirinha.` });
  if (!s) pend.push({ bloqueia: true, msg: `${ref}: sem médico solicitante.` });
  else {
    if (!s.numero) pend.push({ bloqueia: true, msg: `${ref}: solicitante ${s.nome} sem número do conselho.` });
    if (!uf(s.uf)) pend.push({ bloqueia: true, msg: `${ref}: solicitante ${s.nome} sem UF do conselho.` });
    if (dig(s.cbo).length !== 6) pend.push({ bloqueia: true, msg: `${ref}: solicitante ${s.nome} sem CBO de 6 dígitos.` });
  }
  if (g.senha && !g.data_autorizacao) pend.push({ bloqueia: true, msg: `${ref}: senha sem data da autorização.` });
  if (!g.itens?.length) pend.push({ bloqueia: true, msg: `${ref}: sem procedimentos.` });

  let total = 0;
  const procs = (g.itens || []).map((it, i) => {
    const qtd = Math.round(Number(it.quantidade) || 1), valor = Number(it.valor) || 0;
    total += valor;
    if (!TABELAS.includes(it.tabela)) pend.push({ bloqueia: true, msg: `${ref}: tabela "${it.tabela}" inválida no item ${it.codigo}.` });
    if (String(it.codigo).length > 10) pend.push({ bloqueia: true, msg: `${ref}: código ${it.codigo} maior que 10 caracteres.` });
    const p = it.profissional || {}, cpf = dig(p.cpf);
    if (cpf.length !== 11) pend.push({ bloqueia: false, msg: `${ref}: ${p.nome || 'profissional'} sem CPF — o executante vai sem identificação individual (equipe).` });
    if (dig(p.cbo).length !== 6 && cpf.length === 11) pend.push({ bloqueia: true, msg: `${ref}: ${p.nome} sem CBO de 6 dígitos.` });
    return el('procedimentoExecutado', [
      el('sequencialItem', i + 1),
      el('dataExecucao', it.data),
      opt('horaInicial', it.hora_inicio), opt('horaFinal', it.hora_fim),
      el('procedimento', [el('codigoTabela', it.tabela), el('codigoProcedimento', texto(it.codigo, 10)),
        el('descricaoProcedimento', texto(it.descricao, 150))]),
      el('quantidadeExecutada', qtd),
      el('reducaoAcrescimo', '1.00'),
      el('valorUnitario', dec(valor / qtd)),
      el('valorTotal', dec(valor)),
      cpf.length === 11 ? el('equipeSadt', [
        el('codProfissional', [el('cpfContratado', cpf)]),
        el('nomeProf', texto(p.nome, 70)),
        el('conselho', conselho(p.conselho)),
        el('numeroConselhoProfissional', texto(p.numero, 15)),
        el('UF', uf(p.uf) || '98'),
        el('CBOS', dig(p.cbo)),
      ]) : null,
    ]);
  });

  return el('guiaSP-SADT', [
    el('cabecalhoGuia', [el('registroANS', k.ans), el('numeroGuiaPrestador', texto(g.numero, 20))]),
    g.senha ? el('dadosAutorizacao', [
      opt('numeroGuiaOperadora', texto(g.numero_operadora, 20)),
      el('dataAutorizacao', g.data_autorizacao),
      el('senha', texto(g.senha, 20)),
      opt('dataValidadeSenha', g.validade_senha),
    ]) : null,
    el('dadosBeneficiario', [el('numeroCarteira', texto(g.carteirinha, 20)), el('atendimentoRN', 'N')]),
    el('dadosSolicitante', [
      el('contratadoSolicitante', [el('codigoPrestadorNaOperadora', k.codigo)]),
      el('nomeContratadoSolicitante', k.nome),
      el('profissionalSolicitante', [
        opt('nomeProfissional', texto(s?.nome, 70)),
        el('conselhoProfissional', conselho(s?.conselho)),
        el('numeroConselhoProfissional', texto(s?.numero, 15)),
        el('UF', uf(s?.uf) || '98'),
        el('CBOS', dig(s?.cbo)),
      ]),
    ]),
    el('dadosSolicitacao', [el('caraterAtendimento', g.carater || '1'), opt('indicacaoClinica', texto(g.indicacao_clinica, 500))]),
    el('dadosExecutante', [el('contratadoExecutante', [el('codigoPrestadorNaOperadora', k.codigo)]), el('CNES', k.cnes)]),
    el('dadosAtendimento', [el('tipoAtendimento', g.tipo_atendimento || '03'), el('indicacaoAcidente', '9'),
      el('regimeAtendimento', g.regime || '01')]),
    el('procedimentosExecutados', procs),
    el('valorTotal', [el('valorProcedimentos', dec(total)), el('valorTotalGeral', dec(total))]),
  ]);
}

export function gerarXmlLote(d, agora = new Date()) {
  const pend = [];
  const c = d.contrato, versao = c.versao || '4.03.00';
  const k = {
    ans: dig(c.registro_ans), cnes: dig(c.cnes),
    codigo: texto(c.codigo_prestador || dig(c.cnpj), 14), nome: nomeContratado(c.razao_social),
  };
  if (versao !== '4.03.00') pend.push({ bloqueia: true, msg: `Contrato na versão TISS ${versao}: o gerador está pronto só para 4.03.00.` });
  if (d.lote.tipo !== 'SP_SADT') pend.push({ bloqueia: true, msg: `Lote de ${d.lote.tipo}: por ora o XML é gerado só para guias SP/SADT.` });
  if (k.ans.length !== 6) pend.push({ bloqueia: true, msg: 'Operadora sem registro ANS de 6 dígitos.' });
  if (!k.codigo) pend.push({ bloqueia: true, msg: 'Contrato sem código do prestador na operadora.' });
  if (k.cnes.length !== 7) pend.push({ bloqueia: true, msg: 'CNPJ de faturamento sem CNES de 7 dígitos.' });
  if (!k.nome) pend.push({ bloqueia: true, msg: 'CNPJ de faturamento sem razão social.' });
  if (!d.guias.length) pend.push({ bloqueia: true, msg: 'Lote sem guias.' });

  const p2 = (n) => String(n).padStart(2, '0');
  const dataReg = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}`;
  const horaReg = `${p2(agora.getHours())}:${p2(agora.getMinutes())}:${p2(agora.getSeconds())}`;

  const corpo = [
    el('cabecalho', [
      el('identificacaoTransacao', [el('tipoTransacao', 'ENVIO_LOTE_GUIAS'), el('sequencialTransacao', d.lote.numero),
        el('dataRegistroTransacao', dataReg), el('horaRegistroTransacao', horaReg)]),
      el('origem', [el('identificacaoPrestador', [el('codigoPrestadorNaOperadora', k.codigo)])]),
      el('destino', [el('registroANS', k.ans)]),
      el('Padrao', versao),
    ]),
    el('prestadorParaOperadora', [el('loteGuias', [el('numeroLote', d.lote.numero),
      el('guiasTISS', d.guias.map((g) => guiaSadt(g, k, pend)))])]),
  ];

  // Hash do epílogo: MD5 do conteúdo de todos os campos, na ordem, sem as tags (codificação ISO-8859-1)
  const partes = [], valores = [];
  corpo.forEach((n) => serializar(n, 1, partes, valores));
  const hash = md5(latin1(valores.join('')));
  const xml = ['<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
    ' xsi:schemaLocation="http://www.ans.gov.br/padroes/tiss/schemas http://www.ans.gov.br/padroes/tiss/schemas/tissV4_03_00.xsd">',
    ...partes, `  <ans:epilogo>`, `    <ans:hash>${hash}</ans:hash>`, `  </ans:epilogo>`, '</ans:mensagemTISS>', ''].join('\n');

  const total = d.guias.reduce((s, g) => s + (g.itens || []).reduce((t, i) => t + Number(i.valor || 0), 0), 0);
  return { xml, hash, bytes: latin1(xml), total: +total.toFixed(2), pendencias: unicas(pend),
    nomeArquivo: `${d.lote.numero}_${hash}.xml` };
}

const unicas = (lista) => [...new Map(lista.map((p) => [p.msg, p])).values()];

export function latin1(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[i] = c < 256 ? c : 63; }
  return b;
}

// MD5 (RFC 1321) sobre bytes — sem dependência externa
export function md5(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const n = bytes.length, tam = ((n + 8) >>> 6) + 1, M = new Uint32Array(tam * 16);
  for (let i = 0; i < n; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
  M[n >> 2] |= 0x80 << ((n % 4) * 8);
  M[tam * 16 - 2] = (n * 8) >>> 0; M[tam * 16 - 1] = Math.floor(n / 0x20000000);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < M.length; o += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const t = (A + F + K[i] + M[o + g]) >>> 0;
      A = D; D = C; C = B; B = (B + ((t << s) | (t >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((x) => [0, 8, 16, 24].map((s) => ((x >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
