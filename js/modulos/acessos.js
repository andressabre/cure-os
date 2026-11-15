// Módulo Acessos (só gestor). Desde 15/11/2026 a gestora cria e edita o acesso completo — nome, e-mail (= login), senha, perfil,
// profissional vinculado e ativo/desativado — pela Edge Function `gerir-acesso` (a chave de serviço fica só no servidor).
// O convite por e-mail continua disponível (a pessoa cria a própria senha em "Primeiro acesso").
import { sb, estado, $, $$, esc, data, tela, toast, falha, modal, confirmar } from '../core.js';

const PERFIS = { gestor: 'Gestora (acesso total)', financeiro: 'Financeiro', recepcao: 'Recepção', profissional: 'Profissional' };
const PERFIL_CURTO = { gestor: 'Gestora', financeiro: 'Financeiro', recepcao: 'Recepção', profissional: 'Profissional' };
const O_QUE_VE = {   // espelha os perfis das rotas em main.js
  gestor: 'Tudo: agenda, painel, pacientes, convênios e contratos, lotes TISS, retornos e glosas, financeiro, repasse, estatísticas, acessos e auditoria.',
  financeiro: 'Agenda, painel, pacientes, convênios e contratos, lotes TISS, retornos e glosas, financeiro, repasse e estatísticas.',
  recepcao: 'Agenda, pacientes (cadastro, autorizações e guias), profissionais e estatísticas; não vê financeiro nem repasse.',
  profissional: 'A própria agenda, a ficha dos próprios pacientes, o próprio prontuário, estatísticas e o próprio extrato de repasse.',
};
const dh = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const linkSistema = () => location.href.replace(/[#?].*$/, '');

async function chamar(corpo) {
  const { data: r, error } = await sb.functions.invoke('gerir-acesso', { body: { clinica_id: estado.clinica.id, ...corpo } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).erro || msg; } catch { /* resposta sem corpo */ }
    throw new Error(msg);
  }
  if (r?.erro) throw new Error(r.erro);
  return r;
}
function gerarSenha() {   // 10 caracteres sem ambíguos (0/O, 1/l/I) + 2 dígitos
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', D = '23456789', r = new Uint32Array(12);
  crypto.getRandomValues(r);
  return Array.from(r, (n, i) => (i < 10 ? A[n % A.length] : D[n % D.length])).join('');
}
const camposPerfil = (perfil, profId, profs, travado) => `
  <label>Perfil<select name="perfil" ${travado ? 'disabled' : ''}>${Object.entries(PERFIS).map(([k, v]) => `<option value="${k}" ${k === perfil ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
  <label>Profissional vinculado<select name="profissional_id"><option value="">— nenhum —</option>
    ${profs.map((p) => `<option value="${p.id}" ${p.id === profId ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
    <small class="muted">Obrigatório para Profissional. A gestora que também atende escolhe o próprio cadastro aqui (agenda e prontuário dela).</small></label>
  <p class="muted" id="ve" style="grid-column:1/-1"></p>`;
function ligarPerfil(m) {
  const sel = $('[name=perfil]', m), ve = $('#ve', m);
  const mostra = () => (ve.innerHTML = `<strong>O que este perfil vê:</strong> ${esc(O_QUE_VE[sel.value])}`);
  sel.addEventListener('change', mostra); mostra();
}
const campoSenha = (rotulo, obrig) => `<label style="grid-column:1/-1">${rotulo}
  <span style="display:flex;gap:6px"><input name="senha" type="text" minlength="8" autocomplete="new-password" ${obrig ? 'required' : ''} placeholder="${obrig ? 'mínimo 8 caracteres' : 'deixe em branco para manter'}">
  <button type="button" class="btn" id="gerar">Gerar</button></span></label>`;

function mensagemAcesso(nome, email, senha) {
  return `Olá${nome ? ', ' + nome.split(/\s+/)[0] : ''}! Seu acesso ao Cure OS:\n${linkSistema()}\nLogin: ${email}\nSenha provisória: ${senha}\n`
    + 'No primeiro acesso, troque a senha em "Alterar senha" (menu lateral).';
}
function mostrarCredenciais(nome, email, senha, aoFechar) {
  const txt = mensagemAcesso(nome, email, senha);
  modal(`<h3>✅ Acesso pronto</h3><p>Você já pode entrar com este login para testar (use uma janela anônima para não sair da sua conta).</p>
    <textarea id="msg" rows="6" style="width:100%" readonly>${esc(txt)}</textarea>
    <p class="muted">A senha não fica guardada no sistema: copie agora. Se perder, gere outra em Editar.</p>
    <div class="linha-acoes"><button class="btn" id="cp">Copiar mensagem</button><button class="btn primario" id="ok">Fechar</button></div>`, (m, fechar) => {
    $('#cp', m).onclick = async () => { try { await navigator.clipboard.writeText(txt); toast('Mensagem copiada.'); } catch { $('#msg', m).select(); toast('Selecione e copie com Ctrl+C.'); } };
    $('#ok', m).onclick = () => { fechar(); aoFechar(); };
  });
}

export async function render() {
  const c = tela('Acessos', '<button class="btn" id="conv">Convidar por e-mail</button><button class="btn primario" id="novo">+ Novo acesso</button>');
  const cid = estado.clinica.id;
  const [{ data: convs, error }, { data: profs }, lista] = await Promise.all([
    sb.from('convites').select('*, profissionais(nome)').eq('clinica_id', cid).is('usado_em', null).order('criado_em', { ascending: false }),
    sb.from('profissionais').select('id, nome').eq('clinica_id', cid).eq('ativo', true).order('nome'),
    chamar({ acao: 'listar' }).catch((e) => ({ erro: e.message })),
  ]);
  if (error) return falha(error);
  const us = (lista.usuarios || []).sort((a, b) => Number(b.ativo) - Number(a.ativo) || (a.nome || a.email).localeCompare(b.nome || b.email));
  c.innerHTML = `<div class="dica"><strong>A gestora tem acesso total ao Cure OS</strong> — todas as telas, inclusive esta, onde cria e edita o login (e-mail),
      a senha, o perfil e o vínculo de cada pessoa, e pode testar o acesso antes de liberar oficialmente.
      Exceção por lei e por desenho: o <strong>prontuário</strong> é sigiloso — cada profissional, inclusive a gestora, vê só o que ele mesmo registrou.</div>
    ${lista.erro ? `<div class="cartao vazio">Não consegui carregar a lista de acessos: ${esc(lista.erro)}</div>` : `
    <div class="cartao"><h4 style="margin-bottom:8px">Pessoas com acesso (${us.length})</h4><table class="tabela"><thead><tr><th>Nome</th><th>Login (e-mail)</th><th>Perfil</th><th>Profissional</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead><tbody>
    ${us.map((u) => `<tr${u.ativo ? '' : ' class="muted"'}><td>${esc(u.nome || '—')}${u.eu ? ' <span class="selo clinica">você</span>' : ''}</td><td>${esc(u.email)}</td>
      <td>${PERFIL_CURTO[u.perfil] || esc(u.perfil)}</td><td>${esc(u.profissional || '—')}</td>
      <td>${u.ativo ? '<span class="selo ok">Ativo</span>' : '<span class="selo alerta">Desativado</span>'}</td><td>${u.ultimo_acesso ? dh(u.ultimo_acesso) : '<span class="muted">nunca entrou</span>'}</td>
      <td><button class="btn pequeno" data-ed="${u.user_id}">Editar</button></td></tr>`).join('')}
    </tbody></table></div>`}
    ${convs?.length ? `<div class="cartao"><h4 style="margin-bottom:8px">Convites por e-mail aguardando cadastro (${convs.length})</h4><table class="tabela"><thead><tr><th>E-mail</th><th>Perfil</th><th>Profissional</th><th>Convidado em</th><th></th></tr></thead><tbody>
    ${convs.map((v) => `<tr><td>${esc(v.email)}</td><td>${PERFIL_CURTO[v.perfil]}</td><td>${esc(v.profissionais?.nome || '—')}</td><td>${data(v.criado_em.slice(0, 10))}</td>
      <td><button class="btn pequeno" data-cria="${v.id}">Criar com senha</button> <button class="btn pequeno" data-del="${v.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;

  const novo = (pre = {}) => modal(`<h3>Novo acesso</h3><p class="muted">O e-mail é o login. A conta já nasce confirmada — não depende de e-mail chegar.</p>
    <form class="grade-form" id="f" autocomplete="off">
      <label>Nome<input name="nome" value="${esc(pre.nome || '')}"></label>
      <label>E-mail (login)<input name="email" type="email" required value="${esc(pre.email || '')}"></label>
      ${campoSenha('Senha provisória', true)}
      ${camposPerfil(pre.perfil || 'profissional', pre.profissional_id || '', profs || [], false)}
    </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Criar acesso</button></div>`, (m, fechar) => {
    ligarPerfil(m);
    $('#gerar', m).onclick = () => ($('[name=senha]', m).value = gerarSenha());
    $('[name=profissional_id]', m).onchange = (e) => { const p = profs.find((x) => x.id === e.target.value); if (p && !$('[name=nome]', m).value) $('[name=nome]', m).value = p.nome; };
    $('#s', m).onclick = async () => {
      const f = Object.fromEntries(new FormData($('#f', m)));
      if (!f.email || !f.senha) return toast('Informe e-mail e senha.', true);
      if (f.senha.length < 8) return toast('A senha precisa de pelo menos 8 caracteres.', true);
      if (f.perfil === 'profissional' && !f.profissional_id) return toast('Escolha o profissional vinculado.', true);
      $('#s', m).disabled = true;
      try {
        const r = await chamar({ acao: 'criar', ...f, profissional_id: f.profissional_id || null });
        fechar();
        if (r.ja_existia) { toast(r.aviso); return render(); }
        mostrarCredenciais(f.nome, f.email.trim().toLowerCase(), f.senha, render);
      } catch (e) { $('#s', m).disabled = false; falha(e, 'Criar acesso'); }
    };
  });

  const editar = (u) => modal(`<h3>Editar acesso${u.eu ? ' (você)' : ''}</h3>
    <form class="grade-form" id="f" autocomplete="off">
      <label>Nome<input name="nome" value="${esc(u.nome || '')}"></label>
      <label>E-mail (login)<input name="email" type="email" value="${esc(u.email)}"></label>
      ${campoSenha('Nova senha', false)}
      ${camposPerfil(u.perfil, u.profissional_id || '', profs || [], u.eu)}
      <label style="grid-column:1/-1"><span><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''} ${u.eu ? 'disabled' : ''}> Acesso ativo</span>
        <small class="muted">Desativar bloqueia o login na hora; o histórico (agenda, prontuário, auditoria) é mantido.</small></label>
    </form>${u.eu ? '<p class="muted">Você não pode tirar o seu próprio perfil de gestora nem se desativar (evita trancar a clínica sem gestão).</p>' : ''}
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`, (m, fechar) => {
    ligarPerfil(m);
    $('#gerar', m).onclick = () => ($('[name=senha]', m).value = gerarSenha());
    $('#s', m).onclick = async () => {
      const fd = new FormData($('#f', m)), f = Object.fromEntries(fd);
      const perfil = u.eu ? u.perfil : f.perfil, ativo = u.eu ? true : fd.has('ativo');
      if (perfil === 'profissional' && !f.profissional_id) return toast('Escolha o profissional vinculado.', true);
      if (f.senha && f.senha.length < 8) return toast('A senha precisa de pelo menos 8 caracteres.', true);
      const email = (f.email || '').trim().toLowerCase();
      const corpo = { acao: 'editar', user_id: u.user_id, nome: f.nome, perfil, ativo, profissional_id: f.profissional_id || null,
        ...(email && email !== u.email ? { email } : {}), ...(f.senha ? { senha: f.senha } : {}) };
      if (u.ativo && !ativo && !(await confirmar(`Desativar o acesso de ${u.nome || u.email}? O login para de funcionar na hora.`, 'Desativar'))) return;
      try {
        await chamar(corpo); fechar();
        if (f.senha) mostrarCredenciais(f.nome, email || u.email, f.senha, render);
        else { toast('Acesso atualizado.'); render(); }
      } catch (e) { falha(e, 'Editar acesso'); }
    };
  });

  $('#novo').onclick = () => novo();
  $$('[data-ed]', c).forEach((b) => (b.onclick = () => editar(us.find((u) => u.user_id === b.dataset.ed))));
  $$('[data-cria]', c).forEach((b) => (b.onclick = () => novo(convs.find((v) => v.id === b.dataset.cria))));
  $$('[data-del]', c).forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('Excluir este convite pendente?', 'Excluir'))) return;
    const { error: e } = await sb.from('convites').delete().eq('id', b.dataset.del);
    if (e) return falha(e); toast('Convite excluído.'); render();
  }));

  $('#conv').onclick = () => modal(`<h3>Convidar por e-mail</h3><p class="muted">A pessoa abre o sistema, clica em <strong>Primeiro acesso</strong> e cria a própria senha com este e-mail.</p>
    <form class="grade-form" id="f"><label>E-mail<input name="email" type="email" required></label>
    ${camposPerfil('profissional', '', profs || [], false)}</form>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Convidar</button></div>`,
  (m, fechar) => { ligarPerfil(m); $('#s', m).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#f', m)));
    if (!f.email) return toast('Informe o e-mail.', true);
    if (f.perfil === 'profissional' && !f.profissional_id) return toast('Escolha o profissional vinculado.', true);
    const { error: e } = await sb.from('convites').insert({ clinica_id: cid, email: f.email.trim().toLowerCase(), perfil: f.perfil, profissional_id: f.profissional_id || null });
    if (e) return falha(e); fechar(); toast('Convite criado. Avise a pessoa para fazer o primeiro acesso.'); render();
  }; });
}
