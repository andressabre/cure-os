// Módulo Meu extrato (perfil profissional): só o próprio repasse e as próprias glosas.
import { sb, estado, $, esc, brl, data, tela, falha } from '../core.js';

export async function render() {
  const hoje = new Date(), ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const c = tela('Meu extrato', `<input type="date" id="de" value="${ini.toISOString().slice(0, 10)}">
    <input type="date" id="ate" value="${hoje.toISOString().slice(0, 10)}"><button class="btn primario" id="ver">Ver</button>`);
  const carregar = async () => {
    const { data: ls, error } = await sb.rpc('meu_extrato', { p_clinica: estado.clinica.id, p_de: $('#de').value, p_ate: $('#ate').value });
    if (error) return falha(error);
    const prev = ls.reduce((s, l) => s + Number(l.repasse_previsto), 0), desc = ls.reduce((s, l) => s + Number(l.desconto_glosa), 0);
    c.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="rotulo">Repasse previsto</div><div class="valor">${brl(prev)}</div></div>
      <div class="kpi alerta"><div class="rotulo">Descontos por glosa</div><div class="valor">${brl(desc)}</div></div>
      <div class="kpi"><div class="rotulo">A receber</div><div class="valor">${brl(prev - desc)}</div></div></div>
      <div class="cartao tabela-rolagem">${ls.length ? `<table><thead><tr><th>Data</th><th>Paciente</th><th>Procedimento</th><th>Guia</th>
        <th class="num">Repasse</th><th class="num">Desconto</th><th class="num">Final</th><th>Glosa</th><th>Orientação</th></tr></thead><tbody>
        ${ls.map((l) => `<tr><td>${data(l.data)}</td><td>${esc(l.paciente)}</td><td>${esc(l.procedimento)}</td><td>${esc(l.numero_guia)}</td>
          <td class="num">${brl(l.repasse_previsto)}</td><td class="num">${brl(l.desconto_glosa)}</td><td class="num"><strong>${brl(l.repasse_final)}</strong></td>
          <td>${l.glosa_codigo ? `<span class="selo alerta">${esc(l.glosa_codigo)}</span> ${esc(l.glosa_motivo || '')}` : ''}</td>
          <td>${esc(l.orientacao || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhum atendimento faturado no período.</div>'}</div>`;
  };
  $('#ver').onclick = carregar;
  carregar();
}
