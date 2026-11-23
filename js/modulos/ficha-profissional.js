// Ficha completa do profissional (db/065): Dados · Pagamento · Notas fiscais.
// Gestão abre por #ficha-<id>[-aba] (Profissionais → Ficha); o profissional abre a própria por #cadastro[-aba].
// Dados bancários: só a gestora grava; o profissional vê os próprios e pede troca por solicitação. NF faltando = só alerta.
import { sb, estado, $, $$, esc, brl, data, tela, toast, falha, modal, confirmar, faltaBanco } from '../core.js';

const MIG = 'db/065_profissional_ficha.sql';
const ABAS = [['dados', 'Dados'], ['pagamento', 'Pagamento'], ['notas', 'Notas fiscais']];

export const hojeYM = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const somaMes = (ym, n) => { const [a, m] = ym.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const nomeMes = (ym) => new Date(ym + '-15T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
export const competenciaAnterior = () => somaMes(hojeYM(), -1);

const TIPOS_CONTA = { corrente: 'Conta corrente', poupanca: 'Poupança', pagamento: 'Conta de pagamento' };
const TIPOS_PIX = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', celular: 'Celular', aleatoria: 'Chave aleatória' };
const SITUACAO = { aberta: ['alerta', 'Aberta'], atendida: ['ok', 'Atendida'], recusada: ['outra', 'Recusada'] };
const opcoes = (m, sel) => `<option value="">—</option>` + Object.entries(m).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('');
const dia = (v) => (v ? data(String(v).slice(0, 10)) : '');
const linha = (rot, val) => `<div><div class="muted" style="font-size:12.5px">${esc(rot)}</div><div>${val ? esc(val) : '<span class="muted">não informado</span>'}</div></div>`;

export async function render(params = '') {
  const proprio = estado.perfil === 'profissional';
  const m = params.match(/^(.*?)(?:-?(dados|pagamento|notas))?$/);   // <id>[-aba] (gestão) ou só a aba (profissional)
  const profId = proprio ? estado.profissionalId : m[1];
  const aba0 = m[2] || 'dados';
  const aba = ABAS.some(([k]) => k === aba0) ? aba0 : 'dados';
  const base = proprio ? '#cadastro' : `#ficha-${profId}`;
  const c = tela(proprio ? 'Meu cadastro' : 'Ficha do profissional', proprio ? '' : '<a class="btn" href="#profissionais">← Profissionais</a>');
  const { data: p, error } = await sb.from('profissionais').select('*').eq('id', profId).maybeSingle();
  if (error) return falha(error);
  if (!p) { c.innerHTML = '<div class="vazio">Profissional não encontrado.</div>'; return; }
  const ctx = { p, proprio, cid: estado.clinica.id, editaPagamento: !proprio && estado.perfilReal === 'gestor' };
  c.innerHTML = `<h3 style="margin:0 0 4px">${esc(p.nome)}</h3><p class="muted" style="margin:0 0 12px">${esc(p.especialidade || '')}</p>
    <nav class="abas">${ABAS.map(([k, n]) => `<a href="${base}-${k}" class="${k === aba ? 'ativa' : ''}">${n}</a>`).join('')}</nav><div id="aba-corpo"></div>`;
  const corpo = $('#aba-corpo', c);
  if (aba === 'dados') abaDados(corpo, ctx); else if (aba === 'pagamento') await abaPagamento(corpo, ctx); else await abaNotas(corpo, ctx);
}

function abaDados(el, { p, proprio }) {
  el.innerHTML = `<div class="cartao"><div class="grade-form">
    ${linha('Nome', p.nome)}${linha('CPF', p.cpf)}${linha('Especialidade', p.especialidade)}
    ${linha('Conselho', [p.conselho, p.numero_conselho, p.uf_conselho].filter(Boolean).join(' '))}${linha('CBO', p.cbo)}
    ${linha('Situação', p.ativo ? 'Ativo' : 'Inativo')}</div>
    <p class="muted" style="margin:14px 0 0">${proprio ? 'Para corrigir algum dado, fale com a gestão.' : 'Para alterar estes dados use Editar na lista de Profissionais.'}</p></div>`;
}

async function abaPagamento(el, { p, proprio, cid, editaPagamento }) {
  const [r, s] = await Promise.all([
    sb.from('profissional_pagamento').select('*').eq('profissional_id', p.id).maybeSingle(),
    sb.from('profissional_pagamento_solicitacoes').select('*').eq('profissional_id', p.id).order('criado_em', { ascending: false }).limit(10)]);
  if (faltaBanco(r.error || s.error, el, MIG)) return;
  if (r.error || s.error) return falha(r.error || s.error);
  const d = r.data || {}, sol = s.data || [];
  const dados = editaPagamento
    ? `<form class="grade-form" id="f">
        <label>Titular da conta<input name="titular" value="${esc(d.titular)}"></label>
        <label>CPF/CNPJ do titular<input name="documento_titular" value="${esc(d.documento_titular)}"></label>
        <label>Banco<input name="banco" value="${esc(d.banco)}" placeholder="Código ou nome"></label>
        <label>Agência<input name="agencia" value="${esc(d.agencia)}"></label>
        <label>Conta (com dígito)<input name="conta" value="${esc(d.conta)}"></label>
        <label>Tipo de conta<select name="tipo_conta">${opcoes(TIPOS_CONTA, d.tipo_conta)}</select></label>
        <label>Tipo da chave Pix<select name="pix_tipo">${opcoes(TIPOS_PIX, d.pix_tipo)}</select></label>
        <label>Chave Pix<input name="pix_chave" value="${esc(d.pix_chave)}"></label></form>
        <div class="linha-acoes"><button class="btn primario" id="salvar">Salvar dados de pagamento</button></div>`
    : `<div class="grade-form">${linha('Titular', d.titular)}${linha('CPF/CNPJ do titular', d.documento_titular)}${linha('Banco', d.banco)}
        ${linha('Agência', d.agencia)}${linha('Conta', d.conta)}${linha('Tipo de conta', TIPOS_CONTA[d.tipo_conta])}
        ${linha('Chave Pix', d.pix_chave ? `${TIPOS_PIX[d.pix_tipo] || 'Pix'}: ${d.pix_chave}` : '')}</div>
      ${proprio ? '<div class="linha-acoes"><button class="btn" id="troca">Solicitar troca de conta</button></div>' : ''}`;
  el.innerHTML = `<div class="cartao"><h3 style="margin-top:0">Conta para recebimento</h3>
    <p class="muted">${proprio ? 'Conta onde a clínica deposita o seu repasse. Só a gestão altera; use “Solicitar troca”.' : 'Conta onde a clínica paga o repasse deste profissional.'}</p>${dados}</div>
    ${sol.length ? `<div class="cartao"><h3 style="margin-top:0">Pedidos de troca</h3>${sol.map((x) => `<div style="padding:8px 0;border-top:1px solid var(--linha)">
      <span class="selo ${(SITUACAO[x.situacao] || SITUACAO.aberta)[0]}">${(SITUACAO[x.situacao] || SITUACAO.aberta)[1]}</span> <span class="muted">${dia(x.criado_em)}</span>
      <div style="white-space:pre-wrap;margin:4px 0">${esc(x.mensagem)}</div>${x.resposta ? `<div class="muted">Resposta: ${esc(x.resposta)}</div>` : ''}
      ${editaPagamento && (x.situacao || 'aberta') === 'aberta' ? `<button class="btn pequeno" data-res="atendida" data-id="${x.id}">Marcar como atendida</button>
        <button class="btn pequeno" data-res="recusada" data-id="${x.id}">Recusar</button>` : ''}</div>`).join('')}</div>` : ''}`;

  $('#salvar', el)?.addEventListener('click', async () => {
    const f = Object.fromEntries(new FormData($('#f', el)));
    for (const k of Object.keys(f)) f[k] = String(f[k]).trim() || null;
    const { error } = await sb.from('profissional_pagamento').upsert({ ...f, clinica_id: cid, profissional_id: p.id }, { onConflict: 'profissional_id' });
    if (error) return falha(error, 'Pagamento'); toast('Dados de pagamento salvos.'); render(`${p.id}-pagamento`);
  });
  $('#troca', el)?.addEventListener('click', () => modal(`<h3>Solicitar troca de conta</h3>
    <p class="muted">Descreva a nova conta ou chave Pix. A gestão confere e atualiza o cadastro. Não escreva senhas.</p>
    <label>Mensagem<textarea id="msg" rows="5" maxlength="1000" style="width:100%"></textarea></label>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="env">Enviar pedido</button></div>`,
  (m, fechar) => ($('#env', m).onclick = async () => {
    const mensagem = $('#msg', m).value.trim(); if (!mensagem) return toast('Escreva o que precisa ser trocado.', true);
    const { error } = await sb.from('profissional_pagamento_solicitacoes').insert({ clinica_id: cid, profissional_id: p.id, mensagem });
    if (error) return falha(error, 'Pedido'); fechar(); toast('Pedido enviado à gestão.'); render('pagamento');
  })));
  $$('[data-res]', el).forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from('profissional_pagamento_solicitacoes')
      .update({ situacao: b.dataset.res, resolvido_em: new Date().toISOString(), resolvido_por: estado.user.id }).eq('id', b.dataset.id);
    if (error) return falha(error, 'Pedido'); toast('Pedido atualizado.'); render(`${p.id}-pagamento`);
  }));
}

async function abaNotas(el, { p, proprio, cid }) {
  const { data: ns, error } = await sb.from('notas_profissional').select('*').eq('profissional_id', p.id).order('competencia', { ascending: false }).order('criado_em', { ascending: false });
  if (faltaBanco(error, el, MIG)) return; if (error) return falha(error);
  const ant = competenciaAnterior(), temAnt = ns.some((n) => n.competencia.slice(0, 7) === ant);
  const meses = Array.from({ length: 12 }, (_, i) => somaMes(hojeYM(), -i - 1));
  el.innerHTML = `<div class="cartao"><h3 style="margin-top:0">Nota fiscal do mês</h3>
    <p>${temAnt ? `<span class="selo ok">NF de ${esc(nomeMes(ant))} recebida</span>` : `<span class="selo alerta">NF de ${esc(nomeMes(ant))} pendente</span>`}
      <span class="muted"> — a NF pendente só gera este alerta; não bloqueia o pagamento.</span></p>
    <form class="grade-form" id="f">
      <label>Competência (mês dos atendimentos)<select name="competencia">${meses.map((m) => `<option value="${m}">${esc(nomeMes(m))}</option>`).join('')}</select></label>
      <label>Nº da nota<input name="numero"></label>
      <label>Valor da nota (R$)<input name="valor" inputmode="decimal" placeholder="opcional"></label>
      <label>Arquivo (PDF, foto ou XML, até 5 MB)<input type="file" name="arq" accept=".pdf,.xml,image/jpeg,image/png"></label></form>
    <div class="linha-acoes"><button class="btn primario" id="enviar">Anexar nota fiscal</button></div></div>
    <div class="cartao tabela-rolagem">${ns.length ? `<table><thead><tr><th>Competência</th><th>Nº</th><th class="num">Valor</th><th>Enviada em</th><th></th></tr></thead><tbody>
      ${ns.map((n) => `<tr><td>${esc(nomeMes(n.competencia.slice(0, 7)))}</td><td>${esc(n.numero)}</td><td class="num">${n.valor == null ? '' : brl(n.valor)}</td>
        <td>${dia(n.criado_em)}</td><td><button class="btn pequeno" data-ver="${n.id}">Abrir</button>
        <button class="btn pequeno" data-del="${n.id}">Excluir</button></td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhuma nota anexada ainda.</div>'}</div>`;

  $('#enviar', el).onclick = async () => {
    const fd = new FormData($('#f', el)), arq = fd.get('arq');
    if (!arq || !arq.size) return toast('Escolha o arquivo da nota.', true);
    if (arq.size > 5 * 1024 * 1024) return toast('Arquivo acima de 5 MB. Reduza o PDF ou envie uma foto.', true);
    const valor = String(fd.get('valor') || '').trim().replace(/\./g, '').replace(',', '.');
    if (valor && !Number.isFinite(Number(valor))) return toast('Valor da nota inválido.', true);
    const ym = fd.get('competencia'), nome = arq.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `${cid}/${p.id}/${ym}/${Date.now()}-${nome}`;
    const up = await sb.storage.from('notas-prof').upload(path, arq, { contentType: arq.type || undefined });
    if (up.error) return falha(up.error, 'Upload');
    const { error: e } = await sb.from('notas_profissional').insert({ clinica_id: cid, profissional_id: p.id, competencia: `${ym}-01`,
      numero: String(fd.get('numero') || '').trim() || null, valor: valor ? Number(valor) : null, arquivo: path });
    if (e) { await sb.storage.from('notas-prof').remove([path]); return falha(e, 'Nota fiscal'); }
    toast('Nota fiscal anexada.'); render(proprio ? 'notas' : `${p.id}-notas`);
  };
  $$('[data-ver]', el).forEach((b) => (b.onclick = async () => {
    const n = ns.find((x) => x.id === b.dataset.ver);
    const { data: u, error: e } = await sb.storage.from('notas-prof').createSignedUrl(n.arquivo, 120);
    if (e) return falha(e, 'Nota fiscal'); window.open(u.signedUrl, '_blank', 'noopener');
  }));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
    const n = ns.find((x) => x.id === b.dataset.del);
    if (!(await confirmar(`Excluir a nota de ${nomeMes(n.competencia.slice(0, 7))}?`, 'Excluir'))) return;
    const { error: e } = await sb.from('notas_profissional').delete().eq('id', n.id);
    if (e) return falha(e, 'Nota fiscal');
    await sb.storage.from('notas-prof').remove([n.arquivo]); toast('Nota excluída.'); render(proprio ? 'notas' : `${p.id}-notas`);
  }));
}
