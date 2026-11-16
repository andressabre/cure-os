// Testes dos leitores de extrato (OFX/CSV) e do motor de sugestão. Uso: node ferramentas/testes-js/extrato-banco.test.mjs
// Amostras 100% fictícias.
import assert from 'node:assert/strict';
import { lerOFX, lerCSV, lerExtrato, decodificar, numero, dataISO, sugerir, distribuir, formaPelaDescricao } from '../../js/modulos/extrato-banco.js';

let n = 0; const t = (nome, fn) => { fn(); n++; console.log('ok -', nome); };

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261110120000[-3:BRT]<LANGUAGE>POR<FI><ORG>BANCO FICTICIO</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>999<ACCTID>12345-6<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101<DTEND>20261110
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261103120000[-3:BRT]<TRNAMT>1500,00<FITID>A1<MEMO>TED RECEBIDA OPERADORA EXEMPLO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261104<TRNAMT>-89.90<FITID>A2<NAME>PAGTO BOLETO<MEMO>ENERGIA FICTICIA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261104<TRNAMT>-10.00<FITID>A2<MEMO>TARIFA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105000000<TRNAMT>200.00<FITID>A3<MEMO>PIX RECEBIDO JOS\xc9 TESTE<CHECKNUM>777</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>3600.10<DTASOF>20261110</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>888</BANKID><ACCTID>998877</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001000000[-3:BRT]</DTSTART><DTEND>20261031235959[-3:BRT]</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261015000000[-3:BRT]</DTPOSTED><TRNAMT>250.50</TRNAMT><FITID>X-1</FITID><NAME>PIX</NAME><MEMO>Pix recebido &amp; conferido</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261020</DTPOSTED><TRNAMT>-1234.56</TRNAMT><FITID>X-2</FITID><MEMO>Aluguel sala</MEMO></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-15.00</BALAMT><DTASOF>20261031</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

t('OFX SGML (1252)', () => {
  const bytes = Uint8Array.from(SGML, (c) => c.charCodeAt(0));   // grava como 1 byte por caractere (É = 0xC9 em 1252)
  const r = lerOFX(decodificar(bytes));
  assert.equal(r.banco, '999'); assert.equal(r.conta, '12345-6'); assert.equal(r.moeda, 'BRL');
  assert.equal(r.inicio, '2026-11-01'); assert.equal(r.fim, '2026-11-10'); assert.equal(r.saldo, 3600.1); assert.equal(r.saldo_data, '2026-11-10');
  assert.equal(r.movimentos.length, 4);
  assert.deepEqual(r.movimentos.map((m) => m.valor), [1500, -89.9, -10, 200]);
  assert.equal(r.movimentos[0].data, '2026-11-03');
  assert.deepEqual(r.movimentos.map((m) => m.id_banco), ['A1', 'A2', 'A2#2', 'A3']);
  assert.equal(r.movimentos[1].descricao, 'PAGTO BOLETO · ENERGIA FICTICIA');
  assert.equal(r.movimentos[3].descricao, 'PIX RECEBIDO JOSÉ TESTE'); assert.equal(r.movimentos[3].documento, '777');
  assert.deepEqual(lerOFX(decodificar(bytes)).movimentos.map((m) => m.id_banco), r.movimentos.map((m) => m.id_banco), 'estável');
});

t('OFX 2 XML', () => {
  const r = lerExtrato(decodificar(new TextEncoder().encode(XML)));
  assert.equal(r.conta, '998877'); assert.equal(r.inicio, '2026-10-01'); assert.equal(r.fim, '2026-10-31'); assert.equal(r.saldo, -15);
  assert.deepEqual(r.movimentos.map((m) => [m.data, m.valor, m.id_banco]), [['2026-10-15', 250.5, 'X-1'], ['2026-10-20', -1234.56, 'X-2']]);
  assert.equal(r.movimentos[0].descricao, 'Pix recebido & conferido', 'NAME contido no MEMO não se repete');
});

t('UTF-8 inválido cai em windows-1252', () => {
  assert.equal(decodificar(Uint8Array.from([0x41, 0xe7, 0xe3, 0x6f])), 'Ação');
  assert.equal(decodificar(new TextEncoder().encode('Ação')), 'Ação');
});

t('números e datas', () => {
  assert.equal(numero('1.234,56'), 1234.56); assert.equal(numero('1,234.56'), 1234.56); assert.equal(numero('-12,3'), -12.3);
  assert.equal(numero('R$ 1.000'), 1000); assert.equal(numero('(50,00)'), -50); assert.equal(numero('80,00 D'), -80); assert.equal(numero('80,00-'), -80);
  assert.equal(numero('abc'), null);
  assert.equal(dataISO('05/11/2026'), '2026-11-05'); assert.equal(dataISO('2026-11-05'), '2026-11-05'); assert.equal(dataISO('05/11/26'), '2026-11-05');
  assert.equal(dataISO('31/02/2026'), null); assert.equal(dataISO('20261105093000[-3:BRT]'), '2026-11-05');
});

// CSV 1: ponto e vírgula, preâmbulo, valor único com sinal BR, linhas de saldo
const CSV1 = `Extrato de conta corrente
Agência;0001;Conta;99999-0

Data;Histórico;Documento;Valor;Saldo
01/11/2026;SALDO ANTERIOR;;;1.000,00
03/11/2026;PIX RECEBIDO FULANO TESTE;123;150,00;1.150,00
03/11/2026;PIX RECEBIDO FULANO TESTE;124;150,00;1.300,00
04/11/2026;PAGAMENTO BOLETO;;-1.234,56;65,44
04/11/2026;SALDO DO DIA;;;65,44`;
t('CSV ; com preâmbulo e sinal', () => {
  const r = lerCSV(CSV1);
  assert.ok(!r.erro, r.erro);
  assert.equal(r.separador, ';');
  assert.deepEqual(r.movimentos.map((m) => [m.data, m.valor]), [['2026-11-03', 150], ['2026-11-03', 150], ['2026-11-04', -1234.56]]);
  assert.notEqual(r.movimentos[0].id_banco, r.movimentos[1].id_banco, 'iguais ganham ordem');
  assert.equal(r.movimentos[0].documento, '123');
  assert.deepEqual(lerCSV(CSV1).movimentos.map((m) => m.id_banco), r.movimentos.map((m) => m.id_banco));
  assert.equal(r.inicio, '2026-11-03'); assert.equal(r.fim, '2026-11-04');
});

// CSV 2: vírgula, ISO, crédito/débito separados, número americano com aspas
const CSV2 = `"Date","Description","Credit","Debit"
"2026-11-02","Card settlement","1,250.00",""
"2026-11-06","Rent","","2,000.00"
"2026-11-07","Fee","","3.50"`;
t('CSV , crédito/débito americano', () => {
  const r = lerCSV(CSV2);
  assert.ok(!r.erro, r.erro); assert.equal(r.separador, ',');
  assert.deepEqual(r.movimentos.map((m) => m.valor), [1250, -2000, -3.5]);
});

// CSV 3: tabulação, colunas Lançamento / Valor (R$) + Tipo D/C
const CSV3 = 'Data Lançamento\tDescrição\tValor (R$)\tTipo\n10/11/2026\tTRANSF RECEBIDA\t300,00\tC\n11/11/2026\tTARIFA PACOTE\t25,90\tD\n';
t('CSV tab com natureza D/C', () => {
  const r = lerCSV(CSV3);
  assert.ok(!r.erro, r.erro); assert.equal(r.separador, '\t');
  assert.deepEqual(r.movimentos.map((m) => [m.descricao, m.valor]), [['TRANSF RECEBIDA', 300], ['TARIFA PACOTE', -25.9]]);
});

t('CSV sem colunas reconhecíveis → mapeamento manual', () => {
  const txt = 'a;b;c\nx;y;z\nk;w;q';
  const r = lerCSV(txt);
  assert.ok(r.erro); assert.deepEqual(r.cabecalho, ['a', 'b', 'c']); assert.ok(r.amostra.length);
  const txt2 = 'quando;oque;quanto\n05/11/2026;Coisa;10,00\n06/11/2026;Outra;-2,00';
  const r2 = lerCSV(txt2);
  assert.ok(!r2.erro, 'cabeçalho desconhecido, mas colunas inferidas pelo conteúdo'); assert.equal(r2.linhaCabecalho, 0);
  const m = lerCSV('a;b;c\nCoisa;05/11/2026;10,00\nOutra;06/11/2026;-2,00', { linhaCabecalho: 0, mapa: { data: 1, descricao: 0, valor: 2 } });
  assert.ok(!m.erro, m.erro); assert.deepEqual(m.movimentos.map((x) => x.valor), [10, -2]);
});

// ---------------- sugerir
const L = (id, tipo, valor, venc, extra = {}) => ({ id, tipo, status: 'previsto', valor_previsto: valor, vencimento: venc, descricao: id, ...extra });
const abertos = [
  L('rec-igual', 'receber', 150, '2026-11-04', { fornecedor: 'Fulano Teste' }),
  L('rec-longe', 'receber', 150, '2027-01-10'),
  L('lote', 'receber', 1000, '2026-11-01', { lote_id: 'lt-1', fornecedor: 'Operadora Exemplo' }),
  L('pag', 'pagar', 89.9, '2026-11-20'),
  L('pago', 'receber', 150, '2026-11-03', { status: 'pago' }),
];
t('sugerir: certo, provável, glosa, tipo', () => {
  const c = sugerir({ data: '2026-11-03', valor: 150, descricao: 'PIX RECEBIDO FULANO TESTE' }, abertos);
  assert.equal(c[0].lancamento_id, 'rec-igual'); assert.equal(c[0].nivel, 'certo'); assert.match(c[0].motivo, /Fulano Teste/);
  assert.equal(c.find((x) => x.lancamento_id === 'rec-longe'), undefined, '> 45 dias fica de fora');
  assert.ok(!c.some((x) => x.lancamento_id === 'pago' || x.lancamento_id === 'pag'));
  const g = sugerir({ data: '2026-11-12', valor: 820, descricao: 'TED OPERADORA EXEMPLO' }, abertos);
  assert.equal(g[0].lancamento_id, 'lote'); assert.equal(g[0].nivel, 'provavel'); assert.match(g[0].motivo, /glosa de R\$ 180,00/); assert.equal(g[0].diferenca, -180);
  assert.equal(sugerir({ data: '2026-11-12', valor: 600, descricao: '' }, abertos).length, 0, 'glosa > 30% não sugere');
  const d = sugerir({ data: '2026-11-04', valor: -89.9, descricao: 'BOLETO' }, abertos);
  assert.equal(d[0].lancamento_id, 'pag'); assert.equal(d[0].nivel, 'provavel'); // 16 dias
  assert.equal(sugerir({ data: '2026-11-04', valor: 820, descricao: '' }, [L('semlote', 'receber', 1000, '2026-11-04')]).length, 0, 'glosa só com lote');
});
t('distribuir: certo único e empates → escolher', () => {
  const movs = [{ id: 'm1', data: '2026-11-04', valor: 150, descricao: 'PIX' }, { id: 'm2', data: '2026-11-04', valor: 150, descricao: 'PIX' }];
  const r = distribuir(movs, [L('x', 'receber', 150, '2026-11-04')]);
  assert.equal(r.get('m1').situacao, 'escolher'); assert.equal(r.get('m2').situacao, 'escolher');
  const r2 = distribuir([{ id: 'm1', data: '2026-11-04', valor: 150, descricao: '' }, { id: 'm2', data: '2026-11-07', valor: 150, descricao: '' }], [L('x', 'receber', 150, '2026-11-04')]);
  assert.equal(r2.get('m1').situacao, 'certo'); assert.equal(r2.get('m2').situacao, 'provavel');
  const r3 = distribuir([{ id: 'm1', data: '2026-11-04', valor: 150, descricao: '' }], [L('a', 'receber', 150, '2026-11-04'), L('b', 'receber', 150, '2026-11-04')]);
  assert.equal(r3.get('m1').situacao, 'escolher');
  const r4 = distribuir([{ id: 'm1', data: '2026-11-04', valor: 9, descricao: '' }], abertos);
  assert.equal(r4.get('m1').situacao, 'nenhum');
});
t('forma pela descrição', () => { assert.equal(formaPelaDescricao('Pix recebido'), 'pix'); assert.equal(formaPelaDescricao('xyz'), null); });

console.log(`\n${n} testes ok`);
