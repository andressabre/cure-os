// Fixtures da Lista de espera (item 13): 3 vagas canceladas livres + 1 já reocupada, 6 pessoas na fila. Nomes fictícios.
(() => {
  const fx = window.__FIXTURES, { C, dia, iso } = window.__fx;
  document.addEventListener('DOMContentLoaded', () => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/espera.css'; document.head.appendChild(l); });
  const P = (n) => `00000000-0000-4000-8000-00000000000${n}`, pac = (n) => fx.tabelas.pacientes.find((p) => p.id === P(n));
  const ats = fx.tabelas.atendimentos; // base já tem at-8: cancelado, dia+2 15h, prof-2 Nutrição
  const can = (id, n, h, prof, serv, p) => ({ id, clinica_id: C, paciente_id: P(p), profissional_id: prof, inicio: iso(dia(n, h)), fim: iso(dia(n, h, 45)), status: 'cancelado', servico: serv, sala: 'Sala 1' });
  ats.push(can('at-c1', 1, 10, 'prof-1', 'Fisioterapia', 1), can('at-c2', 3, 16, 'prof-1', 'Fisioterapia', 2),
    can('at-c3', 4, 11, 'prof-1', 'Fisioterapia', 3), { ...can('at-r3', 4, 11, 'prof-1', 'Fisioterapia', 4), id: 'at-r3', status: 'agendado' }); // c3 reocupado
  const L = (id, p, o) => ({ id, clinica_id: C, paciente_id: P(p), profissional_id: null, servico: 'Fisioterapia', dias_semana: null, periodo: 'qualquer', urgencia: 'normal',
    observacao: null, situacao: 'aguardando', ofertado_em: null, atendimento_id: null, criado_em: iso(dia(-(o.d || 1), 10)), pacientes: { nome: pac(p).nome, celular: pac(p).celular, telefone: null }, ...o });
  fx.tabelas.lista_espera = [
    L('le-1', 2, { profissional_id: 'prof-1', d: 12, periodo: 'manha', observacao: 'Prefere sala térrea' }),
    L('le-2', 3, { urgencia: 'alta', d: 3 }),
    L('le-3', 4, { profissional_id: 'prof-1', dias_semana: [1, 3, 5], periodo: 'tarde', d: 20 }),
    L('le-4', 1, { profissional_id: 'prof-2', servico: 'Nutrição', d: 7 }),
    L('le-5', 2, { servico: 'Nutrição', situacao: 'ofertado', ofertado_em: iso(dia(-1, 15)), d: 30 }),
    L('le-6', 3, { profissional_id: 'prof-2', servico: 'Nutrição', situacao: 'desistiu', d: 40 }),
  ];
})();
