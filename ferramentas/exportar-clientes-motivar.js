// Exporta o cadastro de clientes do sistema antigo para um CSV NO SEU COMPUTADOR.
// Uso: com o sistema aberto e logado, F12 → aba Console → cole tudo e aperte Enter.
// Nada é enviado para fora: o script só lê as fichas que você já pode ver e baixa um arquivo.
(async () => {
  const BASE = location.origin + location.pathname;
  const LOTE = 6; // fichas lidas ao mesmo tempo
  const parser = new DOMParser();
  const ler = async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    return parser.parseFromString(new TextDecoder('iso-8859-1').decode(await r.arrayBuffer()), 'text/html');
  };

  // 1) Descobre os IDs pela lista de clientes
  const lista = await ler(BASE + '?pagina=clientes');
  const ids = [...lista.querySelectorAll('a[href*="dados_cliente"]')]
    .map((a) => Number(new URL(a.getAttribute('href'), BASE).searchParams.get('id'))).filter(Boolean);
  const maior = Math.max(...ids);
  console.log(`Lista mostra ${ids.length} clientes; maior ID ${maior}. Varrendo de 1 a ${maior + 300}…`);

  // 2) Lê a ficha de edição de cada ID (mesmos campos do formulário de cadastro)
  const linhas = [], colunas = new Set(['id_origem']);
  const lerFicha = async (id) => {
    const doc = await ler(`${BASE}?pagina=cliente&id=${id}`);
    const form = [...doc.querySelectorAll('form')].find((f) => f.querySelector('select, input[type=text]'));
    if (!form) return;
    const reg = { id_origem: String(id) };
    for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      if (el.type === 'hidden' || el.type === 'submit') continue;
      const nome = el.name.replace(/\[\]$/, '');
      let v = el.tagName === 'SELECT' ? (el.selectedOptions[0]?.textContent || '')
        : el.type === 'checkbox' ? (el.checked ? 'sim' : '') : (el.getAttribute('value') ?? el.textContent ?? '');
      if (el.type === 'checkbox' && reg[nome]) v = [reg[nome], v].filter(Boolean).join(',');
      reg[nome] = String(v).trim(); colunas.add(nome);
    }
    const nomeCampo = Object.keys(reg).find((k) => /nome/i.test(k) && !/pai|mae|m.e|medico/i.test(k));
    if (nomeCampo && reg[nomeCampo]) linhas.push(reg);
  };
  for (let i = 1; i <= maior + 300; i += LOTE) {
    await Promise.all(Array.from({ length: LOTE }, (_, k) => lerFicha(i + k).catch(() => {})));
    if (i % 300 < LOTE) console.log(`… ${i} verificados, ${linhas.length} clientes encontrados`);
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
  console.log(`✅ Pronto: ${linhas.length} clientes exportados. Colunas: ${cols.join(', ')}`);
})();
