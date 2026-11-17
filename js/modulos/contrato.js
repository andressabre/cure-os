// Módulo Ficha do contrato (rota #contrato-<id>[-tabelas] ou #contrato-novo): perfil completo do plano, em seções minimizáveis.
// Identificação (operadora + contrato + nota fiscal) · tabela de valores · contatos · portal de autorização · observações.
// A operadora deixou de ter tela própria: nome, Registro ANS, CNPJ e logo são editados aqui (gravam na tabela `operadoras`,
// que continua existindo porque guia impressa, XML do lote, retornos e funções do banco leem dela).
import { sb, estado, $, $$, esc, tela, toast, falha, confirmar } from '../core.js';

const TIPO = { proprio: 'Próprio', intermediario: 'Intermediário', outro: 'Outro' };
const opt = (lista, sel, rotulo) => lista.map((x) => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${esc(rotulo(x))}</option>`).join('');
const vazioNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
let reabrir = null;   // seções abertas, para manter ao salvar

const logoOk = (v) => typeof v === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v);

// Logo da operadora: PNG/JPG reduzido no navegador para no máx. 400 px de largura e ~60 KB (data URL).
async function comprimirLogo(arquivo) {
  if (!/^image\/(jpeg|png)$/.test(arquivo.type)) throw new Error('Use imagem PNG ou JPG.');
  const img = await createImageBitmap(arquivo).catch(() => { throw new Error('Não foi possível ler a imagem.'); });
  for (const larg of [400, 300, 200]) {
    const k = Math.min(1, larg / img.width);
    const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    const ctx = cv.getContext('2d');
    for (const [tipo, q] of arquivo.type === 'image/png' ? [['image/png'], ['image/jpeg', 0.85]] : [['image/jpeg', 0.85], ['image/jpeg', 0.6]]) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (tipo === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL(tipo, q);
      if (url.length <= 60 * 1024 * 1.37) return url;
    }
  }
  throw new Error('Logo muito pesado mesmo reduzido (máx. ~60 KB). Use uma imagem mais simples.');
}

// Sincroniza linhas de uma lista (contatos/acessos): atualiza as existentes, insere as novas e apaga as removidas.
async function sincronizar(tabela, linhas, removidos) {
  for (const x of linhas.filter((l) => l.id)) { const r = await sb.from(tabela).update(x.o).eq('id', x.id); if (r.error) throw r.error; }
  const novos = linhas.filter((l) => !l.id).map((l) => l.o);
  if (novos.length) { const r = await sb.from(tabela).insert(novos); if (r.error) throw r.error; }
  if (removidos.length) { const r = await sb.from(tabela).delete().in('id', removidos); if (r.error) throw r.error; }
}
const coletar = (container, base) => $$('[data-id]', container).map((el, i) => {
  const o = { ...base, ordem: i + 1 };
  $$('[data-k]', el).forEach((inp) => (o[inp.dataset.k] = vazioNull(inp.value)));
  return { id: el.dataset.id || null, o };
}).filter((x) => Object.entries(x.o).some(([k, v]) => !['clinica_id', 'contrato_id', 'ordem'].includes(k) && v));

export async function render(params) {
  const novo = params.startsWith('novo');
  const id = novo ? null : params.slice(0, 36);
  const aba = novo ? params.slice(5) : params.slice(37);
  const cid = estado.clinica.id;
  const gestora = estado.perfil === 'gestor';
  const c = tela(novo ? 'Novo contrato' : 'Contrato', `<a class="btn" href="#contratos">← Contratos</a> <button type="button" class="btn" id="tudo">Abrir / fechar tudo</button>
    <button type="button" class="btn primario" id="salvar-top">Salvar</button>`);

  const [{ data: cnpjs }, { data: ops }, { data: todos }, ctR, contasR, portR, contR] = await Promise.all([
    sb.from('cnpjs_faturamento').select('*').eq('clinica_id', cid).order('ordem'),
    sb.from('operadoras').select('id, nome, registro_ans, cnpj').eq('clinica_id', cid).order('nome'),
    sb.from('contratos').select('id, operadora_id').eq('clinica_id', cid),
    novo ? { data: {} } : sb.from('contratos').select('*').eq('id', id).single(),
    sb.from('contas_financeiras').select('id, nome, banco, carteiras(tipo)').eq('clinica_id', cid).eq('ativo', true).order('nome'),
    novo || !gestora ? { data: [] } : sb.from('contrato_portais').select('*').eq('contrato_id', id).order('ordem').order('criado_em'),
    novo ? { data: [] } : sb.from('contrato_contatos').select('*').eq('contrato_id', id).order('ordem').order('criado_em'),
  ]);
  for (const r of [ctR, portR, contR]) if (r.error) return falha(r.error);
  const k = ctR.data;
  const contas = (contasR.data || []).filter((x) => !x.carteiras || x.carteiras.tipo === 'empresa');
  const portais = portR.data || [], contatos = contR.data || [];
  if (!novo) $('#titulo-tela').textContent = k.nome;
  if (!cnpjs?.length) { c.innerHTML = '<div class="cartao vazio">Cadastre antes um CNPJ de faturamento (Convênios e contratos → CNPJs de faturamento).</div>'; return; }

  // operadora vinculada (logo vem à parte: é pesada e só a operadora escolhida precisa dela)
  let opId = k.operadora_id || '';
  let logo = null;
  if (opId) { const r = await sb.from('operadoras').select('logo').eq('id', opId).maybeSingle(); logo = logoOk(r.data?.logo) ? r.data.logo : null; }
  const op0 = ops.find((x) => x.id === opId) || {};
  const cnpj0 = cnpjs.find((x) => x.id === (k.cnpj_faturamento_id || cnpjs.find((y) => y.ordem === 1)?.id));
  const outrosCom = (oid) => (oid ? todos.filter((x) => x.operadora_id === oid && x.id !== id).length : 0);

  const campo = (rot, nome, extra = '') => `<label>${rot}<input name="${nome}" value="${esc(k[nome])}" ${extra}></label>`;
  const linhaContato = (p = {}) => `<div class="contato-lin" data-id="${esc(p.id || '')}">
    <label>Nome<input data-k="nome" value="${esc(p.nome)}"></label>
    <label>Cargo / setor<input data-k="cargo" value="${esc(p.cargo)}" placeholder="credenciamento, financeiro…"></label>
    <label>Telefone / WhatsApp<input data-k="telefone" type="tel" value="${esc(p.telefone)}"></label>
    <label>E-mail<input data-k="email" type="email" value="${esc(p.email)}"></label>
    <label>Observação<input data-k="observacao" value="${esc(p.observacao)}"></label>
    <button type="button" class="btn pequeno" data-rm title="Remover contato">✕</button></div>`;
  const linhaPortal = (p = {}) => `<div class="portal-lin" data-id="${esc(p.id || '')}">
    <label>Perfil / uso<input data-k="perfil" value="${esc(p.perfil)}" placeholder="usuário master, autorizador, secretaria…"></label>
    <label>Código<input data-k="codigo" value="${esc(p.codigo)}" autocomplete="off"></label>
    <label>Usuário<input data-k="usuario" value="${esc(p.usuario)}" autocomplete="off"></label>
    <label>Senha<span class="senha-campo"><input data-k="senha" type="password" value="${esc(p.senha)}" autocomplete="new-password"><button type="button" class="btn pequeno" data-ver title="Mostrar/ocultar">👁</button></span></label>
    <label>Observação<input data-k="observacao" value="${esc(p.observacao)}"></label>
    <button type="button" class="btn pequeno" data-rm title="Remover acesso">✕</button></div>`;

  const abertas = reabrir || (aba === 'tabelas' ? ['id', 'tab'] : ['id']); reabrir = null;
  const sec = (nome, titulo, resumo, corpo) => `<details class="cartao sec" data-sec="${nome}" ${abertas.includes(nome) ? 'open' : ''}>
    <summary><strong>${titulo}</strong> <span class="dica-inline" ${nome === 'tab' ? 'id="tab-resumo"' : ''}>${resumo ? '— ' + esc(resumo) : ''}</span></summary><div class="sec-corpo">${corpo}</div></details>`;

  c.innerHTML = `<form id="f" autocomplete="off" novalidate>
    ${sec('id', 'Identificação', `${op0.nome || 'nova operadora'} · CNPJ ${cnpj0 ? cnpj0.ordem + '. ' + cnpj0.razao_social : ''}`, `
      <h4>Operadora</h4>
      <div class="grade-form">
        <label>Operadora<select id="op-sel"><option value="">➕ Nova operadora</option>${opt(ops, opId, (o) => o.nome)}</select></label>
        <label>Nome da operadora<input id="op-nome" value="${esc(op0.nome)}"></label>
        <label>Registro ANS (campo 1 da guia)<input id="op-ans" value="${esc(op0.registro_ans)}"></label>
        <label>CNPJ da operadora<input id="op-cnpj" value="${esc(op0.cnpj)}"></label>
        <label>Logo (guia impressa)<input type="file" id="lg" accept="image/png,image/jpeg"></label>
        <div><span id="lg-prev"></span> <button type="button" class="btn pequeno" id="lg-rm">Remover logo</button></div>
      </div>
      <div class="dica" id="op-aviso" style="margin-top:10px" hidden></div>
      <h4>Contrato</h4>
      <div class="grade-form">
        <label>Faturado pelo CNPJ<select name="cnpj_faturamento_id">${opt(cnpjs, cnpj0?.id, (x) => `${x.ordem}. ${x.razao_social} (${TIPO[x.tipo]})`)}</select></label>
        ${campo('Código do prestador na operadora', 'codigo_prestador_operadora')}
        ${campo('Nome do plano (opcional)', 'nome', 'placeholder="se vazio, o sistema monta"')}
        <label>Versão TISS<input name="versao_tiss" value="${esc(k.versao_tiss || '4.03.00')}"></label>
        <label>Prazo de envio (dias)<input type="number" name="prazo_envio_dias" value="${k.prazo_envio_dias ?? ''}"></label>
        <label>Prazo de recurso (dias)<input type="number" name="prazo_recurso_dias" value="${k.prazo_recurso_dias ?? ''}"></label>
        <label>Início do contrato<input type="date" name="vigencia_inicio" value="${esc(k.vigencia_inicio)}"></label>
        <label>Fim do contrato<input type="date" name="vigencia_fim" value="${esc(k.vigencia_fim)}"></label>
        <label class="check-linha"><input type="checkbox" name="ativo" ${k.ativo === false ? '' : 'checked'}> Contrato ativo</label>
      </div>
      <div class="dica-inline" style="margin-top:6px">O nome do plano aparece em guias, lotes, retornos e na agenda. Operadora + CNPJ já identificam o contrato na lista.</div>
      <h4>Nota fiscal e recebimento</h4>
      <div class="grade-form">
        ${campo('CNPJ da nota', 'nf_cnpj')}${campo('Razão social na nota', 'nf_razao')}${campo('E-mail para envio da nota', 'nf_email', 'type="email"')}
        ${campo('Endereço (nota)', 'nf_endereco')}
        <label>Conta em que recebemos<select name="conta_recebimento_id"><option value="">— não definida —</option>${opt(contas, k.conta_recebimento_id, (x) => x.nome + (x.banco ? ` · ${x.banco}` : ''))}</select></label>
      </div>`)}

    ${sec('tab', 'Tabela de valores', novo ? 'salve o contrato para cadastrar' : 'clique para abrir e ajustar valores',
      `<div id="tab-corpo">${novo ? '<div class="vazio">Salve o contrato primeiro.</div>' : '<div class="vazio">Carregando…</div>'}</div>`)}

    ${sec('cont', 'Contatos responsáveis pela negociação', `${contatos.length} ${contatos.length === 1 ? 'contato' : 'contatos'}`,
      `<div id="contatos">${contatos.map(linhaContato).join('')}</div><button type="button" class="btn pequeno" id="add-contato">+ Contato</button>`)}

    ${sec('portal', 'Portal de autorização', `${k.portal_url ? 'link cadastrado' : 'sem link'}${gestora ? ` · ${portais.length} ${portais.length === 1 ? 'acesso' : 'acessos'}` : ''}`, `
      <div class="grade-form"><label>Link do site de autorização<input name="portal_url" type="url" value="${esc(k.portal_url)}" placeholder="https://"></label>
        ${k.portal_url ? `<a class="btn" href="${esc(k.portal_url)}" target="_blank" rel="noopener noreferrer">Abrir portal ↗</a>` : ''}</div>
      ${gestora ? `<h4>Acessos</h4>
        <div class="dica">Visível e editável só pela gestora. A senha fica guardada no banco (sem entrar na auditoria nem no backup). Use "Perfil / uso" para anotar de quem é o acesso.</div>
        <div id="portais">${portais.map(linhaPortal).join('')}</div>
        <button type="button" class="btn pequeno" id="add-portal">+ Acesso</button>`
        : '<div class="dica">Os acessos do portal (código, usuário e senha) são visíveis só para a gestora.</div>'}`)}

    ${sec('obs', 'Observações do plano', k.observacoes ? 'preenchido' : 'vazio',
      `<label>Bloco livre (regras, particularidades, histórico de negociação…)<textarea name="observacoes" rows="6">${esc(k.observacoes)}</textarea></label>`)}
    <div class="linha-acoes"><a class="btn" href="#contratos">Voltar</a><button class="btn primario" id="salvar" type="submit">Salvar</button></div>
  </form>`;

  $('#tudo').onclick = () => { const ds = $$('details.sec', c); const abrir = ds.some((d) => !d.open); ds.forEach((d) => (d.open = abrir)); };

  // ----- perfil da operadora
  let logoOrig = logo;   // logo como está no banco para a operadora escolhida (detecta mudança)
  const prevLogo = () => {
    $('#lg-prev', c).innerHTML = logo ? `<img src="${esc(logo)}" alt="Logo" style="max-height:40px;max-width:200px">` : '<span class="dica-inline">Sem logo: a guia sai sem imagem.</span>';
    $('#lg-rm', c).style.display = logo ? '' : 'none';
  };
  const avisoOp = () => {
    const n = outrosCom($('#op-sel', c).value); const el = $('#op-aviso', c);
    el.hidden = !n; el.textContent = n ? `Esta operadora também está em ${n} outro${n > 1 ? 's' : ''} contrato${n > 1 ? 's' : ''}: nome, Registro ANS, CNPJ e logo valem para todos.` : '';
  };
  prevLogo(); avisoOp();
  $('#op-sel', c).onchange = async (e) => {
    opId = e.target.value;
    const o = ops.find((x) => x.id === opId) || {};
    $('#op-nome', c).value = o.nome || ''; $('#op-ans', c).value = o.registro_ans || ''; $('#op-cnpj', c).value = o.cnpj || '';
    logo = null; logoOrig = null; prevLogo(); avisoOp();
    if (opId) { const r = await sb.from('operadoras').select('logo').eq('id', opId).maybeSingle(); if ($('#op-sel', c).value === opId) { logo = logoOrig = logoOk(r.data?.logo) ? r.data.logo : null; prevLogo(); } }
  };
  $('#lg', c).onchange = async (e) => {
    const a = e.target.files[0]; if (!a) return;
    try { logo = await comprimirLogo(a); } catch (x) { toast(x.message, true); }
    prevLogo();
  };
  $('#lg-rm', c).onclick = () => { logo = null; $('#lg', c).value = ''; prevLogo(); };

  // ----- listas: contatos e acessos
  const lista = (boxId, addId, linha) => {
    const box = $(boxId, c); const removidos = [];
    const ligar = (el) => {
      $('[data-rm]', el).onclick = () => { if (el.dataset.id) removidos.push(el.dataset.id); el.remove(); };
      $('[data-ver]', el)?.addEventListener('click', () => { const i = $('[data-k=senha]', el); i.type = i.type === 'password' ? 'text' : 'password'; });
    };
    $$('[data-id]', box).forEach(ligar);
    $(addId, c).onclick = () => { box.insertAdjacentHTML('beforeend', linha()); ligar(box.lastElementChild); };
    return { box, removidos };
  };
  const LC = lista('#contatos', '#add-contato', linhaContato);
  const LP = gestora ? lista('#portais', '#add-portal', linhaPortal) : null;

  // ----- tabela de valores (minimizada; carrega ao abrir)
  const secTab = $('[data-sec=tab]', c);
  if (!novo) {
    sb.from('contrato_tabela').select('id', { count: 'exact', head: true }).eq('contrato_id', id).is('vigencia_fim', null)
      .then(({ count }) => { $('#tab-resumo', c).textContent = `— ${count ?? 0} procedimentos · clique para abrir e ajustar valores`; });
    let carregada = false;
    const abrirTab = () => { if (!carregada) { carregada = true; montarTabela($('#tab-corpo', c), k, $('#tab-resumo', c)); } };
    secTab.addEventListener('toggle', () => { if (secTab.open) abrirTab(); });
    if (secTab.open) abrirTab();
  }

  // ----- salvar
  let salvando = false;
  const salvar = async (e) => {
    e?.preventDefault();
    if (salvando) return;
    const form = $('#f', c);
    const f = Object.fromEntries(new FormData(form));
    const opNome = vazioNull($('#op-nome', c).value);
    if (!opNome) { $('[data-sec=id]', c).open = true; return toast('Informe o nome da operadora.', true); }
    if (!f.cnpj_faturamento_id) return toast('Escolha o CNPJ de faturamento.', true);
    const obj = { ativo: !!form.elements.ativo.checked, cnpj_faturamento_id: f.cnpj_faturamento_id, versao_tiss: String(f.versao_tiss || '').trim() || '4.03.00' };
    ['prazo_envio_dias', 'prazo_recurso_dias'].forEach((n) => (obj[n] = f[n] === '' ? null : Number(f[n])));
    ['codigo_prestador_operadora', 'vigencia_inicio', 'vigencia_fim', 'nf_cnpj', 'nf_razao', 'nf_email', 'nf_endereco', 'conta_recebimento_id', 'portal_url', 'observacoes']
      .forEach((n) => (obj[n] = vazioNull(f[n])));
    if (obj.vigencia_inicio && obj.vigencia_fim && obj.vigencia_fim < obj.vigencia_inicio) return toast('O fim do contrato é anterior ao início.', true);
    const cn = cnpjs.find((x) => x.id === obj.cnpj_faturamento_id);
    obj.nome = vazioNull(f.nome) || `${opNome} – ${cn?.razao_social || ''}`.replace(/ – $/, '');
    salvando = true;
    try {
      // 1) operadora (cria se for nova; só grava se algo mudou)
      const dadosOp = { nome: opNome, registro_ans: vazioNull($('#op-ans', c).value), cnpj: vazioNull($('#op-cnpj', c).value), logo };
      let oid = opId;
      if (!oid) {
        const r = await sb.from('operadoras').insert({ ...dadosOp, clinica_id: cid }).select('id').single(); if (r.error) throw r.error; oid = r.data.id;
      } else {
        const o = ops.find((x) => x.id === oid) || {};
        const mudou = o.nome !== dadosOp.nome || (o.registro_ans || null) !== dadosOp.registro_ans || (o.cnpj || null) !== dadosOp.cnpj || logo !== logoOrig;
        if (mudou) { const r = await sb.from('operadoras').update(dadosOp).eq('id', oid); if (r.error) throw r.error; }
      }
      obj.operadora_id = oid;
      // 2) contrato
      let ctId = id;
      if (novo) { const r = await sb.from('contratos').insert({ ...obj, clinica_id: cid }).select('id').single(); if (r.error) throw r.error; ctId = r.data.id; }
      else { const r = await sb.from('contratos').update(obj).eq('id', id); if (r.error) throw r.error; }
      // 3) contatos e acessos
      const base = { clinica_id: cid, contrato_id: ctId };
      await sincronizar('contrato_contatos', coletar(LC.box, base), LC.removidos);
      if (LP) await sincronizar('contrato_portais', coletar(LP.box, base), LP.removidos);
      toast('Contrato salvo.');
      if (novo) { location.hash = `#contrato-${ctId}`; return; }
      reabrir = $$('details.sec[open]', c).map((d) => d.dataset.sec);
      render(params);
    } catch (err) { falha(err, 'Salvar contrato'); } finally { salvando = false; }
  };
  $('#f', c).onsubmit = salvar;
  $('#salvar-top').onclick = salvar;
}

// Tabela de valores do contrato (o que a clínica RECEBE), dentro da ficha. Reajuste cria nova vigência e guarda o histórico.
async function montarTabela(m, k, resumoEl) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: itens, error } = await sb.from('contrato_tabela').select('id, valor, vigencia_inicio, procedimentos(id, codigo, descricao)')
    .eq('contrato_id', k.id).is('vigencia_fim', null).order('vigencia_inicio');
  if (error) return falha(error);
  itens.sort((a, b) => a.procedimentos.codigo.localeCompare(b.procedimentos.codigo));
  if (resumoEl) resumoEl.textContent = `— ${itens.length} procedimentos · clique para abrir e ajustar valores`;
  m.innerHTML = `<div class="dica">Valores que a clínica recebe da operadora. No <strong>reajuste anual</strong>, informe o % e a data: o sistema
      encerra a tabela atual e cria a nova, guardando o histórico (guias antigas continuam com o valor da época).</div>
    <div class="grade-form"><label>Reajuste (%)<input type="number" step="0.01" id="pct" placeholder="ex.: 5,5"></label>
      <label>Vale a partir de<input type="date" id="desde" value="${hoje}"></label>
      <button type="button" class="btn escuro" id="reaj">Aplicar reajuste em todos</button></div>
    <div class="tabela-rolagem" style="max-height:50vh;margin-top:12px"><table><thead><tr><th>Código TUSS</th><th>Procedimento</th><th>Desde</th><th class="num">Valor (R$)</th></tr></thead><tbody>
    ${itens.map((i) => `<tr><td>${esc(i.procedimentos.codigo)}</td><td>${esc(i.procedimentos.descricao)}</td><td>${esc(i.vigencia_inicio.split('-').reverse().join('/'))}</td>
      <td class="num"><input type="number" step="0.01" min="0" style="width:100px;text-align:right" data-id="${i.id}" data-orig="${i.valor}" value="${Number(i.valor).toFixed(2)}"></td></tr>`).join('')
      || '<tr><td colspan="4" class="vazio">Sem itens. Cadastre os procedimentos.</td></tr>'}
    </tbody></table></div>
    <div class="grade-form" style="margin-top:12px"><label>Novo código TUSS<input id="ncod"></label><label>Descrição<input id="ndesc"></label>
      <label>Valor<input type="number" step="0.01" id="nval"></label><button type="button" class="btn" id="add">Adicionar</button></div>
    <div class="linha-acoes"><button type="button" class="btn primario" id="salvar-vals">Salvar valores alterados</button></div>`;

  const recarregar = () => montarTabela(m, k, resumoEl);
  const novaVigencia = async (id, procId, valor, desde) => {
    const ontem = new Date(new Date(desde + 'T12:00') - 864e5).toISOString().slice(0, 10);
    const r1 = await sb.from('contrato_tabela').update({ vigencia_fim: ontem }).eq('id', id); if (r1.error) throw r1.error;
    const r2 = await sb.from('contrato_tabela').insert({ clinica_id: estado.clinica.id, contrato_id: k.id, procedimento_id: procId, valor, vigencia_inicio: desde });
    if (r2.error) throw r2.error;
  };
  $('#salvar-vals', m).onclick = async () => {
    const alterados = $$('[data-id]', m).filter((x) => Number(x.value).toFixed(2) !== Number(x.dataset.orig).toFixed(2));
    if (!alterados.length) return toast('Nenhum valor alterado.');
    try { for (const x of alterados) { const it = itens.find((i) => i.id === x.dataset.id); await novaVigencia(it.id, it.procedimentos.id, Number(x.value), hoje); } }
    catch (e) { return falha(e); }
    toast(`${alterados.length} valores atualizados.`); recarregar();
  };
  $('#reaj', m).onclick = async () => {
    const pct = Number(String($('#pct', m).value).replace(',', '.')), desde = $('#desde', m).value;
    if (!pct || !desde) return toast('Informe o % e a data.', true);
    if (!(await confirmar(`Reajustar ${itens.length} procedimentos em ${pct}% a partir de ${desde.split('-').reverse().join('/')}?`, 'Reajustar'))) return;
    try { for (const i of itens) await novaVigencia(i.id, i.procedimentos.id, Math.round(i.valor * (1 + pct / 100) * 100) / 100, desde); }
    catch (e) { return falha(e); }
    toast('Reajuste aplicado.'); recarregar();
  };
  $('#add', m).onclick = async () => {
    const cod = $('#ncod', m).value.trim(), desc = $('#ndesc', m).value.trim(), val = Number($('#nval', m).value);
    if (!cod || !val) return toast('Informe código e valor.', true);
    let { data: pr } = await sb.from('procedimentos').select('id').eq('codigo', cod).maybeSingle();
    if (!pr) {
      if (!desc) return toast('Procedimento novo: informe a descrição.', true);
      const r = await sb.from('procedimentos').insert({ codigo: cod, descricao: desc }).select('id').single(); if (r.error) return falha(r.error); pr = r.data;
    }
    const { error: e } = await sb.from('contrato_tabela').insert({ clinica_id: estado.clinica.id, contrato_id: k.id, procedimento_id: pr.id, valor: val, vigencia_inicio: hoje });
    if (e) return falha(e); toast('Procedimento adicionado.'); recarregar();
  };
}
