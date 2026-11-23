// Ficha completa do profissional (db/065 + 066): abas Dados (cadastro + pagamento, em caixas) · Notas fiscais.
// Gestão abre por #ficha-<id>[-aba] (Profissionais → Ficha); o profissional abre a própria por #cadastro[-aba].
// Dados bancários: só a gestora grava; o profissional vê os próprios e pede troca por solicitação.
// Nota fiscal: sem anexo (pesa no plano gratuito) — guarda número, emissão, valor e a chave de acesso para consultar no site do governo.
import { sb, estado, $, $$, esc, brl, data, tela, toast, falha, modal, confirmar, faltaBanco } from '../core.js';

const MIG = 'db/065_profissional_ficha.sql e db/066_nota_sem_arquivo.sql';
const ABAS = [['dados', 'Dados'], ['notas', 'Notas fiscais']];
const CONSULTA_NFSE = 'https://www.nfse.gov.br/ConsultaPublica';

export const hojeYM = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const somaMes = (ym, n) => { const [a, m] = ym.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const nomeMes = (ym) => new Date(ym + '-15T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
export const competenciaAnterior = () => somaMes(hojeYM(), -1);
export const limpaChave = (v) => String(v || '').replace(/[\s.\-]/g, '');

const TIPOS_CONTA = { corrente: 'Conta corrente', poupanca: 'Poupança', pagamento: 'Conta de pagamento' };
const TIPOS_PIX = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', celular: 'Celular', aleatoria: 'Chave aleatória' };
const SITUACAO = { aberta: ['alerta', 'Aberta'], atendida: ['ok', 'Atendida'], recusada: ['outra', 'Recusada'] };
const opcoes = (m, sel) => `<option value="">—</option>` + Object.entries(m).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('');
const dia = (v) => (v ? data(String(v).slice(0, 10)) : '');
const linha = (rot, val) => `<div><div class="muted" style="font-size:12.5px">${esc(rot)}</div><div>${val ? esc(val) : '<span class="muted">não informado</span>'}</div></div>`;
const caixa = (titulo, acoes, corpo) => `<div class="cartao"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
  <h3 style="margin:0">${esc(titulo)}</h3><div>${acoes || ''}</div></div>${corpo}</div>`;

export async function render(params = '') {
  const proprio = estado.perfil === 'profissional';
  const m = params.match(/^(.*?)(?:-?(dados|pagamento|notas))?$/);   // "pagamento" = antiga aba, agora dentro de Dados
  const profId = proprio ? estado.profissionalId : m[1];
  const aba = m[2] === 'notas' ? 'notas' : 'dados';
  const base = proprio ? '#cadastro' : `#ficha-${profId}`;
  const c = tela(proprio ? 'Meu cadastro' : 'Ficha do profissional', proprio ? '' : '<a class="btn" href="#profissionais">← Profissionais</a>');
  const { data: p, error } = await sb.from('profissionais').select('*').eq('id', profId).maybeSingle();
  if (error) return falha(error);
  if (!p) { c.innerHTML = '<div class="vazio">Profissional não encontrado.</div>'; return; }
  const ctx = { p, proprio, cid: estado.clinica.id, editaPagamento: !proprio && estado.perfilReal === 'gestor',
    editaCadastro: !proprio && ['gestor', 'financeiro'].includes(estado.perfilReal) };
  c.innerHTML = `<h3 style="margin:0 0 4px">${esc(p.nome)}</h3><p class="muted" style="margin:0 0 12px">${esc(p.especialidade || '')}</p>
    <nav class="abas">${ABAS.map(([k, n]) => `<a href="${base}-${k}" class="${k === aba ? 'ativa' : ''}">${n}</a>`).join('')}</nav><div id="aba-corpo"></div>`;
  const corpo = $('#aba-corpo', c);
  if (aba === 'dados') await abaDados(corpo, ctx); else await abaNotas(corpo, ctx);
}

async function abaDados(el, ctx) {
  const { p, proprio, cid, editaPagamento, editaCadastro } = ctx;
  const recarrega = () => render(proprio ? 'dados' : `${p.id}-dados`);
  const [r, s] = await Promise.all([
    sb.from('profissional_pagamento').select('*').eq('profissional_id', p.id).maybeSingle(),
    sb.from('profissional_pagamento_solicitacoes').select('*').eq('profissional_id', p.id).order('criado_em', { ascending: false }).limit(10)]);
  const erroTab = r.error || s.error;
  if (erroTab) { if (!faltaBanco(erroTab, el, MIG)) falha(erroTab); return; }
  const d = r.data || {}, sol = s.data || [];

  const cadastro = caixa('Cadastro', editaCadastro ? '<button class="btn pequeno" id="ed-cad">Editar</button>' : '',
    `<div class="grade-form">${linha('Nome', p.nome)}${linha('CPF', p.cpf)}${linha('Especialidade', p.especialidade)}
      ${linha('Conselho', [p.conselho, p.numero_conselho, p.uf_conselho].filter(Boolean).join(' '))}${linha('CBO', p.cbo)}
      ${linha('Situação', p.ativo ? 'Ativo' : 'Inativo')}</div>
     ${proprio ? '<p class="muted" style="margin:12px 0 0">Para corrigir algum dado do cadastro, fale com a gestão.</p>' : ''}`);

  const pagForm = `<div class="grade-form">${linha('Titular', d.titular)}${linha('CPF/CNPJ do titular', d.documento_titular)}${linha('Banco', d.banco)}
        ${linha('Agência', d.agencia)}${linha('Conta', d.conta)}${linha('Tipo de conta', TIPOS_CONTA[d.tipo_conta])}
        ${linha('Chave Pix', d.pix_chave ? `${TIPOS_PIX[d.pix_tipo] || 'Pix'}: ${d.pix_chave}` : '')}</div>`;
  const pagamento = caixa('Dados de pagamento', proprio ? '<button class="btn pequeno" id="troca">Solicitar troca de conta</button>' : (editaPagamento ? '<button class="btn pequeno" id="ed-pag">Editar</button>' : ''),
    `<p class="muted" style="margin-top:0">${proprio ? 'Conta onde a clínica deposita o seu repasse. Só a gestão altera; use “Solicitar troca de conta”.' : 'Conta onde a clínica paga o repasse deste profissional.'}</p>${pagForm}`);

  const pedidos = sol.length ? caixa('Pedidos de troca de conta', '', sol.map((x) => {
    const [cl, rot] = SITUACAO[x.situacao] || SITUACAO.aberta;
    return `<div style="padding:8px 0;border-top:1px solid var(--linha)"><span class="selo ${cl}">${rot}</span> <span class="muted">${dia(x.criado_em)}</span>
      <div style="white-space:pre-wrap;margin:4px 0">${esc(x.mensagem)}</div>${x.resposta ? `<div class="muted">Resposta: ${esc(x.resposta)}</div>` : ''}
      ${editaPagamento && (x.situacao || 'aberta') === 'aberta' ? `<button class="btn pequeno" data-res="atendida" data-id="${x.id}">Marcar como atendida</button>
        <button class="btn pequeno" data-res="recusada" data-id="${x.id}">Recusar</button>` : ''}</div>`;
  }).join('')) : '';
  el.innerHTML = cadastro + pagamento + pedidos;

  $('#ed-cad', el)?.addEventListener('click', async () => {
    const { abrirFormProfissional } = await import('./profissionais.js');   // import tardio: profissionais.js também importa este módulo
    abrirFormProfissional(p, recarrega);
  });
  $('#ed-pag', el)?.addEventListener('click', () => modal(`<h3>Editar dados de pagamento</h3>
    <form class="grade-form" id="f">
      <label>Titular da conta<input name="titular" value="${esc(d.titular)}"></label>
      <label>CPF/CNPJ do titular<input name="documento_titular" value="${esc(d.documento_titular)}"></label>
      <label>Banco<input name="banco" value="${esc(d.banco)}" placeholder="Código ou nome"></label>
      <label>Agência<input name="agencia" value="${esc(d.agencia)}"></label>
      <label>Conta (com dígito)<input name="conta" value="${esc(d.conta)}"></label>
      <label>Tipo de conta<select name="tipo_conta">${opcoes(TIPOS_CONTA, d.tipo_conta)}</select></label>
      <label>Tipo da chave Pix<select name="pix_tipo">${opcoes(TIPOS_PIX, d.pix_tipo)}</select></label>
      <label>Chave Pix<input name="pix_chave" value="${esc(d.pix_chave)}"></label></form>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="salvar">Salvar</button></div>`,
  (m, fechar) => ($('#salvar', m).onclick = async () => {
    const f = Object.fromEntries(new FormData($('#f', m)));
    for (const k of Object.keys(f)) f[k] = String(f[k]).trim() || null;
    const { error } = await sb.from('profissional_pagamento').upsert({ ...f, clinica_id: cid, profissional_id: p.id }, { onConflict: 'profissional_id' });
    if (error) return falha(error, 'Pagamento'); fechar(); toast('Dados de pagamento salvos.'); recarrega();
  })));
  $('#troca', el)?.addEventListener('click', () => modal(`<h3>Solicitar troca de conta</h3>
    <p class="muted">Descreva a nova conta ou chave Pix. A gestão confere e atualiza o cadastro. Não escreva senhas.</p>
    <label>Mensagem<textarea id="msg" rows="5" maxlength="1000" style="width:100%"></textarea></label>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="env">Enviar pedido</button></div>`,
  (m, fechar) => ($('#env', m).onclick = async () => {
    const mensagem = $('#msg', m).value.trim(); if (!mensagem) return toast('Escreva o que precisa ser trocado.', true);
    const { error } = await sb.from('profissional_pagamento_solicitacoes').insert({ clinica_id: cid, profissional_id: p.id, mensagem });
    if (error) return falha(error, 'Pedido'); fechar(); toast('Pedido enviado à gestão.'); recarrega();
  })));
  $$('[data-res]', el).forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from('profissional_pagamento_solicitacoes')
      .update({ situacao: b.dataset.res, resolvido_em: new Date().toISOString(), resolvido_por: estado.user.id }).eq('id', b.dataset.id);
    if (error) return falha(error, 'Pedido'); toast('Pedido atualizado.'); recarrega();
  }));
}

async function abaNotas(el, { p, proprio, cid }) {
  const { data: ns, error } = await sb.from('notas_profissional').select('*').eq('profissional_id', p.id).order('competencia', { ascending: false }).order('criado_em', { ascending: false });
  if (faltaBanco(error, el, MIG)) return; if (error) return falha(error);
  const ant = competenciaAnterior(), temAnt = ns.some((n) => n.competencia.slice(0, 7) === ant);
  const meses = Array.from({ length: 12 }, (_, i) => somaMes(hojeYM(), -i - 1));
  const recarrega = () => render(proprio ? 'notas' : `${p.id}-notas`);
  const consultar = async (chave) => {
    try { await navigator.clipboard.writeText(chave); toast('Chave copiada. Cole no campo do site do governo.'); } catch { toast('Copie a chave manualmente e cole no site.', true); }
    window.open(CONSULTA_NFSE, '_blank', 'noopener');
  };
  el.innerHTML = caixa('Nota fiscal do mês', '', `<p>${temAnt ? `<span class="selo ok">NF de ${esc(nomeMes(ant))} registrada</span>` : `<span class="selo alerta">NF de ${esc(nomeMes(ant))} pendente</span>`}
      <span class="muted"> — NF pendente só gera este alerta; não bloqueia o pagamento. O arquivo não é guardado aqui: registre a chave de acesso e consulte no site do governo quando precisar imprimir.</span></p>
    <form class="grade-form" id="f">
      <label>Competência (mês dos atendimentos)<select name="competencia">${meses.map((m) => `<option value="${m}">${esc(nomeMes(m))}</option>`).join('')}</select></label>
      <label>Nº da nota<input name="numero"></label>
      <label>Chave de acesso (NFS-e, 50 dígitos)<input name="chave" inputmode="numeric" placeholder="Cole a chave da nota"></label>
      <label>Data de emissão<input type="date" name="emissao"></label>
      <label>Valor da nota (R$)<input name="valor" inputmode="decimal" placeholder="opcional"></label></form>
    <div class="linha-acoes"><button class="btn primario" id="salvar">Registrar nota fiscal</button></div>`) +
    `<div class="cartao tabela-rolagem">${ns.length ? `<table><thead><tr><th>Competência</th><th>Nº</th><th>Emissão</th><th class="num">Valor</th><th>Chave de acesso</th><th></th></tr></thead><tbody>
      ${ns.map((n) => `<tr><td>${esc(nomeMes(n.competencia.slice(0, 7)))}</td><td>${esc(n.numero)}</td><td>${dia(n.data_emissao)}</td>
        <td class="num">${n.valor == null ? '' : brl(n.valor)}</td><td style="font-family:monospace;font-size:12px;word-break:break-all">${esc(n.chave_acesso)}</td>
        <td>${n.chave_acesso ? `<button class="btn pequeno" data-cons="${n.id}">Consultar no site do governo</button> ` : ''}<button class="btn pequeno" data-del="${n.id}">Excluir</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="vazio">Nenhuma nota registrada ainda.</div>'}</div>`;

  $('#salvar', el).onclick = async () => {
    const fd = new FormData($('#f', el)), chave = limpaChave(fd.get('chave')), numero = String(fd.get('numero') || '').trim();
    if (!chave && !numero) return toast('Informe o nº da nota ou a chave de acesso.', true);
    if (chave && !/^[0-9A-Za-z]{1,80}$/.test(chave)) return toast('Chave de acesso inválida: use só letras e números.', true);
    if (/^\d+$/.test(chave) && chave.length !== 50 && !(await confirmar(`A chave tem ${chave.length} dígitos (a da NFS-e nacional tem 50). Registrar assim mesmo?`, 'Registrar'))) return;
    const valor = String(fd.get('valor') || '').trim().replace(/\./g, '').replace(',', '.');
    if (valor && !Number.isFinite(Number(valor))) return toast('Valor da nota inválido.', true);
    const { error: e } = await sb.from('notas_profissional').insert({ clinica_id: cid, profissional_id: p.id, competencia: `${fd.get('competencia')}-01`,
      numero: numero || null, chave_acesso: chave || null, data_emissao: fd.get('emissao') || null, valor: valor ? Number(valor) : null });
    if (e) return falha(/duplicate|unique/i.test(e.message) ? { message: 'Esta chave de acesso já foi registrada.' } : e, 'Nota fiscal');
    toast('Nota fiscal registrada.'); recarrega();
  };
  $$('[data-cons]', el).forEach((b) => (b.onclick = () => consultar(ns.find((x) => x.id === b.dataset.cons).chave_acesso)));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
    const n = ns.find((x) => x.id === b.dataset.del);
    if (!(await confirmar(`Excluir o registro da nota de ${nomeMes(n.competencia.slice(0, 7))}?`, 'Excluir'))) return;
    const { error: e } = await sb.from('notas_profissional').delete().eq('id', n.id);
    if (e) return falha(e, 'Nota fiscal'); toast('Registro excluído.'); recarrega();
  }));
}
