// Fixtures da linha do tempo. Dados fictícios. Paciente ...0001 = rico (mais de 50 eventos); ...0004 = sem histórico.
(() => {
  const fx = window.__FIXTURES, { dia, iso, dt } = window.__fx, T = fx.tabelas;
  const P1 = '00000000-0000-4000-8000-000000000001', P4 = '00000000-0000-4000-8000-000000000004';
  T.atendimentos = T.atendimentos.filter((a) => ![P1, P4].includes(a.paciente_id));
  const st = ['atendido', 'atendido', 'atendido', 'faltou', 'cancelado'];
  for (let i = 0; i < 60; i++) T.atendimentos.push({ id: 'lt-at-' + i, paciente_id: P1, inicio: iso(dia(-3 - i * 4, 9 + (i % 6))), status: st[i % 5],
    servico: i % 2 ? 'Nutrição' : 'Fisioterapia', sala: 'Sala 1', profissionais: { nome: i % 2 ? 'Bia Nutri' : 'Ana Fisio' } });
  T.atendimentos.push({ id: 'lt-f1', paciente_id: P1, inicio: iso(dia(2, 10)), status: 'agendado', servico: 'Fisioterapia', sala: 'Sala 1', profissionais: { nome: 'Ana Fisio' } },
    { id: 'lt-f2', paciente_id: P1, inicio: iso(dia(5, 15)), status: 'confirmado', servico: 'Nutrição', sala: 'Consultório', profissionais: { nome: 'Bia Nutri' } });
  T.paciente_planos.push({ id: 'lt-pl', paciente_id: P1, contratos: { nome: 'Convênio Teste' } });
  const aut = (id, o) => ({ id, status: 'autorizada', senha: '123456', data_autorizacao: dt(-20), validade: dt(60), solicitada_em: iso(dia(-22)), area: 'fisioterapia', qtd_autorizada: 10,
    profissional_id: 'prof-1', paciente_planos: { paciente_id: P1, contratos: { nome: 'Convênio Teste' } }, ...o });
  T.autorizacoes.push(aut('lt-a1', {}), aut('lt-a2', { status: 'pendente', senha: null, data_autorizacao: null, solicitada_em: iso(dia(-2)) }),
    aut('lt-a3', { area: 'nutricao', profissional_id: 'prof-2', senha: '999', data_autorizacao: dt(-40) }));
  T.encaminhamentos.push({ id: 'lt-e1', paciente_id: P1, area: 'fisioterapia', data_pedido: dt(-25), validade: dt(155), cid: 'M54.5', status: 'ativo', solicitantes: { nome: 'Dr. Teste' } },
    { id: 'lt-e2', paciente_id: P1, area: 'nutricao', data_pedido: dt(-300), validade: dt(-120), cid: 'E66.9', status: 'ativo', solicitantes: { nome: 'Dra. Modelo' } });
  T.documentos_emitidos.push({ id: 'lt-d1', paciente_id: P1, tipo: 'comparecimento', titulo: 'Declaração de comparecimento', codigo: 'AB12CD34', emitido_em: iso(dia(-10, 11)), profissionais: null });
  T.prontuario_registros.push({ id: 'lt-r1', paciente_id: P1, modelo: 'fisio_evolucao', area: 'fisioterapia', data_registro: dt(-10), conteudo: { texto: 'NÃO DEVE APARECER' } },
    { id: 'lt-r2', paciente_id: P1, modelo: 'dinamometria', area: null, data_registro: dt(-30), conteudo: {} });
  T.recebimentos.push({ id: 'lt-p1', paciente_id: P1, pago_em: dt(-9), forma: 'pix', parcelas: 1, valor_pago: 100, nf_numero: '77' },
    { id: 'lt-p2', paciente_id: P1, pago_em: dt(-1), forma: 'credito_parcelado', parcelas: 3, valor_pago: 300, nf_numero: null });
  T.guias.push({ id: 'lt-g1', paciente_plano_id: 'lt-pl', numero_guia_prestador: '000123', data_atendimento: dt(-12), status: 'enviada', segurada: false, contratos: { nome: 'Convênio Teste' } },
    { id: 'lt-g2', paciente_plano_id: 'lt-pl', numero_guia_prestador: '000124', data_atendimento: dt(-6), status: 'pronta', segurada: true, contratos: { nome: 'Convênio Teste' } });
})();
