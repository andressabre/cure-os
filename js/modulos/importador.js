// Leitura de arquivos de cadastro (backup .sql, .csv, .xlsx) — tudo no navegador, nada sai do computador
// até a gestora confirmar a importação.

export async function lerArquivo(arquivo) {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) return lerPlanilha(arquivo);
  const texto = decodificar(await arquivo.arrayBuffer());
  if (/INSERT\s+INTO/i.test(texto.slice(0, 2_000_000))) return lerSqlDump(texto);
  return { tabelas: { planilha: lerCsv(texto) } };
}

// UTF-8 quando válido; senão Latin-1 (sistemas antigos, como o da Motivar)
function decodificar(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('iso-8859-1').decode(buf); }
}

async function lerPlanilha(arquivo) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true });
  const tabelas = {};
  for (const nome of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, defval: '' });
    if (linhas.length) tabelas[nome] = { colunas: linhas[0].map(String), linhas: linhas.slice(1) };
  }
  return { tabelas };
}

function lerCsv(texto) {
  const sep = [';', ',', '\t'].sort((a, b) => texto.split('\n')[0].split(b).length - texto.split('\n')[0].split(a).length)[0];
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c; }
    else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const validas = linhas.filter((l) => l.some((x) => x.trim()));
  return { colunas: validas[0] || [], linhas: validas.slice(1) };
}

// Dump MySQL: CREATE TABLE (para nomes de colunas) + INSERT INTO ... VALUES (...),(...);
function lerSqlDump(texto) {
  const colunasCriadas = {};
  for (const m of texto.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\)\s*(?:ENGINE|TYPE|;)/gi)) {
    const partes = []; let nivel = 0, atual = '';
    for (const ch of m[2]) { if (ch === '(') nivel++; if (ch === ')') nivel--; if (ch === ',' && !nivel) { partes.push(atual); atual = ''; } else atual += ch; }
    partes.push(atual);
    colunasCriadas[m[1]] = partes.map((p) => p.trim().match(/^`?(\w+)`?\s+\w/)?.[1])
      .filter((c) => c && !/^(PRIMARY|KEY|UNIQUE|INDEX|CONSTRAINT|FOREIGN|FULLTEXT)$/i.test(c));
  }
  const tabelas = {};
  const re = /INSERT\s+INTO\s+`?(\w+)`?\s*(\(([^)]*)\))?\s*VALUES\s*/gi;
  let m;
  while ((m = re.exec(texto))) {
    const tabela = m[1];
    const cols = m[3] ? m[3].split(',').map((c) => c.trim().replace(/`/g, '')) : colunasCriadas[tabela] || [];
    const { tuplas, fim } = lerTuplas(texto, re.lastIndex);
    re.lastIndex = fim;
    const t = (tabelas[tabela] ||= { colunas: cols, linhas: [] });
    if (!t.colunas.length) t.colunas = cols.length ? cols : (tuplas[0] || []).map((_, i) => `coluna_${i + 1}`);
    t.linhas.push(...tuplas);
  }
  return { tabelas };
}

function lerTuplas(s, i) {
  const tuplas = []; let atual = null, val = '', aspas = false, temValor = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '\\') { const n = s[++i]; val += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n === '0' ? '' : n; }
      else if (c === "'" && s[i + 1] === "'") { val += "'"; i++; }
      else if (c === "'") aspas = false;
      else val += c;
      continue;
    }
    if (c === "'") { aspas = true; temValor = true; }
    else if (c === '(' && !atual) { atual = []; val = ''; temValor = false; }
    else if ((c === ',' || c === ')') && atual) {
      const v = temValor ? val : val.trim();
      atual.push(!temValor && /^null$/i.test(v) ? null : v);
      val = ''; temValor = false;
      if (c === ')') { tuplas.push(atual); atual = null; }
    }
    else if (c === ';' && !atual) return { tuplas, fim: i + 1 };
    else if (atual) val += c;
  }
  return { tuplas, fim: i };
}

// ---------- Mapeamento para o cadastro do Cure OS ----------
export const CAMPOS = {
  origem_id: ['id_origem', 'id', 'id_cliente', 'codigo', 'cod'],
  nome: ['nome', 'nome_lista', 'name', 'paciente', 'cliente'],
  sexo: ['sexo', 'genero', 'id_sexo'],
  data_nascimento: ['nascimento', 'data_nascimento', 'datanascimento', 'dt_nasc', 'data_nasc', 'nasc'],
  cpf: ['cpf'],
  nome_mae: ['mae', 'nome_mae', 'nomemae', 'nome_da_mae'],
  telefone: ['telefone', 'fone', 'tel'],
  celular: ['celular', 'cel', 'whatsapp'],
  email: ['email', 'e_mail', 'e-mail'],
  rua: ['rua', 'endereco', 'logradouro'],
  cep: ['cep'],
  complemento: ['complemento'],
  cidade: ['cidade', 'municipio'],
  estado: ['estado', 'uf', 'id_estado'],
  convenio: ['convenio', 'id_convenio', 'plano'],
  carteirinha: ['n_conveniado', 'nconveniado', 'nconvenio', 'n_convenio', 'numconvenio', 'num_conveniado', 'numero_conveniado', 'num_convenio', 'carteirinha', 'conveniado', 'matricula'],
  cid10: ['cid', 'cid10', 'cid_10'],
  medico_indicou: ['medico', 'medico_indicou', 'indicacao'],
  crm: ['crm', 'crm_medico'],
  bloqueado: ['bloqueado', 'inativo'],
};
export const ROTULOS = { origem_id: 'ID no sistema antigo', nome: 'Nome', sexo: 'Sexo', data_nascimento: 'Data de nascimento',
  cpf: 'CPF', nome_mae: 'Nome da mãe', telefone: 'Telefone', celular: 'Celular', email: 'E-mail', rua: 'Rua', cep: 'CEP',
  complemento: 'Complemento', cidade: 'Cidade', estado: 'Estado', convenio: 'Convênio', carteirinha: 'Nº do conveniado',
  cid10: 'CID-10', medico_indicou: 'Médico que indicou', crm: 'CRM', bloqueado: 'Bloqueado' };

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function sugerirMapa(colunas) {
  const n = colunas.map(norm), mapa = {};
  for (const [campo, nomes] of Object.entries(CAMPOS)) {
    let i = n.findIndex((c) => nomes.includes(c));
    if (i < 0) i = n.findIndex((c) => nomes.some((x) => x.length > 3 && c.includes(x)));
    if (i >= 0 && !Object.values(mapa).includes(i)) mapa[campo] = i;
  }
  return mapa;
}

export function sugerirTabela(tabelas) {
  const nomes = Object.keys(tabelas);
  return nomes.find((t) => /^(clientes?|pacientes?)$/i.test(t)) || nomes.find((t) => /client|pacient/i.test(t))
    || nomes.sort((a, b) => tabelas[b].linhas.length - tabelas[a].linhas.length)[0];
}

// Tabelas de apoio do dump (convênios, estados) viram dicionários id → nome
export function dicionario(tabelas, padrao) {
  const nome = Object.keys(tabelas).find((t) => padrao.test(t));
  if (!nome) return {};
  const t = tabelas[nome], ci = t.colunas.map(norm);
  let iId = ci.findIndex((c) => c === 'id' || c.startsWith('id_')), iNome = ci.findIndex((c) => /nome|descricao|sigla|uf/.test(c));
  if (iId < 0 && iNome < 0 && ci.length >= 2) { iId = 0; iNome = 1; }
  if (iId < 0 || iNome < 0) return {};
  return Object.fromEntries(t.linhas.map((l) => [String(l[iId]), String(l[iNome] ?? '').trim()]));
}

const so = (v) => (v == null ? '' : String(v).trim());
const digitos = (v) => so(v).replace(/\D/g, '');

export function dataIso(v) {
  const s = so(v); if (!s || /^0000/.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] === '0000' ? null : `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})(\d{2})(\d{4})$/); if (m) return dataIso(`${m[1]}/${m[2]}/${m[3]}`);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { let a = +m[3]; if (a < 100) a += a > 30 ? 1900 : 2000; const d = `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isNaN(Date.parse(d)) ? null : d; }
  return null;
}

export function converter(linha, mapa, dics) {
  const v = (campo) => (mapa[campo] == null ? '' : so(linha[mapa[campo]]));
  const sexoBruto = v('sexo').toUpperCase();
  const sexo = /^(F|FEM|3)/.test(sexoBruto) ? 'F' : /^(M|MASC|2)/.test(sexoBruto) ? 'M' : null;
  let cpf = digitos(v('cpf')); if (cpf.length >= 9 && cpf.length < 11) cpf = cpf.padStart(11, '0');
  const conv = v('convenio'), est = v('estado');
  const endereco = { rua: v('rua'), cep: digitos(v('cep')), complemento: v('complemento'), cidade: v('cidade'),
    uf: dics.estados[est] || est };
  const extras = { convenio_origem: dics.convenios[conv] || conv, carteirinha_origem: v('carteirinha'), celular: v('celular'),
    cid10: v('cid10'), medico_indicou: v('medico_indicou'), crm_medico: v('crm') };
  Object.keys(extras).forEach((k) => !extras[k] && delete extras[k]);
  Object.keys(endereco).forEach((k) => !endereco[k] && delete endereco[k]);
  const bloq = v('bloqueado').toLowerCase();
  return {
    nome: v('nome').replace(/\s+/g, ' '),
    sexo, cpf: cpf.length === 11 ? cpf : null, data_nascimento: dataIso(v('data_nascimento')),
    nome_mae: v('nome_mae') || null, telefone: v('telefone') || v('celular') || null,
    email: /@/.test(v('email')) ? v('email').toLowerCase() : null,
    endereco: Object.keys(endereco).length ? endereco : null, campos_extras: extras,
    origem_id: v('origem_id') || null, ativo: !['1', 's', 'sim', 'on', 'true'].includes(bloq),
  };
}

// Formato dos valores sem expor o conteúdo: dígitos viram 9, letras viram a (ex.: 99/99/9999)
export function formatos(linhas, i, max = 4) {
  if (i == null) return 'coluna não ligada';
  const c = {}; let vazios = 0;
  for (const l of linhas) {
    const v = so(l[i]); if (!v) { vazios++; continue; }
    const f = v.replace(/\d/g, '9').replace(/[A-Za-zÀ-ú]+/g, 'a').slice(0, 20); c[f] = (c[f] || 0) + 1;
  }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, max).map(([f, n]) => `"${f}" ${n}×`).join(', ');
  return `${vazios} vazios${top ? '; preenchidos: ' + top : ''}`;
}
