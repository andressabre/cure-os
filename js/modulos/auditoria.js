// Módulo Auditoria (só gestão): quem mudou o quê e quando; antes/depois por campo. Não mostra conteúdo clínico.
import { sb, estado, $, $$, esc, tela, falha } from '../core.js';

const TABELAS = ['guias', 'guia_itens', 'atendimentos', 'autorizacoes', 'lancamentos', 'recebimentos', 'pacientes',
  'paciente_planos', 'contratos', 'contrato_tabela', 'regras_repasse', 'lotes', 'retornos', 'glosas', 'prontuario'];
const POR_PAGINA = 100;

const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const quando = (d) => new Date(d).toLocaleString('pt-BR');

export async function render() {
  if (estado.perfil !== 'gestor') return tela('Auditoria').replaceChildren('Acesso restrito à gestão.');
  const hoje = new Date(), ini = new Date(hoje.getTime() - 7 * 864e5);
  const c = tela('Auditoria', `<select id="f-tab"><option value="">Todas as tabelas</option>${TABELAS.map((t) => `<option>${t}</option>`).join('')}</select>
    <input id="f-user" placeholder="Usuário (id)" size="14">
    <input type="date" id="f-de" value="${ini.toISOString().slice(0, 10)}"><input type="date" id="f-ate" value="${hoje.toISOString().slice(0, 10)}">
    <input id="f-reg" placeholder="registro_id" size="14"><button class="btn primario" id="f-ver">Filtrar</button>`);
  let pagina = 0;

  const carregar = async () => {
    let q = sb.from('auditoria').select('id, user_id, tabela, registro_id, acao, dados, em', { count: 'exact' })
      .eq('clinica_id', estado.clinica.id)
      .gte('em', `${$('#f-de').value}T00:00:00`).lte('em', `${$('#f-ate').value}T23:59:59.999`)
      .order('em', { ascending: false }).order('id', { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if ($('#f-tab').value) q = q.eq('tabela', $('#f-tab').value);
    if ($('#f-user').value.trim()) q = q.eq('user_id', $('#f-user').value.trim());
    if ($('#f-reg').value.trim()) q = q.eq('registro_id', $('#f-reg').value.trim());
    const { data: ls, count, error } = await q;
    if (error) return falha(error, 'Auditoria');
    const total = count || 0, ultima = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);
    const detalhe = (l) => {
      const d = l.dados || {}, campos = d.campos || [];
      if (l.acao === 'LEITURA') return '<span class="muted">Leitura do registro (sem conteúdo)</span>';
      const ks = campos.length ? campos : Object.keys(d.depois || d.antes || {});
      return `<table style="width:100%"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
        ${ks.map((k) => `<tr><td>${esc(k)}</td><td>${esc(fmt(d.antes?.[k]))}</td><td>${esc(fmt(d.depois?.[k]))}</td></tr>`).join('')}</tbody></table>`;
    };
    $('#lista').innerHTML = ls.length ? `<div class="tabela-rolagem"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Tabela</th><th>Ação</th>
      <th>Registro</th><th>Campos alterados</th><th></th></tr></thead><tbody>
      ${ls.map((l) => `<tr><td>${quando(l.em)}</td><td class="muted" title="${esc(l.user_id)}">${esc((l.user_id || 'sistema').slice(0, 8))}</td>
        <td>${esc(l.tabela)}</td><td><span class="selo ${l.acao === 'DELETE' ? 'alerta' : 'outra'}">${esc(l.acao)}</span></td>
        <td class="muted" title="${esc(l.registro_id)}">${esc((l.registro_id || '').slice(0, 8))}</td>
        <td>${esc((l.dados?.campos || []).join(', '))}</td><td><a href="#" data-det="${l.id}" onclick="return false">ver</a></td></tr>
        <tr id="det-${l.id}" hidden><td colspan="7">${detalhe(l)}</td></tr>`).join('')}</tbody></table></div>
      <div class="linha-acoes"><button class="btn" id="ant" ${pagina ? '' : 'disabled'}>‹ Anterior</button>
        <span class="muted">Página ${pagina + 1} de ${ultima + 1} · ${total} evento(s)</span>
        <button class="btn" id="prox" ${pagina >= ultima ? 'disabled' : ''}>Próxima ›</button></div>`
      : '<div class="vazio">Nenhum evento no filtro.</div>';
    $$('[data-det]').forEach((a) => (a.onclick = () => { const r = $(`#det-${a.dataset.det}`); r.hidden = !r.hidden; }));
    $('#ant')?.addEventListener('click', () => { pagina--; carregar(); });
    $('#prox')?.addEventListener('click', () => { pagina++; carregar(); });
  };

  c.innerHTML = '<div class="cartao" id="lista"></div>';
  $('#f-ver').onclick = () => { pagina = 0; carregar(); };
  carregar();
}
