// Entrada do app: login, menu por perfil e roteamento por #hash.
import { sb, estado, $, esc, toast, falha } from './core.js';
import * as painel from './modulos/painel.js';
import * as retornos from './modulos/retornos.js';
import * as contratos from './modulos/contratos.js';
import * as profissionais from './modulos/profissionais.js';
import * as repasse from './modulos/repasse.js';
import * as acessos from './modulos/acessos.js';
import * as extrato from './modulos/extrato.js';
import * as estatisticas from './modulos/estatisticas.js';
import * as pacientes from './modulos/pacientes.js';
import * as agenda from './modulos/agenda.js';
import * as paciente from './modulos/paciente.js';
import * as financeiro from './modulos/financeiro.js';
import * as lotes from './modulos/lotes.js';

// Cada módulo é independente: para mexer em um, só o arquivo dele muda.
const ROTAS = [
  { id: 'agenda', nome: 'Agenda', mod: agenda, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'] },
  { id: 'painel', nome: 'Painel', mod: painel, perfis: ['gestor', 'financeiro'] },
  { id: 'estatisticas', nome: 'Estatísticas', mod: estatisticas, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'] },
  { id: 'pacientes', nome: 'Pacientes', mod: pacientes, perfis: ['gestor', 'financeiro', 'recepcao'] },
  { id: 'paciente', nome: 'Paciente', mod: paciente, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'], oculto: true },
  { id: 'financeiro', nome: 'Financeiro', mod: financeiro, perfis: ['gestor', 'financeiro'] },
  { id: 'lotes', nome: 'Lotes TISS', mod: lotes, perfis: ['gestor', 'financeiro'] },
  { id: 'retornos', nome: 'Retornos e glosas', mod: retornos, perfis: ['gestor', 'financeiro'] },
  { id: 'contratos', nome: 'Convênios e contratos', mod: contratos, perfis: ['gestor', 'financeiro'] },
  { id: 'profissionais', nome: 'Profissionais', mod: profissionais, perfis: ['gestor', 'financeiro', 'recepcao'] },
  { id: 'repasse', nome: 'Tabela de repasse', mod: repasse, perfis: ['gestor', 'financeiro'] },
  { id: 'extrato', nome: 'Meu extrato', mod: extrato, perfis: ['profissional'] },
  { id: 'acessos', nome: 'Acessos', mod: acessos, perfis: ['gestor'] },
];

const PERFIL_NOME = { gestor: 'Gestora', financeiro: 'Financeiro', recepcao: 'Recepção', profissional: 'Profissional' };

async function iniciarSessao() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return mostrarLogin();
  estado.user = session.user;
  const { data: vinc, error } = await sb.from('usuarios_clinica')
    .select('perfil, profissional_id, clinicas(id, nome)').eq('user_id', session.user.id).eq('ativo', true).limit(1);
  if (error) return falha(error, 'Perfil');
  if (!vinc?.length) {
    mostrarLogin('Sua conta ainda não está vinculada a uma clínica. Peça um convite à gestora.', true);
    await sb.auth.signOut(); return;
  }
  estado.perfil = vinc[0].perfil; estado.profissionalId = vinc[0].profissional_id; estado.clinica = vinc[0].clinicas;
  $('#tela-login').hidden = true; $('#tela-app').hidden = false;
  $('#usuario-info').innerHTML = `<strong>${esc(estado.clinica.nome)}</strong><br>${esc(session.user.email)}<br>${PERFIL_NOME[estado.perfil]}`;
  montarMenu(); rotear();
}

function rotasDoPerfil() { return ROTAS.filter((r) => r.perfis.includes(estado.perfil)); }

function montarMenu() {
  $('#menu').innerHTML = rotasDoPerfil().filter((r) => !r.oculto).map((r) => `<a href="#${r.id}" data-r="${r.id}">${r.nome}</a>`).join('');
}

function rotear() {
  if (!estado.perfil) return;
  const disponiveis = rotasDoPerfil();
  const [id, ...params] = (location.hash.slice(1) || disponiveis[0].id).split('-');
  const rota = disponiveis.find((r) => r.id === id) || disponiveis[0];
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.r === (rota.id === 'paciente' ? 'pacientes' : rota.id)));
  rota.mod.render(params.join('-')).catch((e) => falha(e, rota.nome));
}

function mostrarLogin(msg = '', erro = false) {
  $('#tela-app').hidden = true; $('#tela-login').hidden = false;
  const m = $('#login-msg'); m.textContent = msg; m.className = 'msg' + (erro ? ' erro' : ' ok');
}

$('#form-login').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('senha') });
  if (error) return mostrarLogin(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message, true);
  iniciarSessao();
};

$('#lnk-primeiro').onclick = async (e) => {
  e.preventDefault();
  const f = new FormData($('#form-login'));
  if (!f.get('email') || String(f.get('senha')).length < 8)
    return mostrarLogin('Preencha o e-mail do convite e crie uma senha com 8+ caracteres, depois clique aqui.', true);
  const { error } = await sb.auth.signUp({ email: f.get('email'), password: f.get('senha'),
    options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) return mostrarLogin(error.message, true);
  mostrarLogin('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.');
};

$('#lnk-esqueci').onclick = async (e) => {
  e.preventDefault();
  const email = new FormData($('#form-login')).get('email');
  if (!email) return mostrarLogin('Digite seu e-mail primeiro.', true);
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  mostrarLogin(error ? error.message : 'Enviamos um link de redefinição para o seu e-mail.', !!error);
};

function pedirNovaSenha() {
  import('./core.js').then(({ modal }) => modal(`<h3>Nova senha</h3>
    <label>Senha (8+ caracteres)<input type="password" id="nova" minlength="8"></label>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="salvar">Salvar</button></div>`,
  (c, fechar) => { c.querySelector('#salvar').onclick = async () => {
    const nova = c.querySelector('#nova').value;
    if (nova.length < 8) return toast('Use 8 ou mais caracteres.', true);
    const { error } = await sb.auth.updateUser({ password: nova });
    toast(error ? error.message : 'Senha atualizada.', !!error); if (!error) fechar();
  }; }));
}
$('#btn-senha').onclick = pedirNovaSenha;

$('#btn-sair').onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };

sb.auth.onAuthStateChange(async (ev) => {
  if (ev === 'PASSWORD_RECOVERY') pedirNovaSenha();
});

window.addEventListener('hashchange', rotear);
iniciarSessao();
