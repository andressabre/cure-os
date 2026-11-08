// Exporta o cadastro de clientes do sistema antigo para um CSV NO SEU COMPUTADOR. (v3)
// Uso: com o sistema aberto e logado, F12 → Console → cole tudo e aperte Enter.
// Ao terminar, aparece um BOTÃO LARANJA no topo da página: clique nele para baixar o arquivo.
(async () => {
  const BASE = location.origin + location.pathname;
  const LOTE = 8;
  const parser = new DOMParser();
  const ler = async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return parser.parseFromString(new TextDecoder('iso-8859-1').decode(await r.arrayBuffer()), 'text/html');
  };

  // 1) Só os IDs que existem (lista de clientes)
  const lista = await ler(BASE + '?pagina=clientes');
  const ids = [...new Set([...lista.querySelectorAll('a[href*="dados_cliente"]')]
    .map((a) => new URL(a.getAttribute('href'), BASE).searchParams.get('id')).filter(Boolean))];
  console.log(`Lista mostra ${ids.length} clientes. Lendo fichas…`);

  // 2) Ficha de edição de cada cliente
  const linhas = [], colunas = new Set(['id_origem']);
  const lerFicha = async (id) => {
    const doc = await ler(`${BASE}?pagina=cliente&id=${id}`);
    const form = [...doc.querySelectorAll('form')].find((f) => f.querySelector('select, input[type=text]'));
    if (!form) return;
    const reg = { id_origem: String(id) };
    for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      if (el.type === 'hidden' || el.type === 'submit') continue;
      const nome = el.name.replace(/\[\]$/, '');
      const v = el.tagName === 'SELECT' ? (el.selectedOptions[0]?.textContent || '')
        : el.type === 'checkbox' ? (el.checked ? 'sim' : '') : (el.getAttribute('value') ?? el.textContent ?? '');
      reg[nome] = String(v).trim(); colunas.add(nome);
    }
    if (reg.nome) linhas.push(reg);
  };
  for (let i = 0; i < ids.length; i += LOTE) {
    await Promise.all(ids.slice(i, i + LOTE).map((id) => lerFicha(id).catch(() => {})));
    if (i % 400 < LOTE) console.log(`… ${Math.min(i + LOTE, ids.length)} de ${ids.length} fichas lidas`);
  }

  // 3) Monta o CSV, guarda na página e mostra o botão de download
  const cols = [...colunas];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(esc).join(';'), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\r\n');
  window.csvClientes = csv;
  const nomeArq = `clientes-sistema-antigo-${new Date().toISOString().slice(0, 10)}.csv`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const b = Object.assign(document.createElement('a'), { href: url, download: nomeArq,
    textContent: `⬇ BAIXAR ${linhas.length} CLIENTES (CSV)` });
  b.style.cssText = 'position:fixed;top:12px;left:12px;z-index:99999;background:#F8781D;color:#fff;font:bold 18px sans-serif;padding:16px 24px;border-radius:10px;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.3)';
  document.body.appendChild(b);
  console.log(`✅ Pronto: ${linhas.length} clientes. Clique no botão laranja no topo da página para baixar.`);
})();
