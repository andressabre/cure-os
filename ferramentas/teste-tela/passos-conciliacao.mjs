// Passos da conciliação bancária (js/modulos/conciliacao.js) sobre fixtures-conciliacao.js. Dados fictícios.
// node ferramentas/teste-tela/rodar.mjs x --modulo js/modulos/conciliacao.js \
//   --fixtures ferramentas/teste-tela/fixtures-conciliacao.js --script ferramentas/teste-tela/passos-conciliacao.mjs
// Cada passo confere o que a tela GRAVOU (window.__ESCRITAS); falha entra em `erros` e o rodar.mjs sai com código 1.
const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261116<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>999<ACCTID>12345<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261110<DTEND>20261116
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261115<TRNAMT>200.00<FITID>Fmov-1<MEMO>PIX RECEBIDO TESTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261116<TRNAMT>-45.00<FITID>NOVO1<MEMO>TARIFA TESTE</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1234.56<DTASOF>20261116</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`;

export default async (pg, { erros }) => {
  const falha = (m) => erros.push('PASSO: ' + m);
  const esperar = (ms = 500) => pg.waitForTimeout(ms);
  const texto = () => pg.$eval('#conteudo', (c) => c.innerText);
  const escritas = () => pg.evaluate(() => window.__ESCRITAS || []);
  const novas = async (antes) => (await escritas()).slice(antes);
  const kpi = async (rotulo) => (await pg.$$eval('.kpi', (ks, r) => ks.find((k) => k.querySelector('.rotulo')?.textContent.trim() === r)?.querySelector('.valor')?.textContent.trim() ?? null, rotulo));
  const clicar = async (seletor) => { await pg.click(seletor); await esperar(); };

  // 1. conta com extrato → pendentes
  await pg.selectOption('#cc-conta', 'cc-1'); await esperar();
  if ((await kpi('Pendentes')) !== '4') falha(`esperava 4 pendentes, veio ${await kpi('Pendentes')}`);
  if ((await kpi('Conciliados')) !== '1') falha(`esperava 1 conciliado, veio ${await kpi('Conciliados')}`);
  if ((await kpi('Ignorados')) !== '1') falha(`esperava 1 ignorado, veio ${await kpi('Ignorados')}`);
  if (!/PIX RECEBIDO FULANO TESTE/.test(await texto())) falha('movimento 1 não apareceu na lista de pendentes');

  // 2. Ignorar: grava só no extrato, sem tocar em lançamento
  let n = (await escritas()).length;
  await clicar('[data-ignorar="mov-4"]');
  let w = await novas(n);
  if (w.length !== 1 || w[0].tabela !== 'extrato_movimentos' || w[0].valores?.situacao !== 'ignorado') falha('Ignorar deveria gravar 1 update de situacao=ignorado em extrato_movimentos: ' + JSON.stringify(w));
  if ((await kpi('Pendentes')) !== '3') falha('após ignorar, pendentes deveria ser 3');

  // 3. Confirmar com diferença (banco 820 × previsto 1000): pede confirmação e, se cancelar, NÃO baixa
  if (await pg.$('[data-confirmar="mov-2"]')) {
    n = (await escritas()).length;
    await clicar('[data-confirmar="mov-2"]');
    const modal = await pg.$eval('#modal-caixa', (c) => c.innerText).catch(() => '');
    if (!/diferen/i.test(modal)) falha('confirmar com diferença deveria abrir aviso de diferença; modal: ' + modal.slice(0, 120));
    await clicar('#modal-caixa [data-fechar]');
    if ((await novas(n)).length) falha('cancelar o aviso de diferença não pode gravar nada');
  } else falha('mov-2 deveria ter sugestão com botão Confirmar');

  // 4. Confirmar valor igual: baixa o lançamento (pago, valor/data do banco, conta) e marca o movimento
  if (await pg.$('[data-confirmar="mov-3"]')) {
    n = (await escritas()).length;
    await clicar('[data-confirmar="mov-3"]');
    if (await pg.$('#modal-caixa #ok')) await clicar('#modal-caixa #ok');   // se pediu confirmação, aceita
    w = await novas(n);
    const lan = w.find((x) => x.tabela === 'lancamentos' && x.op === 'update'), mov = w.find((x) => x.tabela === 'extrato_movimentos' && x.op === 'update');
    if (!lan || lan.valores.status !== 'pago' || lan.valores.valor_realizado !== 89.9 || lan.valores.conta_id !== 'cc-1' || lan.valores.valor_confirmado !== true) falha('baixa do lançamento errada: ' + JSON.stringify(lan));
    if (!mov || mov.valores.situacao !== 'conciliado' || mov.valores.lancamento_id !== 'lan-3' || mov.valores.lancamento_criado !== false || !mov.valores.baixa_anterior || mov.valores.baixa_anterior.status !== 'previsto')
      falha('movimento deveria ficar conciliado com lan-3 e guardar baixa_anterior: ' + JSON.stringify(mov));
  } else falha('mov-3 deveria ter sugestão com botão Confirmar');

  // 5. Criar lançamento: nasce pago, origem 'extrato', mesma carteira; movimento conciliado com lancamento_criado
  if (await pg.$('[data-criar="mov-1"]')) {
    n = (await escritas()).length;
    await clicar('[data-criar="mov-1"]');
    await clicar('#cc-salvar');
    w = await novas(n);
    const ins = w.find((x) => x.tabela === 'lancamentos' && x.op === 'insert');
    const v = Array.isArray(ins?.valores) ? ins.valores[0] : ins?.valores;
    if (!v || v.origem !== 'extrato' || v.status !== 'pago' || v.tipo !== 'receber' || v.valor_realizado !== 150 || v.conta_id !== 'cc-1' || v.carteira_id !== 'cart-1') falha('lançamento criado errado: ' + JSON.stringify(v));
    if (!w.some((x) => x.tabela === 'extrato_movimentos' && x.op === 'update' && x.valores?.lancamento_criado === true && x.valores?.situacao === 'conciliado')) falha('movimento deveria ficar conciliado com lancamento_criado=true');
  } else falha('mov-1 deveria estar pendente com botão Criar lançamento');

  // 6. Desfazer conciliação de lançamento que existia: volta ao estado anterior (previsto)
  await clicar('[data-filtro="conciliado"]');
  if (await pg.$('[data-desfazer="mov-5"]')) {
    n = (await escritas()).length;
    await clicar('[data-desfazer="mov-5"]');
    await clicar('#modal-caixa #ok');
    w = await novas(n);
    const lan = w.find((x) => x.tabela === 'lancamentos' && x.op === 'update');
    if (!lan || lan.valores.status !== 'previsto' || lan.valores.data_realizado !== null || lan.valores.conta_id !== null) falha('desfazer deveria devolver lan-5 a previsto: ' + JSON.stringify(lan));
    if (!w.some((x) => x.tabela === 'extrato_movimentos' && x.valores?.situacao === 'pendente' && x.valores?.lancamento_id === null)) falha('desfazer deveria voltar o movimento a pendente');
  } else falha('mov-5 conciliado deveria ter botão Desfazer');

  // 7. Importar OFX: 1 movimento já existe (FITID Fmov-1) → só 1 novo entra; nada é baixado
  await clicar('[data-filtro="pendente"]');
  n = (await escritas()).length;
  await pg.setInputFiles('#cc-arquivo', { name: 'teste.ofx', mimeType: 'application/octet-stream', buffer: Buffer.from(OFX, 'latin1') });
  await esperar(900);
  const prev = await pg.$eval('#modal-caixa', (c) => c.innerText).catch(() => '');
  if (!/Prévia do extrato/.test(prev) || !/Importar 1 novo/.test(prev)) falha('prévia deveria oferecer "Importar 1 novo(s)" (dedupe do FITID): ' + prev.slice(0, 300));
  if (await pg.$('#cc-gravar:not([disabled])')) {
    await clicar('#cc-gravar');
    w = await novas(n);
    const ins = w.filter((x) => x.tabela === 'extrato_movimentos' && x.op === 'insert');
    const linhas = ins.flatMap((x) => (Array.isArray(x.valores) ? x.valores : [x.valores]));
    if (linhas.length !== 1 || linhas[0].id_banco !== 'NOVO1' || linhas[0].valor !== -45 || linhas[0].conta_id !== 'cc-1') falha('importação deveria inserir só NOVO1 (−45) na conta cc-1: ' + JSON.stringify(linhas));
    if (w.some((x) => x.tabela === 'lancamentos')) falha('importar não pode mexer em lançamentos');
  } else falha('botão de importar desabilitado');
};
