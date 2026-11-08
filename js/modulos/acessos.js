// Módulo Acessos: a gestora convida pessoas por e-mail com um perfil. Ao criar a conta, o vínculo é automático.
import { sb, estado, $, esc, data, tela, toast, falha, modal } from '../core.js';

const PERFIS = { gestor: 'Gestora', financeiro: 'Financeiro', recepcao: 'Recepção', profissional: 'Profissional' };

export async function render() {
  const c = tela('Acessos', '<button class="btn primario" id="conv">+ Convidar</button>');
  const cid = estado.clinica.id;
  const [{ data: convs, error }, { data: profs }] = await Promise.all([
    sb.from('convites').select('*, profissionais(nome)').eq('clinica_id', cid).order('criado_em', { ascending: false }),
    sb.from('profissionais').select('id, nome').eq('clinica_id', cid).eq('ativo', true).order('nome'),
  ]);
  if (error) return falha(error);
  c.innerHTML = `<div class="dica">Convide pelo e-mail. A pessoa abre o sistema, clica em <strong>Primeiro acesso</strong>,
    cria a senha com o mesmo e-mail e já entra com o perfil certo. Profissionais veem só os próprios pacientes e o próprio repasse.</div>
    <div class="cartao"><table><thead><tr><th>E-mail</th><th>Perfil</th><th>Profissional vinculado</th><th>Convidado em</th><th>Situação</th></tr></thead><tbody>
    ${convs.map((v) => `<tr><td>${esc(v.email)}</td><td>${PERFIS[v.perfil]}</td><td>${esc(v.profissionais?.nome || '—')}</td>
      <td>${data(v.criado_em.slice(0, 10))}</td><td>${v.usado_em ? '<span class="selo ok">Ativo</span>' : '<span class="selo pendente">Aguardando cadastro</span>'}</td></tr>`).join('')}
    </tbody></table></div>`;

  $('#conv').onclick = () => modal(`<h3>Convidar acesso</h3><form class="grade-form" id="f">
    <label>E-mail<input name="email" type="email" required></label>
    <label>Perfil<select name="perfil" id="perfil">${Object.entries(PERFIS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label>Profissional (obrigatório p/ perfil Profissional)<select name="profissional_id"><option value="">—</option>
      ${profs.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
    </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Convidar</button></div>`,
  (m, fechar) => ($('#s', m).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#f', m)));
    if (!f.email) return toast('Informe o e-mail.', true);
    if (f.perfil === 'profissional' && !f.profissional_id) return toast('Escolha o profissional vinculado.', true);
    const { error: e } = await sb.from('convites').insert({ clinica_id: cid, email: f.email.trim().toLowerCase(),
      perfil: f.perfil, profissional_id: f.profissional_id || null });
    if (e) return falha(e); fechar(); toast('Convite criado. Avise a pessoa para fazer o primeiro acesso.'); render();
  }));
}
