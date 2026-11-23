// Envia arquivos inventados (texto) e confere situações, CSV e filtro.
const demo = `9. Data de Pagamento\n 03/11/2026\n 29/09/2026 1234567890 11 100,00 100,00 60,00 40,00\n 000000001 000000002 CO0000000000001 SP 50,00 50,00 -\n 000000003 000000004 CO0000000000002 SP 50,00 10,00 40,00\n 000000005 000000006 CO0000000000003 SP 30,00 0,00 30,00\n`;
const rel = `Ana Teste;32;10/9/2026;CO0000000000001\nBeto Teste;32;11/09/2026;CO0000000000002\nCris Teste;32;12/09/2026;CO0000000000003\nEva Teste;32;20/11/2026;CO0000000000010\n`;
export default async (pagina) => {
  await pagina.setInputFiles('#f-amil', { name: 'demonstrativo.txt', mimeType: 'text/plain', buffer: Buffer.from(demo) });
  await pagina.setInputFiles('#f-rel', { name: 'setembro.csv', mimeType: 'text/csv', buffer: Buffer.from(rel) });
  await pagina.click('#conferir');
  await pagina.waitForSelector('#baixar');
  const t = await pagina.textContent('#res');
  for (const x of ['Glosa parcial', 'Glosado', 'Aguardando', 'Pago', 'Ana Teste']) if (!t.includes(x)) throw new Error('faltou ' + x);
  await pagina.click('[data-f="glosado"]');
  const g = await pagina.textContent('#res tbody');
  if (g.includes('Ana Teste') || !g.includes('Cris Teste')) throw new Error('filtro Glosado errado');
};
