// Módulo Ficha do contrato (rota #contrato-<id>[-tabelas] ou #contrato-novo): mesma ideia da ficha do paciente.
// Identificação · contato de negociação · nota fiscal · tabela de valores (minimizada) · portal de autorização · bloco livre.
import { sb, estado, $, $$, esc, tela, toast, falha, confirmar } from '../core.js';

const TIPO = { proprio: 'Próprio', intermediario: 'Intermediário', outro: 'Outro' };
const opt = (lista, sel, rotulo) => lista.map((x) => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${esc(rotulo(x))}</option>`).join('');
const vazioNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

export async function render(params) {
  const novo = params.startsWith('novo');
  const id = novo ? null : params.slice(0, 36);
  const aba = novo ? params.slice(5) : params.slice(37);
  const cid = estado.clinica.id;
  const gestora = estado.perfil === 'gestor';
  const c = tela(novo ? 'Novo contrato' : 'Contrato', '<a class="btn" href="#contratos">← Contratos</a> <button class="btn primario" id="salvar-top">Salvar</button>');

  const [{ data: cnpjs }, { data: ops }, ctR, contasR, portR] = await Promise.all([
    sb.from('cnpjs_faturamento').select('*').eq('clinica_id', cid).order('ordem'),
    sb.from('operadoras').select('id, nome').eq('clinica_id', cid).order('nome'),
    novo ? { data: {} } : sb.from('contratos').select('*').eq('id', id).single(),
    sb.from('contas_financeiras').select('id, nome, banco, carteiras(tipo)').eq('clinica_id', cid).eq('ativo', true).order('nome'),
    novo || !gestora ? { data: [] } : sb.from('contrato_portais').select('*').eq('contrato_id', id).order('ordem').order('criado_em'),
  ]);
  if (ctR.error) return falha(ctR.error);
  if (portR.error) return falha(portR.error);
  const k = ctR.data;
  const contas = (contasR.data || []).filter((x) => !x.carteiras || x.carteiras.tipo === 'empresa');
  const portais = portR.data || [];
  if (!novo) $('#titulo-tela').textContent = k.nome;
  if (novo && !(ops?.length && cnpjs?.length)) { c.innerHTML = '<div class="cartao vazio">Cadastre antes uma operadora e um CNPJ de faturamento.</div>'; return; }

  const cnpjPadrao = k.cnpj_faturamento_id || cnpjs.find((x) => x.ordem === 1)?.id;
  const campo = (rot, nome, extra = '') => `<label>${rot}<input name="${nome}" value="${esc(k[nome])}" ${extra}></label>`;
  const linhaPortal = (p = {}) => `<div class="portal-lin" data-id="${esc(p.id || '')}">
    <label>Perfil / uso<input data-k="perfil" value="${esc(p.perfil)}" placeholder="usuário master, autorizador, secretaria…"></label>
    <label>Código<input data-k="codigo" value="${esc(p.codigo)}" autocomplete="off"></label>
    <label>Usuário<input data-k="usuario" value="${esc(p.usuario)}" autocomplete="off"></label>
    <label>Senha<span class="senha-campo"><input data-k="senha" type="password" value="${esc(p.senha)}" autocomplete="new-password"><button type="button" class="btn pequeno" data-ver title="Mostrar/ocultar">👁</button></span></label>
    <label>Observação<input data-k="observacao" value="${esc(p.observacao)}"></label>
    <button type="button" class="btn pequeno" data-rm title="Remover acesso">✕</button></div>`;

  c.innerHTML = `<form id="f" autocomplete="off">
    <div class="cartao"><h3>Identificação</h3><div class="grade-form">
      <label>Operadora<select name="operadora_id">${opt(ops, k.operadora_id, (o) => o.nome)}</select></label>
      ${campo('Nome do contrato', 'nome', 'required placeholder="ex.: SulAmérica via Motivar"')}
      <label>Faturado pelo CNPJ<select name="cnpj_faturamento_id">${opt(cnpjs, cnpjPadrao, (x) => `${x.ordem}. ${x.razao_social} (${TIPO[x.tipo]})`)}</select></label>
      ${campo('Código do prestador na operadora', 'codigo_prestador_operadora')}
      <label>Versão TISS<input name="versao_tiss" value="${esc(k.versao_tiss || '4.03.00')}"></label>
      <label>Prazo de envio (dias)<input type="number" name="prazo_envio_dias" value="${k.prazo_envio_dias ?? ''}"></label>
      <label>Prazo de recurso (dias)<input type="number" name="prazo_recurso_dias" value="${k.prazo_recurso_dias ?? ''}"></label>
      <label>Início do contrato<input type="date" name="vigencia_inicio" value="${esc(k.vigencia_inicio)}"></label>
      <label>Fim do contrato<input type="date" name="vigencia_fim" value="${esc(k.vigencia_fim)}"></label>
      <label class="check-linha"><input type="checkbox" name="ativo" ${k.ativo === false ? '' : 'checked'}> Contrato ativo</label>
    </div></div>

    <details class="cartao" id="sec-tabelas" ${aba === 'tabelas' ? 'open' : ''}><summary><strong>Tabela de valores</strong> <span class="dica-inline" id="tab-resumo">${novo ? '— salve o contrato para cadastrar' : '— clique para abrir e ajustar valores'}</span></summary>
      <div id="tab-corpo" style="margin-top:14px">${novo ? '<div class="vazio">Salve o contrato primeiro.</div>' : '<div class="vazio">Carregando…</div>'}</div></details>

    <div class="cartao"><h3>Contato responsável pela negociação</h3><div class="grade-form">
      ${campo('Nome', 'contato_nome')}${campo('Telefone / WhatsApp', 'contato_fone', 'type="tel"')}${campo('E-mail', 'contato_email', 'type="email"')}
    </div></div>

    <div class="cartao"><h3>Nota fiscal e recebimento</h3><div class="grade-form">
      ${campo('CNPJ da nota', 'nf_cnpj')}${campo('Razão social na nota', 'nf_razao')}${campo('E-mail para envio da nota', 'nf_email', 'type="email"')}
      ${campo('Endereço da operadora (nota)', 'nf_endereco')}
      <label>Conta em que recebemos<select name="conta_recebimento_id"><option value="">— não definida —</option>${opt(contas, k.conta_recebimento_id, (x) => x.nome + (x.banco ? ` · ${x.banco}` : ''))}</select></label>
    </div></div>

    <div class="cartao"><h3>Portal de autorização</h3>
      <div class="grade-form"><label>Link do site de autorização<input name="portal_url" type="url" value="${esc(k.portal_url)}" placeholder="https://"></label>
        ${k.portal_url ? `<a class="btn" href="${esc(k.portal_url)}" target="_blank" rel="noopener noreferrer">Abrir portal ↗</a>` : ''}</div>
      ${gestora ? `<h4 style="margin:16px 0 8px">Acessos</h4>
        <div class="dica">Visível e editável só pela gestora. A senha fica guardada no banco (sem entrar na auditoria nem no backup). Use o campo "Perfil / uso" para anotar de quem é o acesso.</div>
        <div id="portais">${portais.map(linhaPortal).join('')}</div>
        <button type="button" class="btn pequeno" id="add-portal">+ Acesso</button>`
        : '<div class="dica">Os acessos do portal (código, usuário e senha) são visíveis só para a gestora.</div>'}
    </div>

    <div class="cartao"><h3>Observações do plano</h3>
      <label>Bloco livre (regras, particularidades, histórico de negociação…)<textarea name="observacoes" rows="6">${esc(k.observacoes)}</textarea></label></div>
    <div class="linha-acoes"><a class="btn" href="#contratos">Voltar</a><button class="btn primario" id="salvar" type="submit">Salvar</button></div>
  </form>`;

  // ----- acessos do portal
  const removidos = [];
  if (gestora) {
    const lista = $('#portais', c);
    const ligar = (el) => {
      $('[data-ver]', el).onclick = () => { const i = $('[data-k=senha]', el); i.type = i.type === 'password' ? 'text' : 'password'; };
      $('[data-rm]', el).onclick = () => { if (el.dataset.id) removidos.push(el.dataset.id); el.remove(); };
    };
    $$('.portal-lin', lista).forEach(ligar);
    $('#add-portal', c).onclick = () => { lista.insertAdjacentHTML('beforeend', linhaPortal()); ligar(lista.lastElementChild); };
  }

  // ----- tabela de valores (minimizada; carrega ao abrir)
  const sec = $('#sec-tabelas', c);
  if (!novo) {
    const abrir = async () => { await montarTabela($('#tab-corpo', c), k, $('#tab-resumo', c)); };
    sb.from('contrato_tabela').select('id', { count: 'exact', head: true }).eq('contrato_id', id).is('vigencia_fim', null)
      .then(({ count }) => { $('#tab-resumo', c).textContent = `— ${count ?? 0} procedimentos · clique para abrir e ajustar valores`; });
    let carregada = false;
    sec.addEventListener('toggle', () => { if (sec.open && !carregada) { carregada = true; abrir(); } });
    if (sec.open) { carregada = true; abrir(); }
  }

  // ----- salvar
  let salvando = false;
  const salvar = async (e) => {
    e?.preventDefault();
    if (salvando) return;
    const form = $('#f', c);
    if (!form.reportValidity()) return;
    const f = Object.fromEntries(new FormData(form));
    const obj = { ativo: !!form.elements.ativo.checked };
    ['nome', 'operadora_id', 'cnpj_faturamento_id', 'versao_tiss'].forEach((n) => (obj[n] = String(f[n] || '').trim()));
    if (!obj.nome || !obj.operadora_id || !obj.cnpj_faturamento_id) return toast('Preencha nome, operadora e CNPJ.', true);
    ['prazo_envio_dias', 'prazo_recurso_dias'].forEach((n) => (obj[n] = f[n] === '' ? null : Number(f[n])));
    ['codigo_prestador_operadora', 'vigencia_inicio', 'vigencia_fim', 'contato_nome', 'contato_fone', 'contato_email', 'nf_cnpj', 'nf_razao', 'nf_email',
      'nf_endereco', 'conta_recebimento_id', 'portal_url', 'observacoes'].forEach((n) => (obj[n] = vazioNull(f[n])));
    if (obj.vigencia_inicio && obj.vigencia_fim && obj.vigencia_fim < obj.vigencia_inicio) return toast('O fim do contrato é anterior ao início.', true);
    salvando = true;
    try {
      let ctId = id;
      if (novo) {
        const r = await sb.from('contratos').insert({ ...obj, clinica_id: cid }).select('id').single();
        if (r.error) throw r.error; ctId = r.data.id;
      } else {
        const r = await sb.from('contratos').update(obj).eq('id', id); if (r.error) throw r.error;
      }
      if (gestora) {
        const linhas = $$('.portal-lin', c).map((el, i) => {
          const o = { clinica_id: cid, contrato_id: ctId, ordem: i + 1 };
          $$('[data-k]', el).forEach((inp) => (o[inp.dataset.k] = vazioNull(inp.value)));
          return { id: el.dataset.id || null, o };
        }).filter((x) => x.o.perfil || x.o.codigo || x.o.usuario || x.o.senha || x.o.observacao);
        for (const x of linhas.filter((l) => l.id)) { const r = await sb.from('contrato_portais').update(x.o).eq('id', x.id); if (r.error) throw r.error; }
        const novos = linhas.filter((l) => !l.id).map((l) => l.o);
        if (novos.length) { const r = await sb.from('contrato_portais').insert(novos); if (r.error) throw r.error; }
        if (removidos.length) { const r = await sb.from('contrato_portais').delete().in('id', removidos); if (r.error) throw r.error; }
      }
      toast('Contrato salvo.');
      if (novo) { location.hash = `#contrato-${ctId}`; return; }
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
