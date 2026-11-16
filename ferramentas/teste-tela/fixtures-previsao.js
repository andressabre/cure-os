// Cenário fictício para a Previsão de caixa (js/modulos/previsao.js). Valores inventados (repositório público).
// Rota com "vazio" no hash (ex.: rodar.mjs previsao-vazio …) = estado da produção hoje: sem contas nem lançamentos.
(() => {
  // CSS do módulo ainda não está no index.html: injeta aqui
  document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'css/previsao.css' })));
  if (/vazio/.test(location.hash)) return;
  const fx = window.__FIXTURES, { C, dt } = window.__fx, T = fx.tabelas;
  T.carteiras.push({ id: 'cart-p', clinica_id: C, nome: 'Pessoal (sócio)', tipo: 'pessoal', ordem: 2, ativo: true });
  T.contas_financeiras = [
    { id: 'cf-1', clinica_id: C, carteira_id: 'cart-1', nome: 'Banco PJ', tipo: 'banco', saldo_inicial: 9000, data_saldo_inicial: dt(-60), ativo: true },
    { id: 'cf-2', clinica_id: C, carteira_id: 'cart-1', nome: 'Caixa físico', tipo: 'caixa', saldo_inicial: 300.5, data_saldo_inicial: dt(-60), ativo: true },
    { id: 'cf-p', clinica_id: C, carteira_id: 'cart-p', nome: 'Conta pessoal', tipo: 'banco', saldo_inicial: 99999, data_saldo_inicial: dt(-60), ativo: true },
  ];
  T.categorias_financeiras = [
    ['cat-conv', 'receber', 'Convênios'], ['cat-part', 'receber', 'Particular'], ['cat-alug', 'pagar', 'Aluguel'], ['cat-sal', 'pagar', 'Salários'],
    ['cat-imp', 'pagar', 'Impostos'], ['cat-ene', 'pagar', 'Energia'], ['cat-rep', 'pagar', 'Repasse profissionais'], ['cat-mat', 'pagar', 'Material'],
  ].map(([id, tipo, nome], i) => ({ id, clinica_id: C, tipo, nome, grupo_dre: tipo === 'receber' ? 'receita_bruta' : 'despesa_operacional', ordem: i, ativo: true, uso: 'empresa' }));
  let n = 0;
  const L = (tipo, descricao, cat, venc, valor, extra = {}) => ({ id: `lf-${++n}`, clinica_id: C, carteira_id: 'cart-1', tipo, descricao, categoria_id: cat,
    competencia: venc.slice(0, 8) + '01', vencimento: venc, valor_previsto: valor, status: 'previsto', valor_realizado: null, data_realizado: null, conta_id: null,
    origem: 'manual', lote_id: null, contrato_id: null, recorrencia: null, valor_confirmado: false, ...extra });
  const pago = (tipo, d, cat, dia, valor, conta = 'cf-1') => L(tipo, d, cat, dt(dia), valor, { status: 'pago', valor_realizado: valor, data_realizado: dt(dia), conta_id: conta, valor_confirmado: true });
  const ls = [
    // realizados (formam o saldo de hoje)
    pago('receber', 'Particulares da semana', 'cat-part', -50, 2400.1), pago('receber', 'Particulares da semana', 'cat-part', -43, 1980), pago('receber', 'Particulares da semana', 'cat-part', -36, 2150.45),
    pago('receber', 'Particulares da semana', 'cat-part', -29, 2210), pago('receber', 'Particulares da semana', 'cat-part', -22, 1890.3), pago('receber', 'Particulares da semana', 'cat-part', -15, 2305),
    pago('receber', 'Particulares da semana', 'cat-part', -8, 2050), pago('receber', 'Particulares em dinheiro', 'cat-part', -3, 420, 'cf-2'),
    pago('pagar', 'Aluguel da sala', 'cat-alug', -46, 3200), pago('pagar', 'Aluguel da sala', 'cat-alug', -16, 3200), pago('pagar', 'Salários', 'cat-sal', -40, 4100),
    pago('pagar', 'Salários', 'cat-sal', -10, 4100), pago('pagar', 'Energia elétrica', 'cat-ene', -35, 512.37), pago('pagar', 'Energia elétrica', 'cat-ene', -5, 488.91),
    pago('pagar', 'Material de consumo', 'cat-mat', -12, 263.4, 'cf-2'), { ...pago('receber', 'Lote 0007 – Convênio Teste', 'cat-conv', -20, 3100, 'cf-1'), origem: 'lote', lote_id: 'lt-7', contrato_id: 'ct-1' },
    L('pagar', 'Baixa sem conta (não entra)', 'cat-mat', dt(-7), 100, { status: 'pago', valor_realizado: 100, data_realizado: dt(-7) }),
    L('pagar', 'Cancelado (não entra)', 'cat-mat', dt(4), 5000, { status: 'cancelado' }),
    // previstos
    L('pagar', 'Conta vencida não baixada', 'cat-mat', dt(-4), 350), L('receber', 'Particular parcelado vencido', 'cat-part', dt(-2), 600),
    L('pagar', 'Aluguel da sala', 'cat-alug', dt(14), 3200, { recorrencia: 'fixa', valor_confirmado: true }), L('pagar', 'Aluguel da sala', 'cat-alug', dt(44), 3200, { recorrencia: 'fixa' }),
    L('pagar', 'Aluguel da sala', 'cat-alug', dt(74), 3200, { recorrencia: 'fixa' }),
    L('pagar', 'Salários', 'cat-sal', dt(20), 4100, { recorrencia: 'fixa' }), L('pagar', 'Salários', 'cat-sal', dt(50), 4100, { recorrencia: 'fixa' }), L('pagar', 'Salários', 'cat-sal', dt(80), 4100, { recorrencia: 'fixa' }),
    L('pagar', 'Repasse profissionais', 'cat-rep', dt(9), 5600, { origem: 'repasse' }), L('pagar', 'Repasse profissionais', 'cat-rep', dt(39), 5400, { origem: 'repasse' }),
    L('pagar', 'Impostos (DAS)', 'cat-imp', dt(5), 1350.6), L('pagar', 'Impostos (DAS)', 'cat-imp', dt(35), 1420.15), L('pagar', 'Impostos (DAS)', 'cat-imp', dt(65), 1390),
    L('pagar', 'Energia elétrica', 'cat-ene', dt(25), 500.64, { recorrencia: 'media', media_meses: 3 }), L('pagar', 'Energia elétrica', 'cat-ene', dt(55), 500.64, { recorrencia: 'media', media_meses: 3 }),
    L('pagar', 'Energia elétrica', 'cat-ene', dt(85), 500.64, { recorrencia: 'media', media_meses: 3 }),
    L('pagar', 'Equipamento – parcela única', 'cat-mat', dt(18), 9000),
    L('receber', 'Particulares previstos', 'cat-part', dt(6), 1800), L('receber', 'Particulares previstos', 'cat-part', dt(13), 1800), L('receber', 'Particulares previstos', 'cat-part', dt(27), 1800),
    L('receber', 'Particulares previstos', 'cat-part', dt(41), 1800), L('receber', 'Particulares previstos', 'cat-part', dt(62), 1800),
    L('receber', 'Lote 0008 – Convênio Teste', 'cat-conv', dt(-10), 4200, { origem: 'lote', lote_id: 'lt-8', contrato_id: 'ct-1', fornecedor: 'Convênio Teste' }),
    L('receber', 'Lote 0009 – Convênio Teste', 'cat-conv', dt(22), 6350.8, { origem: 'lote', lote_id: 'lt-9', contrato_id: 'ct-1', fornecedor: 'Convênio Teste' }),
    L('receber', 'Lote 0012 – Plano Exemplo', 'cat-conv', dt(33), 2780, { origem: 'lote', lote_id: 'lt-12', contrato_id: 'ct-2', fornecedor: 'Plano Exemplo' }),
    // carteira pessoal: nunca entra
    { ...L('pagar', 'Gasto pessoal (não entra)', null, dt(3), 88888), carteira_id: 'cart-p' },
  ];
  T.lancamentos = ls;
  T.contratos.push({ id: 'ct-2', clinica_id: C, nome: 'Plano Exemplo', ativo: true, regras: {}, operadora_id: 'op-2', operadoras: { nome: 'Operadora Exemplo' } });
  const ct = (id) => (id === 'ct-1' ? { nome: 'Convênio Teste', operadoras: { nome: 'Operadora Teste' } } : { nome: 'Plano Exemplo', operadoras: { nome: 'Operadora Exemplo' } });
  const lote = (id, num, c, envio, prev, valor, status = 'enviado') => ({ id, clinica_id: C, contrato_id: c, numero_lote: num, competencia: dt(envio - 20).slice(0, 8) + '01',
    status, data_envio: dt(envio), previsto_pagamento: prev == null ? null : dt(prev), valor_total: valor, contratos: ct(c) });
  T.lotes = [
    lote('lt-7', '0007', 'ct-1', -50, -20, 3100, 'retornado'),        // pago: não aparece
    lote('lt-8', '0008', 'ct-1', -40, -10, 4200, 'retornado'),        // atrasado
    lote('lt-9', '0009', 'ct-1', -8, 22, 6350.8),
    lote('lt-12', '0012', 'ct-2', -3, 33, 2780, 'protocolado'),
    lote('lt-13', '0013', 'ct-2', -1, null, 1500, 'protocolado'),     // sem lançamento e sem previsão
  ];
  T.retorno_linhas = [
    { id: 'rl-1', clinica_id: C, classe: 'da_clinica', valor_informado: 3100, valor_glosa: 248 },
    { id: 'rl-2', clinica_id: C, classe: 'da_clinica', valor_informado: 1900, valor_glosa: 152 },
    { id: 'rl-3', clinica_id: C, classe: 'outra_clinica', valor_informado: 9000, valor_glosa: 9000 },
  ];
})();
