// Fixture fictícia do Meu extrato (js/modulos/extrato.js, db/067). Nenhum dado real.
(() => {
  const fx = window.__FIXTURES;
  const l = (d, nome, situacao, extra = {}) => ({ data: d, paciente: nome, procedimento: 'Sessão de teste', numero_guia: 'G' + d.slice(-2), repasse_previsto: 30, desconto_glosa: 0, repasse_final: 30, glosa_codigo: null, glosa_motivo: null, glosa_status: null, orientacao: null, situacao, etapa: null, ...extra });
  fx.rpc.meu_extrato = [l('2026-11-03', 'Paciente A', 'pago'), l('2026-11-04', 'Paciente B', 'aguardando', { etapa: 'Enviado, aguardando pagamento' }),
    l('2026-11-05', 'Paciente C', 'glosado', { desconto_glosa: 30, repasse_final: 0, glosa_codigo: '1801', glosa_motivo: 'Motivo de teste', orientacao: 'Conferir a senha' })];
})();
