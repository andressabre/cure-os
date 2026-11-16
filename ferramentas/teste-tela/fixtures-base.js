// Dados fictícios mínimos para as telas abrirem. Nenhum dado real de paciente entra aqui (repositório público).
(() => {
  const fx = window.__FIXTURES, perfil = window.__PERFIL || 'gestor';
  const C = 'clin-1', hoje = new Date(); const dia = (n, h = 9, m = 0) => { const d = new Date(hoje); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
  const iso = (d) => d.toISOString(), dt = (n) => { const d = dia(n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  window.__fx = { C, dia, iso, dt };
  const clinica = { id: C, nome: 'Clínica Teste', config: { abre: '07:30', fecha: '19:30', dias: [0, 1, 2, 3, 4, 5, 6], intervalo_min: 15, salas: ['Sala 1', 'Consultório'],
    pausas: [{ de: '12:00', ate: '13:30', nome: 'Almoço' }], fecha_por_dia: { 6: '12:00' }, sala_padrao: {}, relacionamento: { reavaliacoes: [] },
    lembrete_texto: 'Olá {nome}, lembrete: {servico} {dia} às {hora}.' } };
  const profs = [
    { id: 'prof-1', clinica_id: C, nome: 'Ana Fisio', especialidade: 'Fisioterapia', conselho: 'CREFITO', numero_conselho: '000', ativo: true, cor: '#2a7', duracao_padrao_min: 45, notificacoes_ativas: true },
    { id: 'prof-2', clinica_id: C, nome: 'Bia Nutri', especialidade: 'Nutrição', conselho: 'CRN', numero_conselho: '001', ativo: true, cor: '#a72', duracao_padrao_min: 45, notificacoes_ativas: true },
  ];
  const pacs = ['Carla Teste', 'Diego Exemplo', 'Elisa Modelo', 'Fábio Amostra'].map((nome, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, clinica_id: C, nome, ativo: true,
    celular: '554799990000' + i, email: `p${i}@teste.local`, data_nascimento: `198${i}-0${i + 1}-15`, sexo: i % 2 ? 'M' : 'F', consentimento_comunicacao: true, profissionais_resp: ['prof-1'] }));
  const at = (i, n, h, st, extra = {}) => ({ id: `at-${i}`, clinica_id: C, paciente_id: pacs[i % 4].id, profissional_id: i % 2 ? 'prof-2' : 'prof-1',
    inicio: iso(dia(n, h)), fim: iso(dia(n, h, 45)), status: st, servico: i % 2 ? 'Nutrição' : 'Fisioterapia', sala: i % 2 ? 'Consultório' : 'Sala 1',
    paciente_plano_id: null, autorizacao_id: null, observacao: null, serie_id: null, lembrete_enviado_em: null,
    pacientes: { id: pacs[i % 4].id, nome: pacs[i % 4].nome, celular: pacs[i % 4].celular, alerta: null }, profissionais: { id: i % 2 ? 'prof-2' : 'prof-1', nome: i % 2 ? 'Bia Nutri' : 'Ana Fisio', cor: '#2a7' }, ...extra });
  Object.assign(fx.tabelas, {
    clinicas: [clinica],
    usuarios_clinica: [{ user_id: 'user-1', clinica_id: C, perfil, profissional_id: perfil === 'recepcao' ? null : 'prof-1', ativo: true, clinicas: { id: C, nome: clinica.nome } }],
    profissionais: profs, pacientes: pacs,
    atendimentos: [at(0, 0, 8, 'agendado'), at(1, 0, 9, 'confirmado'), at(2, 0, 10, 'presente'), at(3, 0, 14, 'atendido'), at(4, 1, 8, 'agendado'), at(5, 1, 9, 'agendado'), at(6, -1, 9, 'atendido'), at(7, -1, 10, 'faltou'), at(8, 2, 15, 'cancelado')],
    contratos: [{ id: 'ct-1', clinica_id: C, nome: 'Convênio Teste', ativo: true, regras: {}, prazo_envio_dias: 30, operadora_id: 'op-1', operadoras: { nome: 'Operadora Teste' } },
      { id: 'ct-p', clinica_id: C, nome: 'Particular', ativo: true, regras: { sem_tiss: true }, operadora_id: null }],
    operadoras: [{ id: 'op-1', clinica_id: C, nome: 'Operadora Teste', registro_ans: '000000' }],
    paciente_planos: [], autorizacoes: [], encaminhamentos: [], procedimentos: [], lotes: [], guias: [], guia_itens: [], retornos: [], retorno_linhas: [], glosas: [],
    motivos_glosa: [], lancamentos: [], contas_financeiras: [], categorias_financeiras: [], carteiras: [{ id: 'cart-1', clinica_id: C, nome: 'Clínica', tipo: 'empresa', ordem: 1, ativo: true }],
    recebimentos: [], notificacoes: [], prontuario_registros: [], documentos_emitidos: [], convites: [], auditoria: [],
  });
  Object.assign(fx.rpc, { pendencias: [], autorizacoes_pendentes: [], numeracao_sessoes: [], convenio_atendimentos: [], ocupacao_agenda: [], guias_liberadas_resumo: [],
    relacionamento: { aniversarios: [], reavaliacoes: [] }, minhas_areas: ['fisioterapia', 'palmilha'], meus_pacientes_prontuario: [], estatisticas: { totais: { atendidos: 3, faltas: 1, futuros: 2, pacientes: 3, novos: 1, cancelados: 1 }, mensal: [], sexo: {}, servicos: [], convenios: [], faixas: [], profissionais: [] }, meu_extrato: [], lote_candidatas: [] });
})();
