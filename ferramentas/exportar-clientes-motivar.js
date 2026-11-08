// Exporta o cadastro de clientes do sistema antigo para um CSV NO SEU COMPUTADOR. (v2)
// Uso: com o sistema aberto e logado, F12 → Console → cole tudo e aperte Enter.
// Nada é enviado para fora: o script só lê as fichas que você já pode ver e baixa um arquivo.
(async () => {
  const BASE = location.origin + location.pathname;
  const LOTE = 6;
  const parser = new DOMParser();
  const ler = async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return parser.parseFromString(new TextDecoder('iso-8859-1').decode(await r.arrayBuffer()), 'text/html');
  };
  const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  // 1) Lista completa de clientes (ID + nome exibido)
  const lista = await ler(BASE + '?pagina=clientes');
  const clientes = new Map();
  for (const a of lista.querySelectorAll('a[href*="dados_cliente"]')) {
    const id = new URL(a.getAttribute('href'), BASE).searchParams.get('id');
    if (id && !clientes.has(id)) clientes.set(id, limpa(a.textContent));
  }
  console.log(`Lista mostra ${clientes.size} clientes. Lendo fichas…`);

  // Lê campos de um documento: formulário (inputs) + tabelas "Rótulo | valor" + textos "Rótulo: valor"
  const extrair = (doc, reg) => {
    for (const el of doc.querySelectorAll('form input[name], form select[name], form textarea[name]')) {
      if (['hidden', 'submit', 'button', 'password'].includes(el.type)) continue;
      const nome = el.name.replace(/\[\]$/, '');
      let v = el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent
        : el.type === 'checkbox' ? (el.checked ? 'sim' : '') : (el.getAttribute('value') ?? el.textContent);
      v = limpa(v);
      if (v) reg[nome] = el.type === 'checkbox' && reg[nome] ? `${reg[nome]},${v}` : v;
    }
    for (const tr of doc.querySelectorAll('tr')) {
      const tds = [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName));
      if (tds.length === 2 && !tds[0].querySelector('table, input, select')) {
        const rot = limpa(tds[0].textContent).replace(/:$/, '');
        const val = limpa(tds[1].textContent);
        if (rot && rot.length < 40 && val && !reg[rot]) reg[rot] = val;
      }
    }
    for (const el of doc.querySelectorAll('td, p, div, span, li')) {
      if (el.children.length > 2) continue;
      const m = limpa(el.textContent).match(/^([^:]{2,30}):\s*(.+)$/);
      if (m && !reg[m[1]]) reg[m[1]] = m[2].slice(0, 300);
    }
  };

  const linhas = [], colunas = new Set(['id_origem', 'nome_lista']);
  let mostrouColunas = false;
  const lerFicha = async (id) => {
    const reg = { id_origem: id, nome_lista: clientes.get(id) };
    const doc = await ler(`${BASE}?pagina=dados_cliente&id=${id}`);
    extrair(doc, reg);
    // Se a ficha tiver link de edição, lê também o formulário (tem todos os campos)
    const ed = [...doc.querySelectorAll('a[href]')].find((a) => /pagina=(editar_)?cliente(&|$)/i.test(a.getAttribute('href')) && a.getAttribute('href').includes(id));
    if (ed) extrair(await ler(new URL(ed.getAttribute('href'), BASE).href), reg);
    Object.keys(reg).forEach((k) => colunas.add(k));
    linhas.push(reg);
    if (!mostrouColunas && linhas.length >= 5) {
      mostrouColunas = true;
      console.log(`Campos encontrados nas fichas: ${[...colunas].join(' | ')}`);
    }
  };

  const ids = [...clientes.keys()];
  for (let i = 0; i < ids.length; i += LOTE) {
    await Promise.all(ids.slice(i, i + LOTE).map((id) => lerFicha(id).catch(() => {
      linhas.push({ id_origem: id, nome_lista: clientes.get(id) });
    })));
    if (i % 300 < LOTE) console.log(`… ${Math.min(i + LOTE, ids.length)} de ${ids.length} fichas lidas`);
  }

  // 3) Monta e baixa o CSV
  const cols = [...colunas];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(esc).join(';'), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `clientes-sistema-antigo-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`✅ Pronto: ${linhas.length} clientes exportados.`);
})();
