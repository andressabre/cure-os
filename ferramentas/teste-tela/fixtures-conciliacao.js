// Fixtures fictícias da conciliação bancária (js/modulos/conciliacao.js). Nenhum dado real.
// Rota com "vazio" (ex.: conciliacao-vazio) = produção de hoje: sem conta cadastrada.
(() => {
  const fx = window.__FIXTURES, { C, dt } = window.__fx;
  if (location.hash.includes('vazio')) return;
  const T = fx.tabelas;
  T.contas_financeiras.push({ id: 'cc-1', clinica_id: C, carteira_id: 'cart-1', nome: 'Conta PJ Teste', tipo: 'banco', banco: 'Banco Fictício', agencia: '0001', conta: '12345', saldo_inicial: 1000, data_saldo_inicial: dt(-60), ativo: true },
    { id: 'cc-2', clinica_id: C, carteira_id: 'cart-1', nome: 'Caixa físico', tipo: 'caixa', saldo_inicial: 0, data_saldo_inicial: dt(-60), ativo: true });
  T.categorias_financeiras.push({ id: 'cat-r', clinica_id: C, tipo: 'receita', grupo_dre: 'receita_bruta', nome: 'Convênios', ordem: 1, ativo: true, uso: 'empresa' },
    { id: 'cat-d', clinica_id: C, tipo: 'despesa', grupo_dre: 'deducoes', nome: 'Tarifas bancárias', ordem: 2, ativo: true, uso: 'empresa' });
  const L = (id, tipo, valor, venc, extra = {}) => ({ id, clinica_id: C, carteira_id: 'cart-1', tipo, descricao: extra.descricao || id, categoria_id: null, conta_id: null, area: 'geral',
    competencia: venc.slice(0, 7) + '-01', vencimento: venc, valor_previsto: valor, status: 'previsto', valor_realizado: null, data_realizado: null, forma_pagamento: null,
    fornecedor: null, lote_id: null, origem: 'manual', valor_confirmado: false, ...extra });
  T.lancamentos.push(
    L('lan-1', 'receber', 150, dt(-2), { descricao: 'Consulta particular – Paciente Exemplo', fornecedor: 'Fulano Teste', origem: 'particular' }),
    L('lan-2', 'receber', 1000, dt(-10), { descricao: 'Lote 0001 – Convênio Teste', fornecedor: 'Convênio Teste', lote_id: 'lote-1', origem: 'lote' }),
    L('lan-3', 'pagar', 89.9, dt(-1), { descricao: 'Energia elétrica', fornecedor: 'Energia Fictícia' }),
    L('lan-4', 'pagar', 400, dt(5), { descricao: 'Aluguel da sala' }),
    L('lan-5', 'receber', 300, dt(-20), { descricao: 'Pacote fisioterapia', status: 'pago', valor_realizado: 300, data_realizado: dt(-19), conta_id: 'cc-1', forma_pagamento: 'pix', valor_confirmado: true }),
    { ...L('lan-6', 'pagar', 3600, dt(3), { descricao: 'Casa – aluguel' }), carteira_id: 'cart-pessoal' });
  const M = (id, dias, valor, descricao, extra = {}) => ({ id, clinica_id: C, conta_id: 'cc-1', data: dt(dias), valor, descricao, documento: null, id_banco: 'F' + id,
    situacao: 'pendente', lancamento_id: null, baixa_anterior: null, lancamento_criado: false, importado_em: new Date().toISOString(), arquivo: 'extrato-teste.ofx', ...extra });
  T.extrato_movimentos = [
    M('mov-1', -1, 150, 'PIX RECEBIDO FULANO TESTE'),
    M('mov-2', -3, 820, 'TED CONVENIO TESTE REPASSE', { documento: '4455' }),
    M('mov-3', -1, -89.9, 'PAGTO BOLETO ENERGIA FICTICIA'),
    M('mov-4', -1, -12.5, 'TARIFA PACOTE SERVICOS'),
    M('mov-5', -19, 300, 'PIX RECEBIDO CICLANO EXEMPLO', { situacao: 'conciliado', lancamento_id: 'lan-5',
      baixa_anterior: { status: 'previsto', valor_realizado: null, data_realizado: null, conta_id: null, forma_pagamento: null, valor_confirmado: false } }),
    M('mov-6', -5, -500, 'TRANSF ENTRE CONTAS', { situacao: 'ignorado' }),
  ];
})();
