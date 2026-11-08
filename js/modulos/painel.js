// Módulo Painel: visão rápida de faturamento e glosas confirmadas e em revisão.
import { sb, estado, esc, brl, pct, data, tela, falha } from '../core.js';

export async function render() {
  const c = tela('Painel');
  const [{ data: ls, error }, { data: motivos }, { data: rets }, { data: pend }] = await Promise.all([
    sb.from('retorno_linhas').select('retorno_id, numero_lote, numero_guia_prestador, valor_informado, valor_glosa, codigo_glosa')
      .eq('clinica_id', estado.clinica.id).eq('classe', 'da_clinica'),
    sb.from('motivos_glosa').select('codigo, descricao'),
    sb.from('retornos').select('id, status, data_emissao, contratos(nome)').eq('clinica_id', estado.clinica.id),
    sb.rpc('pendencias', { p_clinica: estado.clinica.id }),
  ]);
  if (error) return falha(error);
  const desc = Object.fromEntries((motivos || []).map((m) => [m.codigo, m.descricao]));
  const inf = ls.reduce((s, l) => s + Number(l.valor_informado), 0);
  const glo = ls.reduce((s, l) => s + Number(l.valor_glosa), 0);
  const emRevisao = (rets || []).filter((r) => r.status === 'em_revisao').length;
  const por = {};
  ls.filter((l) => Number(l.valor_glosa) > 0).forEach((l) => { const k = l.codigo_glosa || '—'; (por[k] ||= 0); por[k] += Number(l.valor_glosa); });
  const top = Object.entries(por).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const evitaveis = { '3209': 'Bloquear guia repetida (mesmo paciente, procedimento e data)',
    '3292': 'Controlar sessões autorizadas × usadas', '1814': 'Exigir autorização válida na data do atendimento',
    '1705': 'Preencher valor pela tabela do contrato' };

  const ordem = { alta: 0, media: 1, baixa: 2 }, rot = { alta: ['alerta', 'Alta'], media: ['pendente', 'Média'], baixa: ['outra', 'Baixa'] };
  const ps = (pend || []).sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
  c.innerHTML = `
    <div class="cartao"><h3>Pendências ${ps.length ? `<span class="selo alerta">${ps.length}</span>` : ''}</h3>
      ${ps.length ? `<table><tbody>${ps.map((x) => `<tr class="clicavel" onclick="location.hash='${esc(x.link)}'">
        <td style="width:80px"><span class="selo ${rot[x.gravidade][0]}">${rot[x.gravidade][1]}</span></td>
        <td style="width:120px" class="muted">${esc(x.area)}</td><td>${esc(x.descricao)}</td><td style="width:20px">›</td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Nenhuma pendência. ✓</div>'}</div>
    <div class="kpis">
      <div class="kpi"><div class="rotulo">Faturado (retornos importados)</div><div class="valor">${brl(inf)}</div></div>
      <div class="kpi alerta"><div class="rotulo">Glosado</div><div class="valor">${brl(glo)}</div></div>
      <div class="kpi ${inf && glo / inf > 0.05 ? 'alerta' : ''}"><div class="rotulo">Taxa de glosa</div><div class="valor">${pct(inf ? (glo / inf) * 100 : 0)}</div><div class="sub">meta sugerida: abaixo de 3%</div></div>
      <div class="kpi"><div class="rotulo">Retornos para revisar</div><div class="valor">${emRevisao}</div><div class="sub"><a href="#retornos">abrir retornos →</a></div></div>
    </div>
    <div class="cartao"><h3>Onde a clínica perde dinheiro</h3>
      ${top.length ? `<table><thead><tr><th>Código</th><th>Motivo</th><th></th><th class="num">Valor</th><th>Como o sistema vai prevenir</th></tr></thead><tbody>
      ${top.map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${esc(desc[k] || 'Descrição a cadastrar')}</td>
        <td style="width:140px"><div class="barra"><span style="width:${(v / glo) * 100}%"></span></div></td>
        <td class="num">${brl(v)}</td><td class="muted">${esc(evitaveis[k] || '—')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Importe um retorno para ver as glosas.</div>'}
    </div>
    <div class="cartao"><h3>Últimos retornos</h3>
      ${(rets || []).length ? `<table><tbody>${rets.slice(0, 5).map((r) => `<tr class="clicavel" onclick="location.hash='retornos-${r.id}'">
        <td>${data(r.data_emissao)}</td><td>${esc(r.contratos?.nome)}</td><td>${r.status === 'confirmado' ? '<span class="selo ok">Confirmado</span>' : '<span class="selo pendente">Em revisão</span>'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Nenhum retorno ainda.</div>'}
    </div>`;
}
