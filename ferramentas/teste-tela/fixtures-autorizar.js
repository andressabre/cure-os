// Fixtures de Autorizar guias (Bloco 1 do robô): 6 autorizações pendentes cobrindo pronta, conferir e bloqueadas; 1 já na fila. Nomes e códigos fictícios.
(() => {
  const fx = window.__FIXTURES, { C, dia, iso } = window.__fx;
  const P = (n) => `00000000-0000-4000-8000-00000000000${n}`, pac = (n) => fx.tabelas.pacientes.find((p) => p.id === P(n));
  const AUT = { exige: true, canal: 'portal', limites: [{ codigo: '111', max_por_guia: 10 }, { codigo: '222', max_por_guia: 1, max_por_mes: 1 }, { codigo: '333', limite: '1 por ano' }] };
  const plano = (p, o = {}) => ({ carteirinha: `0000${p}`, validade: '2099-01-01', paciente_id: P(p), pacientes: { nome: pac(p).nome }, contratos: { nome: 'Convênio Teste', aut: AUT }, ...o });
  const enc = (o = {}) => ({ arquivo: 'enc.pdf', validade: '2099-01-01', cid: 'M54.5', ...o });
  const A = (id, p, cod, qtd, o = {}) => ({ id, clinica_id: C, status: 'pendente', paciente_plano_id: `pl-${p}`, procedimento_id: `pr-${cod}`, qtd_solicitada: qtd, qtd_autorizada: qtd,
    cid: 'M54.5', area: 'fisioterapia', solicitada_em: iso(dia(-2, 9)), encaminhamentos: enc(), procedimentos: { codigo: cod, descricao: 'Procedimento fictício' }, paciente_planos: plano(p), ...o });
  fx.tabelas.autorizacoes = [
    A('au-1', 1, '111', 10),                                                    // pronta
    A('au-2', 2, '333', 1),                                                     // confira (limite em texto)
    A('au-3', 3, '111', 12),                                                    // bloqueada: passa do limite por guia
    A('au-4', 4, '111', 10, { encaminhamentos: null }),                         // bloqueada: sem encaminhamento
    A('au-5', 1, '222', 1),                                                     // bloqueada: limite mensal (histórico abaixo)
    A('au-6', 2, '111', 10, { paciente_planos: plano(2, { contratos: { nome: 'Convênio Sem Robô', aut: null } }) }), // bloqueada: não ensinado
    A('au-7', 3, '111', 10),                                                    // já na fila
    { id: 'au-h', clinica_id: C, status: 'autorizada', paciente_plano_id: 'pl-1', procedimento_id: 'pr-222', qtd_autorizada: 1, data_autorizacao: new Date().toLocaleDateString('sv') },
  ];
  const nomeFila = (p) => ({ procedimentos: { codigo: '111' }, paciente_planos: { pacientes: { nome: pac(p).nome } } });
  fx.tabelas.fila_autorizacao_robo = [
    { id: 'fr-1', clinica_id: C, autorizacao_id: 'au-7', modo: 'conferencia', status: 'pendente', mensagem: null, criado_em: iso(dia(0, 8)), concluido_em: null, autorizacoes: nomeFila(3) },
    { id: 'fr-2', clinica_id: C, autorizacao_id: 'au-x', modo: 'envio', status: 'erro', mensagem: 'Portal pediu novo login', criado_em: iso(dia(-1, 8)), concluido_em: iso(dia(-1, 9)), autorizacoes: nomeFila(2) },
    { id: 'fr-3', clinica_id: C, autorizacao_id: 'au-y', modo: 'conferencia', status: 'autorizada', mensagem: null, criado_em: iso(dia(-3, 8)), concluido_em: iso(dia(-3, 9)), autorizacoes: nomeFila(4) },
  ];
})();
