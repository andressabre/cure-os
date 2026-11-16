// Fixtures do teste da paleta: nada além da base (pacientes fictícios Carla/Diego/Elisa/Fábio).
// O fake de banco ignora ilike/or e devolve todos; a paleta limita a 8. Sem dados reais.
(() => {
  window.__ROTAS_PALETA = [
    { id: 'agenda', nome: 'Agenda' }, { id: 'pacientes', nome: 'Pacientes' }, { id: 'financeiro', nome: 'Financeiro' },
    { id: 'lotes', nome: 'Lotes TISS' }, { id: 'contratos', nome: 'Convênios e contratos' },
  ];
})();
