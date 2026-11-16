// Cenário fictício para a Inteligência de glosas (js/modulos/glosas-intel.js). Valores, lotes, guias e convênios inventados (repositório público).
// Hash com "vazio" (ex.: rodar.mjs estatisticas-vazio …) = nenhum retorno; com "um" = 1 retorno em revisão, ~30 linhas e nenhuma guia própria (cenário da produção).
(() => {
  document.addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'css/glosas-intel.css' })));
  const fx = window.__FIXTURES, { C, dt } = window.__fx, T = fx.tabelas;
  if (/vazio/.test(location.hash)) return;
  const um = /-um/.test(location.hash);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  T.contratos.push(
    { id: 'ct-a', clinica_id: C, nome: 'Convênio Alfa', ativo: true, regras: {}, operadora_id: 'op-1' },
    { id: 'ct-b', clinica_id: C, nome: 'Convênio Beta', ativo: true, regras: {}, operadora_id: 'op-1' },
    { id: 'ct-c', clinica_id: C, nome: 'Convênio Gama', ativo: true, regras: {}, operadora_id: 'op-1' });
  const nomeCt = { 'ct-a': 'Convênio Alfa', 'ct-b': 'Convênio Beta', 'ct-c': 'Convênio Gama' };
  T.motivos_glosa = [
    { codigo: '3209', descricao: 'Descrição fictícia de teste (3209)', ativo: true },
    { codigo: '1814', descricao: 'Descrição fictícia de teste (1814)', ativo: true },
    { codigo: '1426', descricao: 'Não autorizado pela auditoria', ativo: true },
    { codigo: '1816', descricao: 'Cobrança de procedimento em quantidade incompatível com o procedimento/evolução clínica', ativo: true },
    { codigo: '1702', descricao: 'Cobrança de procedimento em duplicidade', ativo: false, inativo_desde: '2025-12-01', substituido_por: '1816' },
  ]; // 3292, 1705 e 9901 ficam sem descrição de propósito ("descrição a cadastrar")
  const codigos = ['3209', '3209', '1814', '3292', '1705', '1426', '1816', '1702', '9901'];
  const procs = ['50000470', '50000471', '20103344', '00010014'];
  // [contrato, dias atrás da emissão, status]
  const plano = um ? [['ct-a', 4, 'em_revisao']] : [['ct-a', 165, 'confirmado'], ['ct-b', 140, 'confirmado'], ['ct-c', 110, 'confirmado'], ['ct-a', 80, 'confirmado'],
    ['ct-b', 50, 'confirmado'], ['ct-c', 25, 'confirmado'], ['ct-a', 4, 'em_revisao']];
  const porRet = um ? 30 : 17;
  T.retornos = plano.map(([ct, d, st], i) => ({ id: `ret-${i + 1}`, clinica_id: C, contrato_id: ct, data_emissao: dt(-d), status: st, contratos: { nome: nomeCt[ct] } }));
  if (!um) T.retornos.push({ id: 'ret-x', clinica_id: C, contrato_id: 'ct-b', data_emissao: dt(-10), status: 'descartado', contratos: { nome: 'Convênio Beta' } });
  T.guias = um ? [] : Array.from({ length: 8 }, (_, i) => ({ id: `g-${i + 1}`, clinica_id: C, profissional_id: i % 3 ? 'prof-1' : 'prof-2' }));
  T.lotes = []; T.retorno_linhas = []; let n = 0;
  T.retornos.filter((r) => r.status !== 'descartado').forEach((r, i) => {
    const lote = `90${String(i + 1).padStart(2, '0')}`;
    if (!um) T.lotes.push({ id: `lt-${i + 1}`, clinica_id: C, contrato_id: r.contrato_id, numero_lote: lote, status: 'retornado',
      data_envio: dt(-(plano[i][1] + 28 + (i % 3) * 6)), valor_total: 1000 });
    for (let k = 0; k < porRet; k++) {
      const inf = [48, 62.5, 85, 120][k % 4], glosa = rnd() < (i === 2 ? 0.45 : 0.3);
      const vg = glosa ? (rnd() < 0.6 ? inf : +(inf * 0.5).toFixed(2)) : 0;
      T.retorno_linhas.push({ id: `rl-${++n}`, clinica_id: C, retorno_id: r.id, classe: 'da_clinica', numero_lote: lote,
        numero_guia_prestador: `G${i + 1}${String(Math.floor(k / 2)).padStart(3, '0')}`, numero_guia_operadora: `OP${n}`, carteirinha: null,
        data_realizacao: dt(-(plano[i][1] + 35 - (k % 20))), codigo_procedimento: k % 9 === 8 ? null : procs[k % 4],
        valor_informado: inf, valor_liberado: +(inf - vg).toFixed(2), valor_glosa: vg, codigo_glosa: vg ? codigos[Math.floor(rnd() * codigos.length)] : null,
        guia_id: !um && k % 2 === 0 ? `g-${(k % 8) + 1}` : null, guia_item_id: null });
    }
    // linha de outra clínica: nunca pode entrar em nada
    T.retorno_linhas.push({ id: `rl-o${i}`, clinica_id: C, retorno_id: r.id, classe: 'outra_clinica', numero_lote: '7777', numero_guia_prestador: 'X1',
      valor_informado: 99999, valor_liberado: 0, valor_glosa: 99999, codigo_glosa: '3209' });
  });
  T.glosas = um ? [] : [
    { id: 'gl-1', clinica_id: C, guia_item_id: 'gi-1', retorno_linha_id: 'rl-3', codigo_glosa: '3209', valor: 62.5, status: 'pendente', prazo_recurso: dt(-2), guia_itens: { guias: { numero_guia_prestador: 'G1001' } } },
    { id: 'gl-2', clinica_id: C, guia_item_id: 'gi-2', retorno_linha_id: 'rl-20', codigo_glosa: '1814', valor: 85, status: 'pendente', prazo_recurso: dt(3) },
    { id: 'gl-3', clinica_id: C, guia_item_id: 'gi-3', retorno_linha_id: 'rl-40', codigo_glosa: '1426', valor: 120, status: 'pendente', prazo_recurso: dt(12) },
    { id: 'gl-4', clinica_id: C, guia_item_id: 'gi-4', codigo_glosa: '1816', valor: 48, status: 'pendente', prazo_recurso: dt(40) },
    { id: 'gl-5', clinica_id: C, guia_item_id: 'gi-5', codigo_glosa: '3292', valor: 120, status: 'recuperada', prazo_recurso: dt(-30) },
    { id: 'gl-6', clinica_id: C, guia_item_id: 'gi-6', codigo_glosa: '1705', valor: 48, status: 'definitiva', prazo_recurso: dt(-40) },
    { id: 'gl-7', clinica_id: C, guia_item_id: 'gi-7', codigo_glosa: '1426', valor: 85, status: 'em_recurso', prazo_recurso: dt(-5) },
  ];
})();
