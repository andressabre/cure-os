// Módulo Convênios e contratos: CNPJs de faturamento (1 próprio, 2/3 intermediários), operadoras e contratos.
import { sb, estado, $, $$, esc, tela, toast, falha, modal, confirmar } from '../core.js';

const TIPO = { proprio: 'Próprio', intermediario: 'Intermediário', outro: 'Outro' };

export async function render() {
  const c = tela('Convênios e contratos', `<button class="btn" id="n-cnpj">+ CNPJ</button>
    <button class="btn" id="n-op">+ Operadora</button><button class="btn primario" id="n-ct">+ Contrato</button>`);
  const cid = estado.clinica.id;
  const [{ data: cnpjs }, { data: ops }, { data: cts, error }] = await Promise.all([
    sb.from('cnpjs_faturamento').select('*').eq('clinica_id', cid).order('ordem'),
    sb.from('operadoras').select('*').eq('clinica_id', cid).order('nome'),
    sb.from('contratos').select('*, operadoras(nome), cnpjs_faturamento(razao_social, tipo, ordem)').eq('clinica_id', cid).order('nome'),
  ]);
  if (error) return falha(error);

  c.innerHTML = `
    <div class="cartao"><h3>CNPJs de faturamento</h3>
      <div class="dica">A ordem define a sugestão no cadastro do contrato: 1 = CNPJ da Cure, 2 e 3 = intermediários.</div>
      <table><thead><tr><th>Ordem</th><th>Razão social</th><th>CNPJ</th><th>CNES</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${cnpjs.map((x) => `<tr><td>${x.ordem}</td><td>${esc(x.razao_social)}</td><td>${esc(x.cnpj)}</td><td>${esc(x.cnes)}</td>
        <td>${TIPO[x.tipo]}</td><td><button class="btn pequeno" data-ed-cnpj="${x.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum CNPJ</td></tr>'}
      </tbody></table></div>
    <div class="cartao"><h3>Contratos</h3>
      <table><thead><tr><th>Contrato</th><th>Operadora</th><th>Fatura pelo CNPJ</th><th>Cód. prestador</th><th>TISS</th><th>Prazos (envio / recurso)</th><th></th></tr></thead><tbody>
      ${cts.map((k) => `<tr><td><strong>${esc(k.nome)}</strong></td><td>${esc(k.operadoras?.nome)}</td>
        <td>${k.cnpjs_faturamento?.ordem}. ${esc(k.cnpjs_faturamento?.razao_social)}</td><td>${esc(k.codigo_prestador_operadora)}</td>
        <td>${esc(k.versao_tiss)}</td><td>${k.prazo_envio_dias ?? '—'} / ${k.prazo_recurso_dias ?? '—'} dias</td>
        <td><button class="btn pequeno" data-ed-ct="${k.id}">Editar</button> <button class="btn pequeno" data-tab="${k.id}">Tabela de valores</button></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum contrato</td></tr>'}
      </tbody></table></div>
    <div class="cartao"><h3>Operadoras</h3>
      <table><thead><tr><th>Nome</th><th>Registro ANS</th><th>CNPJ</th></tr></thead><tbody>
      ${ops.map((o) => `<tr><td>${esc(o.nome)}</td><td>${esc(o.registro_ans)}</td><td>${esc(o.cnpj)}</td></tr>`).join('')}
      </tbody></table></div>`;

  const salvar = async (tabela, obj, id, fechar) => {
    const q = id ? sb.from(tabela).update(obj).eq('id', id) : sb.from(tabela).insert({ ...obj, clinica_id: cid });
    const { error: e } = await q; if (e) return falha(e); fechar(); toast('Salvo.'); render();
  };

  const formCnpj = (x = {}) => modal(`<h3>${x.id ? 'Editar' : 'Novo'} CNPJ de faturamento</h3><form class="grade-form" id="f">
    <label>Razão social<input name="razao_social" required value="${esc(x.razao_social)}"></label>
    <label>CNPJ<input name="cnpj" required value="${esc(x.cnpj)}"></label>
    <label>CNES<input name="cnes" value="${esc(x.cnes)}"></label>
    <label>Tipo<select name="tipo">${Object.entries(TIPO).map(([k, v]) => `<option value="${k}" ${x.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Ordem<select name="ordem">${[1, 2, 3].map((n) => `<option ${x.ordem === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
  (m, fechar) => ($('#s', m).onclick = () => {
    const f = Object.fromEntries(new FormData($('#f', m))); f.ordem = Number(f.ordem);
    if (!f.razao_social || !f.cnpj) return toast('Preencha razão social e CNPJ.', true);
    salvar('cnpjs_faturamento', f, x.id, fechar);
  }));

  const formCt = (k = {}) => {
    const cnpjPadrao = k.cnpj_faturamento_id || cnpjs.find((x) => x.ordem === 1)?.id;
    modal(`<h3>${k.id ? 'Editar' : 'Novo'} contrato</h3><form class="grade-form" id="f">
      <label>Nome do contrato<input name="nome" required value="${esc(k.nome)}" placeholder="ex.: SulAmérica via Motivar"></label>
      <label>Operadora<select name="operadora_id">${ops.map((o) => `<option value="${o.id}" ${k.operadora_id === o.id ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></label>
      <label>Fatura pelo CNPJ<select name="cnpj_faturamento_id">${cnpjs.map((x) => `<option value="${x.id}" ${cnpjPadrao === x.id ? 'selected' : ''}>${x.ordem}. ${esc(x.razao_social)} (${TIPO[x.tipo]})</option>`).join('')}</select></label>
      <label>Código do prestador na operadora<input name="codigo_prestador_operadora" value="${esc(k.codigo_prestador_operadora)}"></label>
      <label>Versão TISS<input name="versao_tiss" value="${esc(k.versao_tiss || '4.03.00')}"></label>
      <label>Prazo de envio (dias)<input type="number" name="prazo_envio_dias" value="${k.prazo_envio_dias ?? ''}"></label>
      <label>Prazo de recurso (dias)<input type="number" name="prazo_recurso_dias" value="${k.prazo_recurso_dias ?? ''}"></label>
      </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
    (m, fechar) => ($('#s', m).onclick = () => {
      const f = Object.fromEntries(new FormData($('#f', m)));
      ['prazo_envio_dias', 'prazo_recurso_dias'].forEach((p) => (f[p] = f[p] === '' ? null : Number(f[p])));
      if (!f.nome || !f.operadora_id || !f.cnpj_faturamento_id) return toast('Preencha nome, operadora e CNPJ.', true);
      salvar('contratos', f, k.id, fechar);
    }));
  };

  $('#n-cnpj').onclick = () => formCnpj();
  $('#n-ct').onclick = () => (ops.length && cnpjs.length ? formCt() : toast('Cadastre antes uma operadora e um CNPJ.', true));
  $('#n-op').onclick = () => modal(`<h3>Nova operadora</h3><form class="grade-form" id="f">
    <label>Nome<input name="nome" required></label><label>Registro ANS<input name="registro_ans"></label><label>CNPJ<input name="cnpj"></label>
    </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
  (m, fechar) => ($('#s', m).onclick = () => {
    const f = Object.fromEntries(new FormData($('#f', m)));
    if (!f.nome) return toast('Informe o nome.', true); salvar('operadoras', f, null, fechar);
  }));
  $$('[data-ed-cnpj]', c).forEach((b) => (b.onclick = () => formCnpj(cnpjs.find((x) => x.id === b.dataset.edCnpj))));
  $$('[data-ed-ct]', c).forEach((b) => (b.onclick = () => formCt(cts.find((x) => x.id === b.dataset.edCt))));
  $$('[data-tab]', c).forEach((b) => (b.onclick = () => tabela(cts.find((x) => x.id === b.dataset.tab))));
}

// Tabela de valores do contrato (o que a clínica RECEBE). Reajuste cria nova vigência e guarda o histórico.
async function tabela(k) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: itens, error } = await sb.from('contrato_tabela').select('id, valor, vigencia_inicio, procedimentos(id, codigo, descricao)')
    .eq('contrato_id', k.id).is('vigencia_fim', null).order('vigencia_inicio');
  if (error) return falha(error);
  itens.sort((a, b) => a.procedimentos.codigo.localeCompare(b.procedimentos.codigo));
  modal(`<h3>Tabela de valores · ${esc(k.nome)}</h3>
    <div class="dica">Valores que a clínica recebe da operadora. No <strong>reajuste anual</strong>, informe o % e a data: o sistema
      encerra a tabela atual e cria a nova, guardando o histórico (guias antigas continuam com o valor da época).</div>
    <div class="grade-form"><label>Reajuste (%)<input type="number" step="0.01" id="pct" placeholder="ex.: 5,5"></label>
      <label>Vale a partir de<input type="date" id="desde" value="${hoje}"></label>
      <button class="btn escuro" id="reaj">Aplicar reajuste em todos</button></div>
    <div class="tabela-rolagem" style="max-height:50vh;margin-top:12px"><table><thead><tr><th>Código TUSS</th><th>Procedimento</th><th>Desde</th><th class="num">Valor (R$)</th></tr></thead><tbody>
    ${itens.map((i) => `<tr><td>${esc(i.procedimentos.codigo)}</td><td>${esc(i.procedimentos.descricao)}</td><td>${esc(i.vigencia_inicio.split('-').reverse().join('/'))}</td>
      <td class="num"><input type="number" step="0.01" min="0" style="width:100px;text-align:right" data-id="${i.id}" data-orig="${i.valor}" value="${Number(i.valor).toFixed(2)}"></td></tr>`).join('')
      || '<tr><td colspan="4" class="vazio">Sem itens. Cadastre os procedimentos.</td></tr>'}
    </tbody></table></div>
    <div class="grade-form" style="margin-top:12px"><label>Novo código TUSS<input id="ncod"></label><label>Descrição<input id="ndesc"></label>
      <label>Valor<input type="number" step="0.01" id="nval"></label><button class="btn" id="add">Adicionar</button></div>
    <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button><button class="btn primario" id="salvar">Salvar valores alterados</button></div>`,
  (m, fechar) => {
    const novaVigencia = async (id, procId, valor, desde) => {
      const ontem = new Date(new Date(desde + 'T12:00') - 864e5).toISOString().slice(0, 10);
      const r1 = await sb.from('contrato_tabela').update({ vigencia_fim: ontem }).eq('id', id); if (r1.error) throw r1.error;
      const r2 = await sb.from('contrato_tabela').insert({ clinica_id: estado.clinica.id, contrato_id: k.id, procedimento_id: procId, valor, vigencia_inicio: desde });
      if (r2.error) throw r2.error;
    };
    $('#salvar', m).onclick = async () => {
      const alterados = $$('[data-id]', m).filter((x) => Number(x.value).toFixed(2) !== Number(x.dataset.orig).toFixed(2));
      if (!alterados.length) return toast('Nenhum valor alterado.');
      try { for (const x of alterados) { const it = itens.find((i) => i.id === x.dataset.id); await novaVigencia(it.id, it.procedimentos.id, Number(x.value), hoje); } }
      catch (e) { return falha(e); }
      toast(`${alterados.length} valores atualizados.`); fechar(); tabela(k);
    };
    $('#reaj', m).onclick = async () => {
      const pct = Number(String($('#pct', m).value).replace(',', '.')), desde = $('#desde', m).value;
      if (!pct || !desde) return toast('Informe o % e a data.', true);
      if (!(await confirmar(`Reajustar ${itens.length} procedimentos em ${pct}% a partir de ${desde.split('-').reverse().join('/')}?`, 'Reajustar'))) return;
      try { for (const i of itens) await novaVigencia(i.id, i.procedimentos.id, Math.round(i.valor * (1 + pct / 100) * 100) / 100, desde); }
      catch (e) { return falha(e); }
      toast('Reajuste aplicado.'); tabela(k);
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
      if (e) return falha(e); toast('Procedimento adicionado.'); tabela(k);
    };
  });
}
