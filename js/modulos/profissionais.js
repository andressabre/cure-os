// Módulo Profissionais: cadastro da equipe (dados exigidos na guia TISS).
import { sb, estado, $, $$, esc, tela, toast, falha, modal, podeGerir } from '../core.js';

export async function render() {
  const c = tela('Profissionais', podeGerir() || estado.perfil === 'recepcao' ? '<button class="btn primario" id="novo">+ Profissional</button>' : '');
  const { data: ps, error } = await sb.from('profissionais').select('*').eq('clinica_id', estado.clinica.id).order('nome');
  if (error) return falha(error);
  c.innerHTML = `<div class="cartao tabela-rolagem"><table>
    <thead><tr><th>Nome</th><th>Especialidade</th><th>Conselho</th><th>CBO</th><th>Notificações</th><th>Situação</th><th></th></tr></thead><tbody>
    ${ps.map((p) => `<tr><td><strong>${esc(p.nome)}</strong></td><td>${esc(p.especialidade)}</td>
      <td>${esc([p.conselho, p.numero_conselho, p.uf_conselho].filter(Boolean).join(' '))}</td><td>${esc(p.cbo)}</td>
      <td>${p.notificacoes_ativas ? 'Ativas' : 'Desligadas'}</td>
      <td>${p.ativo ? '<span class="selo ok">Ativo</span>' : '<span class="selo outra">Inativo</span>'}</td>
      <td><button class="btn pequeno" data-ed="${p.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum profissional cadastrado.</td></tr>'}
    </tbody></table></div>`;

  const form = (p = { ativo: true, notificacoes_ativas: true }) => modal(`<h3>${p.id ? 'Editar' : 'Novo'} profissional</h3>
    <form class="grade-form" id="f">
      <label>Nome completo<input name="nome" required value="${esc(p.nome)}"></label>
      <label>CPF<input name="cpf" value="${esc(p.cpf)}"></label>
      <label>Especialidade<input name="especialidade" value="${esc(p.especialidade)}" placeholder="Nutrição, Fisioterapia…"></label>
      <label>Conselho<select name="conselho">${['', 'CRN', 'CREFITO', 'CRP', 'CRM', 'CREF'].map((x) => `<option ${p.conselho === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Nº do conselho<input name="numero_conselho" value="${esc(p.numero_conselho)}"></label>
      <label>UF<input name="uf_conselho" maxlength="2" value="${esc(p.uf_conselho)}"></label>
      <label>CBO<input name="cbo" value="${esc(p.cbo)}"></label>
      <label><span><input type="checkbox" name="notificacoes_ativas" ${p.notificacoes_ativas ? 'checked' : ''}> Recebe notificações</span></label>
      <label><span><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativo</span></label>
    </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
  (m, fechar) => ($('#s', m).onclick = async () => {
    const fd = new FormData($('#f', m)); const f = Object.fromEntries(fd);
    f.ativo = fd.has('ativo'); f.notificacoes_ativas = fd.has('notificacoes_ativas');
    f.uf_conselho = (f.uf_conselho || '').toUpperCase() || null;
    if (!f.nome) return toast('Informe o nome.', true);
    const q = p.id ? sb.from('profissionais').update(f).eq('id', p.id) : sb.from('profissionais').insert({ ...f, clinica_id: estado.clinica.id });
    const { error: e } = await q; if (e) return falha(e); fechar(); toast('Salvo.'); render();
  }));

  $('#novo')?.addEventListener('click', () => form());
  $$('[data-ed]', c).forEach((b) => (b.onclick = () => form(ps.find((p) => p.id === b.dataset.ed))));
}
