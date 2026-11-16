// Entrada do app: login, menu por perfil e roteamento por #hash.
import { sb, estado, $, esc, toast, falha, temDoisModos, aplicarModo } from './core.js';
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
import * as prontuarios from './modulos/prontuario.js';
import * as auditoria from './modulos/auditoria.js';
import * as hoje from './modulos/hoje.js';
import * as espera from './modulos/espera.js';
import * as previsao from './modulos/previsao.js';
import * as glosas from './modulos/glosas-intel.js';
import { iniciarPaleta, abrirPaleta } from './modulos/paleta.js';
import { registrarPWA } from './pwa.js';

// Cada módulo é independente: para mexer em um, só o arquivo dele muda.
const ROTAS = [
  { id: 'hoje', nome: 'Hoje', mod: hoje, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'] },
  { id: 'agenda', nome: 'Agenda', mod: agenda, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'] },
  { id: 'espera', nome: 'Lista de espera', mod: espera, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'] },
  { id: 'painel', nome: 'Painel', mod: painel, perfis: ['gestor', 'financeiro'] },
  { id: 'estatisticas', nome: 'Estatísticas', mod: estatisticas, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'] },
  { id: 'prontuarios', nome: 'Meus prontuários', mod: prontuarios, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'], precisaProf: true },
  { id: 'pacientes', nome: 'Pacientes', mod: pacientes, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'] },
  { id: 'paciente', nome: 'Paciente', mod: paciente, perfis: ['gestor', 'financeiro', 'recepcao', 'profissional'], oculto: true },
  { id: 'financeiro', nome: 'Financeiro', mod: financeiro, perfis: ['gestor', 'financeiro'] },
  { id: 'previsao', nome: 'Previsão de caixa', mod: previsao, perfis: ['gestor', 'financeiro'] },
  { id: 'lotes', nome: 'Lotes TISS', mod: lotes, perfis: ['gestor', 'financeiro'] },
  { id: 'retornos', nome: 'Retornos e glosas', mod: retornos, perfis: ['gestor', 'financeiro'] },
  { id: 'glosas', nome: 'Inteligência de glosas', mod: glosas, perfis: ['gestor', 'financeiro'] },
  { id: 'contratos', nome: 'Convênios e contratos', mod: contratos, perfis: ['gestor', 'financeiro'] },
  { id: 'profissionais', nome: 'Profissionais', mod: profissionais, perfis: ['gestor', 'financeiro', 'recepcao'] },
  { id: 'repasse', nome: 'Tabela de repasse', mod: repasse, perfis: ['gestor', 'financeiro'] },
  { id: 'extrato', nome: 'Meu extrato', mod: extrato, perfis: ['profissional'] },
  { id: 'acessos', nome: 'Acessos', mod: acessos, perfis: ['gestor'] },
  { id: 'auditoria', nome: 'Auditoria', mod: auditoria, perfis: ['gestor'] },
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
  estado.perfilReal = vinc[0].perfil; estado.profissionalId = vinc[0].profissional_id; estado.clinica = vinc[0].clinicas;
  let salvo = 'gestao'; try { salvo = localStorage.getItem('modo_' + session.user.id) || 'gestao'; } catch {}
  aplicarModo(salvo);
  $('#tela-login').hidden = true; $('#tela-app').hidden = false;
  montarChaveModo(); montarMenu(); rotear();
  iniciarPaleta({ rotas: () => rotasDoPerfil().filter((r) => !r.oculto).map((r) => ({ id: r.id, nome: r.nome })) });
  $('#btn-buscar').onclick = () => abrirPaleta();
}

function infoUsuario() {
  $('#usuario-info').innerHTML = `<strong>${esc(estado.clinica.nome)}</strong><br>${esc(estado.user.email)}<br>${PERFIL_NOME[estado.perfilReal]}`;
}

// Chave Gestão ↔ Profissional: só para quem gere e também atende
function montarChaveModo() {
  infoUsuario();
  const el = $('#chave-modo');
  if (!temDoisModos()) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = ['gestao', 'profissional'].map((m) => `<button type="button" data-modo="${m}" class="${estado.modo === m ? 'ativo' : ''}">${m === 'gestao' ? 'Gestão' : 'Profissional'}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    if (b.dataset.modo === estado.modo) return;
    aplicarModo(b.dataset.modo); montarChaveModo(); montarMenu();
    const id = location.hash.slice(1).split('-')[0];
    if (!rotasDoPerfil().some((r) => r.id === id)) location.hash = rotasDoPerfil()[0].id; else rotear();
    toast(estado.modo === 'gestao' ? 'Modo gestão: financeiro, faturamento e cadastros.' : 'Modo profissional: sua agenda, pacientes e prontuário.');
  }));
}

function rotasDoPerfil() { return ROTAS.filter((r) => r.perfis.includes(estado.perfil) && (!r.precisaProf || estado.profissionalId)); }

function montarMenu() {
  $('#menu').innerHTML = rotasDoPerfil().filter((r) => !r.oculto).map((r) => `<a href="#${r.id}" data-r="${r.id}">${r.nome}</a>`).join('');
}

function rotear() {
  if (!estado.perfil) return;
  const disponiveis = rotasDoPerfil();
  const [id, ...params] = (location.hash.slice(1) || disponiveis[0].id).split('-');
  const rota = disponiveis.find((r) => r.id === id) || disponiveis[0];
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.r === (rota.id === 'paciente' ? (location.hash.includes('-prontuario') && estado.profissionalId ? 'prontuarios' : 'pacientes') : rota.id)));
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
  if (error) return mostrarLogin(/CONVITE_OBRIGATORIO|Database error saving new user/i.test(error.message)
    ? 'Este e-mail não tem convite da clínica. Peça o convite à gestora (use o mesmo e-mail).' : error.message, true);
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
registrarPWA();
iniciarSessao();
