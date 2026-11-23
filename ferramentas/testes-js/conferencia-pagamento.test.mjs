// Teste da conferência de pagamento com dados inventados (nenhum dado real).
import assert from 'node:assert/strict';
import { lerDemonstrativoAmil, lerRelatorioProfissional, cruzar, resumo, csv } from '../../js/modulos/conferencia-pagamento.js';
const demo = `9. Data de Pagamento
   03/11/2026
   29/09/2026   1234567890   11   100,00   100,00   60,00   40,00
   000000001   000000002   CO0000000000001   SP   50,00   50,00   -
   000000003   000000004   CO0000000000002   SP   50,00   10,00   40,00
   000000005   000000006   CO0000000000003   SP   30,00   0,00   30,00`.split('\n');
const g = lerDemonstrativoAmil(demo);
assert.equal(g.length, 3); assert.equal(g[0].pagamento, '2026-11-03'); assert.equal(g[1].glosa, 40); assert.equal(g[0].glosa, 0);
const rel = `Ana Teste   32,00   10/9/2026   CO0000000000001   ok
Beto Teste 32,00 11/09/2026 CO0000000000002
Cris Teste 32,00 12/09/2026 CO0000000000003
Dani Teste 32,00 01/08/2026 CO0000000000009
Eva Teste 32,00 20/11/2026 CO0000000000010
linha estranha 10/10/2026 CO12`.split('\n');
const { itens, naoLidas } = lerRelatorioProfissional(rel, 'Setembro');
assert.equal(itens.length, 5); assert.equal(itens[0].valor, 32); assert.equal(itens[0].data, '2026-09-10'); assert.equal(naoLidas.length, 0);
const c = cruzar(itens, g, { hoje: '2026-11-23', prazoDias: 60 });
const sit = Object.fromEntries(c.map((l) => [l.nome.split(' ')[0], l.situacao]));
assert.deepEqual(sit, { Ana: 'pago', Beto: 'glosa_parcial', Cris: 'glosado', Dani: 'atrasado', Eva: 'aguardando' });
assert.equal(c[1].repasse, 6.4); assert.equal(c[2].repasse, 0); assert.equal(c[3].repasse, null);
const r = resumo(c, g); assert.equal(r.repasseAPagar, 38.4); assert.equal(r.repasseNaoPago, 64); assert.equal(r.guiasDeOutros, 0);
const dup = cruzar([...itens, { ...itens[0], nome: 'Ana 2' }], g); assert.ok(dup[0].avisos.length && dup[5].avisos.length);
assert.ok(csv(c).includes('Glosa parcial'));
console.log('ok conferencia-pagamento');
import { linhasDeItens } from '../../js/modulos/conferencia-pagamento.js';
const ls = linhasDeItens([{ str: '100,00', x: 300, y: 50 }, { str: 'Ana', x: 10, y: 51 }, { str: 'Topo', x: 10, y: 90 }, { str: ' ', x: 5, y: 51 }]);
assert.deepEqual(ls, ['Topo', 'Ana   100,00']);
console.log('ok linhasDeItens');
