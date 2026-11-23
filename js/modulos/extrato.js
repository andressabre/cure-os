// Módulo Meu extrato (perfil profissional): só o próprio repasse, a situação de cada atendimento e as próprias glosas (db/067).
// Situação: pago (operadora pagou) · glosado (glosa CONFIRMADA pela gestão, com código e orientação) · aguardando (ainda não pago ou não enviado).
// Nunca mostra o valor que a clínica recebe; só o repasse do próprio profissional.
import { sb, estado, $, $$, esc, brl, data, tela, falha } from '../core.js';

const SIT = { pago: ['ok', 'Pago'], glosado: ['alerta', 'Glosado'], aguardando: ['outra', 'Aguardando'] };
const soma = (ls, f) => ls.reduce((s, l) => s + Number(f(l) || 0), 0);

export async function render() {
  const hoje = new Date(), ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const c = tela('Meu extrato', `<input type="date" id="de" value="${ini.toISOString().slice(0, 10)}">
    <input type="date" id="ate" value="${hoje.toISOString().slice(0, 10)}"><button class="btn primario" id="ver">Ver</button>`);
  let filtro = 'todos', ls = [];
  const desenha = () => {
    const por = (s) => ls.filter((l) => l.situacao === s);
    const vis = filtro === 'todos' ? ls : por(filtro);
    const chip = (k, n, q) => `<button class="btn pequeno ${filtro === k ? 'primario' : ''}" data-f="${k}">${n} (${q})</button>`;
    $('#extrato-corpo', c).innerHTML = `<div class="kpis">
      <div class="kpi"><div class="rotulo">Pago</div><div class="valor">${brl(soma(por('pago'), (l) => l.repasse_final))}</div></div>
      <div class="kpi"><div class="rotulo">Aguardando a operadora</div><div class="valor">${brl(soma(por('aguardando'), (l) => l.repasse_previsto))}</div></div>
      <div class="kpi alerta"><div class="rotulo">Descontado por glosa</div><div class="valor">${brl(soma(ls, (l) => l.desconto_glosa))}</div></div></div>
      <p style="margin:12px 0">${chip('todos', 'Todos', ls.length)} ${chip('pago', 'Pagos', por('pago').length)} ${chip('aguardando', 'Aguardando', por('aguardando').length)} ${chip('glosado', 'Glosados', por('glosado').length)}</p>
      <div class="cartao tabela-rolagem">${vis.length ? `<table><thead><tr><th>Data</th><th>Paciente</th><th>Procedimento</th><th>Guia</th><th>Situação</th>
        <th class="num">Repasse</th><th class="num">Desconto</th><th class="num">Final</th><th>Glosa</th><th>Orientação</th></tr></thead><tbody>
        ${vis.map((l) => { const [cl, rot] = SIT[l.situacao] || SIT.aguardando; return `<tr><td>${data(l.data)}</td><td>${esc(l.paciente)}</td><td>${esc(l.procedimento)}</td><td>${esc(l.numero_guia)}</td>
          <td><span class="selo ${cl}">${rot}</span>${l.situacao === 'aguardando' && l.etapa ? `<div class="muted" style="font-size:12px">${esc(l.etapa)}</div>` : ''}</td>
          <td class="num">${brl(l.repasse_previsto)}</td><td class="num">${brl(l.desconto_glosa)}</td><td class="num"><strong>${brl(l.repasse_final)}</strong></td>
          <td>${l.glosa_codigo ? `<span class="selo alerta">${esc(l.glosa_codigo)}</span> ${esc(l.glosa_motivo || '')}` : ''}</td>
          <td>${esc(l.orientacao || '')}</td></tr>`; }).join('')}</tbody></table>` : '<div class="vazio">Nenhum atendimento nesta situação no período.</div>'}</div>
      <p class="muted">“Aguardando” não significa problema: a operadora ainda pode não ter pago. A glosa só aparece aqui depois de confirmada pela gestão.</p>`;
    $$('[data-f]', c).forEach((b) => (b.onclick = () => { filtro = b.dataset.f; desenha(); }));
  };
  const carregar = async () => {
    const { data: r, error } = await sb.rpc('meu_extrato', { p_clinica: estado.clinica.id, p_de: $('#de').value, p_ate: $('#ate').value });
    if (error) return falha(error);
    ls = r; desenha();
  };
  $('#ver').onclick = carregar;
  c.insertAdjacentHTML('beforeend', '<div id="extrato-corpo"></div>');
  carregar();
}
