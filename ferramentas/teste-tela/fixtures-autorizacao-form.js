// Fixtures do formulário de autorização (vários procedimentos por guia). Dados fictícios. Paciente ...0001.
(() => {
  const fx = window.__FIXTURES, { dt } = window.__fx, T = fx.tabelas;
  const P1 = '00000000-0000-4000-8000-000000000001';
  const ct = { nome: 'Convênio Teste', regras: {} };
  T.paciente_planos.push({ id: 'af-pl', paciente_id: P1, contrato_id: 'af-ct', contratos: ct });
  T.procedimentos.push({ id: 'af-p1', codigo: '50000560', descricao: 'Consulta ambulatorial' }, { id: 'af-p2', codigo: '40801047', descricao: 'Bioimpedância' });
  (T.contrato_tabela ||= []).push({ contrato_id: 'af-ct', procedimento_id: 'af-p1', vigencia_fim: null, valor: 100, procedimentos: { id: 'af-p1', codigo: '50000560', descricao: 'Consulta ambulatorial' } },
    { contrato_id: 'af-ct', procedimento_id: 'af-p2', vigencia_fim: null, valor: 80, procedimentos: { id: 'af-p2', codigo: '40801047', descricao: 'Bioimpedância' } });
  T.autorizacoes.push({ id: 'af-a1', paciente_plano_id: 'af-pl', procedimento_id: 'af-p1', procedimentos: { codigo: '50000560', descricao: 'Consulta ambulatorial' }, status: 'autorizada', senha: '0',
    numero_guia_operadora: '248356250', data_autorizacao: dt(0), validade: dt(30), area: 'nutricao', qtd_autorizada: 1, qtd_solicitada: 1, cid: 'E66', solicitada_em: dt(0),
    paciente_planos: { paciente_id: P1, contratos: ct } });
})();
