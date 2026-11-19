// Testes da pré-checagem de autorização (js/modulos/autorizar-checagem.js). Uso: node ferramentas/testes-js/autorizar-checagem.test.mjs
// Dados 100% fictícios.
import assert from 'node:assert/strict';
import { conferirGuia, limiteDoCodigo, resumirFila } from '../../js/modulos/autorizar-checagem.js';

let n = 0; const t = (nome, fn) => { fn(); n++; console.log('ok -', nome); };
const HOJE = '2026-11-19';
const AUT = { exige: true, canal: 'portal', limites: [
  { codigo: '111', max_por_guia: 10 }, { codigo: '222', max_por_guia: 1, max_por_mes: 1, max_por_ano: 12 }, { codigo: '333', limite: '1 por ano' },
  { codigos: ['444', '555'], obs: 'validade 30 dias' }] };
const base = { qtd: 10, cid: 'M54.5', codigo: '111', validadeCarteira: '2027-01-01', enc: { arquivo: 'x.pdf', validade: '2027-02-01' }, aut: AUT };

t('tudo certo = verde', () => { const r = conferirGuia(base, HOJE); assert.equal(r.nivel, 'verde'); assert.deepEqual(r.bloqueios, []); });
t('convênio não ensinado bloqueia', () => assert.ok(conferirGuia({ ...base, aut: null }, HOJE).bloqueios.includes('Convênio ainda não ensinado ao robô')));
t('exige:false e canal diferente de portal bloqueiam', () => {
  assert.equal(conferirGuia({ ...base, aut: { ...AUT, exige: false } }, HOJE).nivel, 'vermelho');
  assert.equal(conferirGuia({ ...base, aut: { ...AUT, canal: 'email' } }, HOJE).nivel, 'vermelho'); });
t('encaminhamento ausente, sem arquivo ou vencido bloqueia', () => {
  assert.ok(conferirGuia({ ...base, enc: null }, HOJE).bloqueios.includes('Encaminhamento sem arquivo anexado'));
  assert.ok(conferirGuia({ ...base, enc: { arquivo: null } }, HOJE).bloqueios.includes('Encaminhamento sem arquivo anexado'));
  assert.ok(conferirGuia({ ...base, enc: { arquivo: 'x', validade: '2026-11-18' } }, HOJE).bloqueios.includes('Encaminhamento vencido'));
  assert.equal(conferirGuia({ ...base, enc: { arquivo: 'x', validade: HOJE } }, HOJE).nivel, 'verde'); });
t('carteirinha vencida bloqueia; sem validade não', () => {
  assert.ok(conferirGuia({ ...base, validadeCarteira: '2026-11-01' }, HOJE).bloqueios.includes('Carteirinha vencida'));
  assert.equal(conferirGuia({ ...base, validadeCarteira: null }, HOJE).nivel, 'verde'); });
t('CID vem da autorização ou do encaminhamento', () => {
  assert.ok(conferirGuia({ ...base, cid: null }, HOJE).bloqueios.includes('Sem CID'));
  assert.equal(conferirGuia({ ...base, cid: null, enc: { arquivo: 'x', cid: 'M25.5' } }, HOJE).nivel, 'verde'); });
t('limite por guia', () => assert.equal(conferirGuia({ ...base, qtd: 11 }, HOJE).nivel, 'vermelho'));
t('limite mensal e anual somam o histórico', () => {
  const g = { ...base, codigo: '222', qtd: 1 };
  assert.equal(conferirGuia(g, HOJE, []).nivel, 'verde');
  assert.match(conferirGuia(g, HOJE, [{ data: '2026-11-03', qtd: 1 }]).bloqueios[0], /limite mensal/);
  assert.equal(conferirGuia(g, HOJE, [{ data: '2026-10-03', qtd: 1 }]).nivel, 'verde');
  assert.match(conferirGuia(g, HOJE, [{ data: '2026-01-10', qtd: 12 }]).bloqueios[0], /limite anual/);
  assert.equal(conferirGuia(g, HOJE, [{ data: '2025-12-10', qtd: 12 }]).nivel, 'verde'); });
t('limite em texto e obs viram aviso amarelo', () => {
  const r = conferirGuia({ ...base, codigo: '333', qtd: 1 }, HOJE); assert.equal(r.nivel, 'amarelo'); assert.match(r.avisos[0], /1 por ano/);
  assert.equal(conferirGuia({ ...base, codigo: '555', qtd: 1 }, HOJE).avisos[0], 'validade 30 dias'); });
t('já na fila bloqueia', () => assert.ok(conferirGuia(base, HOJE, [], true).bloqueios.includes('Já está na fila do robô')));
t('limiteDoCodigo acha por codigo e por codigos', () => { assert.equal(limiteDoCodigo(AUT, '444').obs, 'validade 30 dias'); assert.equal(limiteDoCodigo(AUT, '999'), null); });
t('qtd ausente conta como 1', () => assert.equal(conferirGuia({ ...base, codigo: '222', qtd: null }, HOJE, [{ data: '2026-11-03', qtd: 1 }]).nivel, 'vermelho'));
t('resumirFila conta por nível', () => assert.deepEqual(resumirFila([{ nivel: 'verde' }, { nivel: 'verde' }, { nivel: 'vermelho' }]), { verde: 2, amarelo: 0, vermelho: 1 }));

console.log(`\n${n} testes ok`);
