// Fixtures fictícias da ficha do profissional (js/modulos/ficha-profissional.js, db/065). Nenhum dado real.
// Rota com "semdb" (ex.: ficha-prof-1-pagamento-semdb) = produção antes da 065: tabelas inexistentes.
(() => {
  const fx = window.__FIXTURES, { C } = window.__fx;
  if (location.hash.includes('semdb')) return;
  const d = new Date(), ant = new Date(d.getFullYear(), d.getMonth() - 1, 1), ym = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`;
  fx.tabelas.profissional_pagamento = [{ id: 'pg-1', clinica_id: C, profissional_id: 'prof-1', titular: 'Ana Fisio Teste', documento_titular: '000.000.000-00',
    banco: '000', agencia: '0001', conta: '12345-6', tipo_conta: 'corrente', pix_tipo: 'cpf', pix_chave: '00000000000' }];
  fx.tabelas.profissional_pagamento_solicitacoes = [{ id: 'sol-1', clinica_id: C, profissional_id: 'prof-1', mensagem: 'Troca de conta de teste', situacao: 'aberta',
    resposta: null, criado_em: new Date().toISOString(), resolvido_em: null }];
  fx.tabelas.notas_profissional = [{ id: 'nf-1', clinica_id: C, profissional_id: 'prof-1', competencia: ym + '-01', numero: '123', valor: 1000, chave_acesso: '12345678901234567890123456789012345678901234567890', data_emissao: ym + '-05', criado_em: new Date().toISOString() }];
})();
