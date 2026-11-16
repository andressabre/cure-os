// Fixtures da tela Hoje (js/modulos/hoje.js). Dados fictícios — nada de paciente real (repositório público).
// Também injeta css/hoje.css (ainda não ligado no index.html).
(() => {
  const fx = window.__FIXTURES, { C, dia, iso } = window.__fx;
  document.addEventListener('DOMContentLoaded', () => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/hoje.css'; document.head.appendChild(l); });
  const P = (n) => `00000000-0000-4000-8000-00000000000${n}`, pac = (n) => fx.tabelas.pacientes[n - 1];
  const emb = (n, sem) => ({ id: P(n), nome: pac(n).nome, celular: sem ? null : pac(n).celular, telefone: null });
  const at = (id, n, h, m, st, prof, pn, extra = {}) => ({ id, clinica_id: C, paciente_id: P(pn), profissional_id: prof, inicio: iso(dia(n, h, m)), fim: iso(dia(n, h, m + 45)),
    status: st, servico: prof === 'prof-1' ? 'Fisioterapia' : 'Nutrição', sala: prof === 'prof-1' ? 'Sala 1' : 'Consultório', paciente_plano_id: null, autorizacao_id: null,
    observacao: null, serie_id: null, lembrete_enviado_em: null, pacientes: emb(pn), ...extra });
  const ats = fx.tabelas.atendimentos;
  ats.find((a) => a.id === 'at-0').autorizacao_id = 'aut-1';
  ats.push(
    at('hj-1', 0, 16, 0, 'agendado', 'prof-1', 2, { autorizacao_id: 'aut-2' }),
    at('hj-2', 0, 17, 30, 'confirmado', 'prof-2', 3),
    at('hj-3', 0, 18, 15, 'agendado', 'prof-1', 4),
    at('hj-4', 1, 10, 0, 'agendado', 'prof-1', 3, { pacientes: emb(3, true) }),                       // sem celular → "sem WhatsApp"
    at('hj-5', 1, 11, 0, 'agendado', 'prof-2', 4, { lembrete_enviado_em: iso(dia(0, 7)) }),          // já enviado
    at('hj-6', 1, 15, 0, 'confirmado', 'prof-1', 1),
    at('hj-7', -3, 9, 0, 'atendido', 'prof-1', 2),                                                   // tem evolução ligada → não aparece
    at('hj-8', -5, 14, 0, 'atendido', 'prof-1', 4),
    at('hj-9', -20, 9, 0, 'atendido', 'prof-1', 1));                                                 // fora dos 14 dias
  fx.tabelas.prontuario_registros.push({ id: 'pr-1', clinica_id: C, paciente_id: P(2), profissional_id: 'prof-1', atendimento_id: 'hj-7', modelo: 'fisio_evolucao', status: 'assinado' });
  fx.tabelas.autorizacoes.push(
    { id: 'aut-p1', clinica_id: C, profissional_id: 'prof-1', status: 'pendente', paciente_planos: { paciente_id: P(1) } },
    { id: 'aut-p2', clinica_id: C, profissional_id: 'prof-2', status: 'pendente', paciente_planos: { paciente_id: P(4) } });
  fx.tabelas.notificacoes.push(
    { id: 'nt-1', clinica_id: C, profissional_id: 'prof-1', tipo: 'autorizacao', mensagem: 'Senha registrada para Carla Teste (fisioterapia).', lida: false, criado_em: iso(dia(0, 7, 10)) },
    { id: 'nt-2', clinica_id: C, profissional_id: 'prof-1', tipo: 'agenda', mensagem: 'Novo agendamento: Diego Exemplo amanhã às 08:00.', lida: false, criado_em: iso(dia(-1, 18)) },
    { id: 'nt-3', clinica_id: C, profissional_id: 'prof-2', tipo: 'agenda', mensagem: 'Aviso de outra profissional.', lida: false, criado_em: iso(dia(0, 7)) },
    { id: 'nt-4', clinica_id: C, profissional_id: 'prof-1', tipo: 'agenda', mensagem: 'Aviso antigo já lido.', lida: true, criado_em: iso(dia(-2, 9)) });
  Object.assign(fx.rpc, {
    numeracao_sessoes: (a) => (a.p_atendimentos || []).flatMap((id) => (id === 'at-0' ? [{ atendimento_id: id, n: 9, total: 10, restam: 1, validade: null, base: 'senha' }]
      : id === 'hj-1' ? [{ atendimento_id: id, n: 3, total: 10, restam: 7, validade: null, base: 'senha' }] : [])),
    pendencias: [
      { gravidade: 'media', area: 'Faturamento', descricao: '2 guias liberadas aguardando lote', link: 'lotes' },
      { gravidade: 'alta', area: 'Autorizações', descricao: 'Senha acabando: Elisa Modelo (9 de 10)', link: `paciente-${P(3)}` },
      { gravidade: 'baixa', area: 'Backup', descricao: 'Último backup há 6 dias', link: 'painel' }],
    autorizacoes_pendentes: [
      { autorizacao_id: 'aut-p1', paciente: 'Carla Teste', carteirinha: '000', contrato: 'Convênio Teste', procedimento: '00000000 · Sessão de fisioterapia', qtd_solicitada: 10, agendados: 3, atendidos: 1, primeira_data: window.__fx.dt(-2), profissionais: 'Ana Fisio', dias: 4 },
      { autorizacao_id: 'aut-p2', paciente: 'Fábio Amostra', carteirinha: '000', contrato: 'Convênio Teste', procedimento: '00000001 · Consulta de nutrição', qtd_solicitada: 1, agendados: 1, atendidos: 0, primeira_data: window.__fx.dt(3), profissionais: 'Bia Nutri', dias: 1 }],
    relacionamento: () => ({ config: { texto_aniversario: 'Feliz aniversário, {nome}! Toda a equipe deseja um ótimo dia.', rodape_sair: 'Se não quiser mais receber, responda SAIR.' },
      itens: [{ tipo: 'aniversario', paciente_id: P(2), nome: 'Diego Exemplo', telefone: pac(2).celular, quando: window.__fx.dt(0), idade: 44 },
        { tipo: 'aniversario', paciente_id: P(4), nome: 'Fábio Amostra', telefone: null, quando: window.__fx.dt(0), idade: 30 }] }),
  });
  if (window.__PERFIL === 'profissional') delete fx.rpc.relacionamento;   // no banco a função recusa profissional
})();
