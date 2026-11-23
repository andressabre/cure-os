// Sessão combinada (db/069): 2 atendimentos no mesmo horário ligados por combo_id + RPC de autorizações da paciente. Dados fictícios.
(() => {
  const fx = window.__FIXTURES, { dia, iso } = window.__fx, T = fx.tabelas;
  const P = '00000000-0000-4000-8000-000000000001';
  T.atendimentos = T.atendimentos.filter((a) => a.paciente_id !== P);
  const base = { clinica_id: 'clin-1', paciente_id: P, profissional_id: 'prof-2', inicio: iso(dia(0, 15)), fim: iso(dia(0, 15, 45)), status: 'agendado', servico: 'Nutrição', sala: 'Consultório',
    paciente_plano_id: 'cb-pl', observacao: null, serie_id: null, lembrete_enviado_em: null, combo_id: 'cb-combo',
    pacientes: { id: P, nome: 'Carla Teste', celular: '5547999900000', alerta: null } };
  T.atendimentos.push({ ...base, id: 'cb-a1', autorizacao_id: 'cb-au1' }, { ...base, id: 'cb-a2', autorizacao_id: 'cb-au2' });
  T.autorizacoes.push({ id: 'cb-au1', procedimentos: { descricao: 'Consulta ambulatorial' } }, { id: 'cb-au2', procedimentos: { descricao: 'Bioimpedância' } });
  const au = (id, cod, proc) => ({ id, status: 'autorizada', senha: '555', codigo: cod, procedimento_id: proc, qtd: 1, usadas: 0, agendadas: 0, validade: null, area: 'nutricao', solicitante_id: null, encaminhamento_id: null });
  fx.rpc.autorizacoes_paciente = [{ id: 'cb-pl', contrato: 'Convênio Teste', carteirinha: '123', exige: true, senha_por_sessao: false,
    autorizacoes: [au('cb-au3', '50000560', 'p1'), au('cb-au4', '41301048', 'p2')],
    procedimentos: [{ id: 'p1', codigo: '50000560', descricao: 'Consulta ambulatorial' }, { id: 'p2', codigo: '41301048', descricao: 'Bioimpedância' }] }];
})();
