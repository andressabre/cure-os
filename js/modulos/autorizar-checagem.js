// Pré-checagem de uma autorização antes de ir para a fila do robô (Bloco 1). Funções puras: não importam o core.js, testam em node.
// Uso: node ferramentas/testes-js/autorizar-checagem.test.mjs
// As regras vêm de contratos.regras.autorizacao (limites, canal…); nada de convênio fica escrito aqui.

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

// Limite do contrato que vale para o código do procedimento (campo `codigo` ou lista `codigos`)
export function limiteDoCodigo(aut, codigo) {
  return (aut?.limites || []).find((l) => String(l.codigo) === String(codigo) || (l.codigos || []).map(String).includes(String(codigo))) || null;
}

/**
 * a = { qtd, cid, codigo, validadeCarteira, enc: { arquivo, validade, cid } | null, aut: regras.autorizacao | null }
 * historico = autorizações anteriores (já autorizadas) do mesmo paciente+procedimento: [{ data: 'AAAA-MM-DD', qtd }]
 * Devolve { nivel: 'vermelho'|'amarelo'|'verde', bloqueios: [], avisos: [] }. Vermelho não vai para a fila.
 */
export function conferirGuia(a, hoje, historico = [], naFila = false) {
  const bloqueios = [], avisos = [];
  if (naFila) bloqueios.push('Já está na fila do robô');
  const aut = a.aut;
  if (!aut) bloqueios.push('Convênio ainda não ensinado ao robô');
  else if (aut.exige === false) bloqueios.push('Este convênio não exige autorização');
  else if (aut.canal !== 'portal') bloqueios.push('Autorização deste convênio não é por portal');

  if (!a.enc?.arquivo) bloqueios.push('Encaminhamento sem arquivo anexado');
  else if (a.enc.validade && a.enc.validade < hoje) bloqueios.push('Encaminhamento vencido');
  if (a.validadeCarteira && a.validadeCarteira < hoje) bloqueios.push('Carteirinha vencida');
  if (!(a.cid || a.enc?.cid)) bloqueios.push('Sem CID');

  const lim = aut ? limiteDoCodigo(aut, a.codigo) : null;
  const qtd = num(a.qtd) ?? 1;
  if (lim) {
    const porGuia = num(lim.max_por_guia);
    if (porGuia !== null && qtd > porGuia) bloqueios.push(`Pede ${qtd} sessões; o limite por guia é ${porGuia}`);
    const mes = String(hoje).slice(0, 7), ano = String(hoje).slice(0, 4);
    const somaMes = historico.filter((h) => String(h.data).slice(0, 7) === mes).reduce((s, h) => s + (num(h.qtd) || 0), 0);
    const somaAno = historico.filter((h) => String(h.data).slice(0, 4) === ano).reduce((s, h) => s + (num(h.qtd) || 0), 0);
    const porMes = num(lim.max_por_mes), porAno = num(lim.max_por_ano);
    if (porMes !== null && somaMes + qtd > porMes) bloqueios.push(`Passa do limite mensal (${somaMes} já autorizadas + ${qtd} pedidas; máx. ${porMes}/mês)`);
    if (porAno !== null && somaAno + qtd > porAno) bloqueios.push(`Passa do limite anual (${somaAno} já autorizadas + ${qtd} pedidas; máx. ${porAno}/ano)`);
    if (lim.limite) avisos.push(`Confira o limite: ${lim.limite}`);
    if (lim.obs && !bloqueios.length) avisos.push(lim.obs);
  }
  return { nivel: bloqueios.length ? 'vermelho' : avisos.length ? 'amarelo' : 'verde', bloqueios, avisos };
}

// Resumo para o cabeçalho da tela
export function resumirFila(itens) {
  const r = { verde: 0, amarelo: 0, vermelho: 0 };
  itens.forEach((i) => { r[i.nivel] = (r[i.nivel] || 0) + 1; });
  return r;
}
