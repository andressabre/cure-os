// Estatísticas: o profissional vê só os próprios números; a gestão vê a clínica toda e pode filtrar por profissional.
// Dados vêm da função SQL `estatisticas` (o filtro de perfil é aplicado no banco).
import { sb, estado, $, esc, brl, pct, tela, falha } from '../core.js';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const anoAtual = new Date().getFullYear();
let filtro = { ano: anoAtual, prof: '' };

// Barras mensais de uma série (uma cor; valor no hover e tabela acessível ao lado)
function barras(mensal, campo, fmt = (v) => v) {
  const vals = mensal.map((m) => Number(m[campo]) || 0), max = Math.max(...vals, 1);
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return '<div class="vazio">Sem registros neste ano.</div>';
  return `<div class="grafico" role="img" aria-label="${esc(campo)} por mês">
    ${vals.map((v, i) => `<div class="g-col" tabindex="0"><span class="g-dica">${MESES[i]}: ${fmt(v)}</span>
      <div class="g-barra" style="height:${(v / max) * 100}%"></div><span class="g-rot">${MESES[i]}</span></div>`).join('')}</div>
    <details class="g-tabela"><summary>Ver em tabela</summary><table><tbody>${vals.map((v, i) => `<tr><td>${MESES[i]}</td><td class="num">${fmt(v)}</td></tr>`).join('')}</tbody></table></details>`;
}

const lista = (itens, total) => itens.length ? `<table><tbody>${itens.map((x) => `<tr><td>${esc(x.nome)}</td>
  <td style="width:38%"><div class="barra"><span style="width:${(x.n / total) * 100}%"></span></div></td>
  <td class="num" style="width:56px">${x.n}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Sem atendimentos registrados.</div>';

export async function render() {
  const gestao = ['gestor', 'financeiro', 'recepcao'].includes(estado.perfil);
  let profs = [];
  if (gestao) ({ data: profs } = await sb.from('profissionais').select('id, nome').eq('clinica_id', estado.clinica.id).eq('ativo', true).order('nome'));
  const c = tela(gestao ? 'Estatísticas' : 'Meus números', `
    ${gestao ? `<select id="e-prof" aria-label="Profissional"><option value="">Clínica toda</option>
      ${(profs || []).map((p) => `<option value="${p.id}" ${p.id === filtro.prof ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>` : ''}
    <select id="e-ano" aria-label="Ano">${[anoAtual, anoAtual - 1].map((a) => `<option ${a === filtro.ano ? 'selected' : ''}>${a}</option>`).join('')}</select>`);
  $('#e-ano').onchange = (e) => { filtro.ano = Number(e.target.value); render(); };
  $('#e-prof')?.addEventListener('change', (e) => { filtro.prof = e.target.value; render(); });

  const { data: d, error } = await sb.rpc('estatisticas', { p_clinica: estado.clinica.id, p_ano: filtro.ano, p_prof: filtro.prof || null });
  if (error) return falha(error);
  const t = d.totais, presencas = t.atendidos + t.faltas;
  const sx = d.sexo || {}, totSx = Object.values(sx).reduce((a, b) => a + b, 0);
  const nomeSx = { F: 'Feminino', M: 'Masculino' };
  const temDinheiro = d.mensal.some((m) => m.repasse !== null);

  c.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="rotulo">Atendimentos realizados</div><div class="valor">${t.atendidos}</div><div class="sub">${t.futuros} agendados daqui para frente</div></div>
      <div class="kpi"><div class="rotulo">Pacientes atendidos</div><div class="valor">${t.pacientes}</div><div class="sub">${t.novos} vieram pela primeira vez</div></div>
      <div class="kpi ${presencas && t.faltas / presencas > 0.15 ? 'alerta' : ''}"><div class="rotulo">Faltas</div><div class="valor">${pct(presencas ? (t.faltas / presencas) * 100 : 0)}</div><div class="sub">${t.faltas} faltas e ${t.cancelados} cancelamentos</div></div>
      <div class="kpi"><div class="rotulo">Sem retorno há mais de 60 dias</div><div class="valor">${t.sem_retorno_60}</div><div class="sub">e sem nada agendado</div></div>
    </div>
    <div class="cartao"><h3>Atendimentos por mês</h3>${barras(d.mensal, 'atendidos')}</div>
    <div class="e-duas">
      <div class="cartao"><h3>Pacientes novos por mês</h3>${barras(d.mensal, 'novos')}</div>
      <div class="cartao"><h3>Faltas por mês</h3>${barras(d.mensal, 'faltas')}</div>
    </div>
    ${temDinheiro ? `<div class="cartao"><h3>${d.gestao ? 'Faturado por mês (guias emitidas)' : 'Meu repasse por mês'}</h3>${barras(d.mensal, d.gestao ? 'faturado' : 'repasse', brl)}
      ${d.gestao ? `<p class="muted" style="margin:10px 0 0">No ano: faturado ${brl(d.mensal.reduce((s, m) => s + Number(m.faturado), 0))} ·
        glosado ${brl(d.mensal.reduce((s, m) => s + Number(m.glosado), 0))} · repasse ${brl(d.mensal.reduce((s, m) => s + Number(m.repasse), 0))}</p>` : ''}</div>` : ''}
    <div class="e-duas">
      <div class="cartao"><h3>Por serviço</h3>${lista(d.servicos, t.atendidos)}</div>
      <div class="cartao"><h3>Por convênio</h3>${lista(d.convenios, t.atendidos)}</div>
    </div>
    <div class="e-duas">
      <div class="cartao"><h3>Perfil dos pacientes</h3>${totSx ? `<table><tbody>${Object.entries(sx).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr>
        <td>${esc(nomeSx[k] || 'Não informado')}</td><td class="num">${n}</td><td class="num muted" style="width:70px">${pct((n / totSx) * 100)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="vazio">Sem atendimentos registrados.</div>'}</div>
      ${d.profissionais ? `<div class="cartao"><h3>Por profissional</h3><table><thead><tr><th>Profissional</th><th class="num">Atendidos</th><th class="num">Faltas</th><th class="num">Faturado</th><th class="num">Repasse</th></tr></thead><tbody>
        ${d.profissionais.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${p.atendidos}</td><td class="num">${p.faltas}</td><td class="num">${brl(p.faturado)}</td><td class="num">${brl(p.repasse)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
    </div>
    <p class="muted">Contam os atendimentos registrados no Cure OS. O histórico do sistema antigo não entra nestes números.</p>`;
}
