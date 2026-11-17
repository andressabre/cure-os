// Conciliação bancária: importa extrato OFX/CSV de uma conta e casa cada movimento com um lançamento em aberto do Financeiro.
// Rota sugerida: #conciliacao (gestor, financeiro). Nenhuma baixa sem clique humano. Tabela extrato_movimentos (db/056).
// A baixa grava em `lancamentos` as mesmas colunas do Financeiro → baixar(): status 'pago', valor_realizado, data_realizado,
// conta_id, forma_pagamento, valor_confirmado = true. Leitores e motor de sugestão (puros) em extrato-banco.js.
import { sb, estado, $, $$, esc, brl, data, tela, toast, falha, modal, confirmar, podeGerir, faltaBanco } from '../core.js';
import { decodificar, pareceOFX, lerOFX, lerCSV, distribuir, sugerir, formaPelaDescricao, semAcento } from './extrato-banco.js';
export { sugerir, distribuir } from './extrato-banco.js';

const FORMAS = { pix: 'Pix', boleto: 'Boleto', ted: 'TED/transferência', cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito', dinheiro: 'Dinheiro', debito_automatico: 'Débito automático', repasse_operadora: 'Repasse da operadora' };
const AREAS = { geral: 'Geral', fisioterapia: 'Fisioterapia', nutricao: 'Nutrição', psicologia: 'Psicologia', palmilha: 'Palmilha 3D' };
const FILTROS = [['pendente', 'Pendentes'], ['conciliado', 'Conciliados'], ['ignorado', 'Ignorados'], ['todos', 'Todos']];
const NIVEL = { certo: ['ok', 'certo'], provavel: ['pendente', 'provável'], escolher: ['alerta', 'escolher'] };
const opts = (lista, sel, vazio) => (vazio != null ? `<option value="">${esc(vazio)}</option>` : '') +
  lista.map(([v, n]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(n)}</option>`).join('');
const soma = (l) => l.reduce((s, m) => s + Math.abs(Number(m.valor)), 0);
const r2 = (v) => Math.round(v * 100) / 100;
const lote = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function linkCss() {
  // Enquanto o arquiteto não liga css/conciliacao.css no index.html (depois disso esta função não faz nada)
  if (document.querySelector('link[href*="conciliacao.css"]')) return;
  document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'css/conciliacao.css' }));
}

export async function render() {
  linkCss();
  const c = tela('Conciliação bancária');
  if (!podeGerir()) { c.innerHTML = '<div class="cartao vazio">A conciliação bancária é da gestão e do financeiro.</div>'; return; }
  const cid = estado.clinica.id;

  const [{ data: carts, error: e1 }, { data: contas0, error: e2 }, { data: cats0, error: e3 }] = await Promise.all([
    sb.from('carteiras').select('*').eq('clinica_id', cid).eq('ativo', true).order('ordem'),
    sb.from('contas_financeiras').select('*').eq('clinica_id', cid).eq('ativo', true).order('nome'),
    sb.from('categorias_financeiras').select('*').eq('clinica_id', cid).eq('ativo', true).order('ordem'),
  ]);
  if (e1 || e2 || e3) return falha(e1 || e2 || e3, 'Conciliação');
  // Carteira pessoal só para gestor (a RLS já esconde do financeiro; aqui também na tela)
  const visiveis = (carts || []).filter((k) => k.tipo === 'empresa' || estado.perfil === 'gestor');
  const cart = visiveis.find((k) => k.id === sessionStorage.getItem('conc-cart')) || visiveis.find((k) => k.tipo === 'empresa') || visiveis[0];
  const contas = (contas0 || []).filter((k) => cart && (k.carteira_id ? k.carteira_id === cart.id : cart.tipo === 'empresa'));
  const navCart = visiveis.length > 1 ? `<div class="carteiras">${visiveis.map((k) => `<a href="#" data-cart="${esc(k.id)}" class="${k.tipo === 'pessoal' ? 'pessoal' : ''} ${k.id === cart.id ? 'ativa' : ''}">${esc(k.nome)}</a>`).join('')}</div>` : '';
  c.onclick = (e) => { const a = e.target.closest('[data-cart]'); if (!a) return; e.preventDefault(); sessionStorage.setItem('conc-cart', a.dataset.cart); render(); };

  if (!contas.length) {
    c.innerHTML = navCart + `<div class="cartao cc-vazio">
      <h3>Conciliação ainda sem conta bancária</h3>
      <p class="muted">Aqui o extrato do banco encontra os lançamentos do Financeiro: cada crédito do convênio, Pix ou cartão é casado com o "a receber" certo, e cada débito com a conta a pagar. Você confere e confirma com um clique.</p>
      <ol class="cc-passos">
        <li><strong>Cadastre a conta</strong> no Financeiro → Contas e categorias, com o saldo inicial.</li>
        <li><strong>Baixe o extrato</strong> no internet banking, de preferência em <strong>OFX</strong> (Money/Quicken). CSV também serve.</li>
        <li><strong>Importe aqui</strong>: o sistema mostra a prévia, ignora o que já foi importado e sugere os casamentos.</li>
      </ol>
      <a class="btn primario" href="#financeiro-cadastros">Cadastrar conta no Financeiro</a></div>`;
    return;
  }
  const conta = contas.find((k) => k.id === sessionStorage.getItem('conc-conta')) || contas[0];
  const filtro = sessionStorage.getItem('conc-filtro') || 'pendente';

  // ---------------- dados ----------------
  const [{ data: movs, error: e4 }, { data: abertos, error: e5 }, { data: pagos, error: e6 }] = await Promise.all([
    sb.from('extrato_movimentos').select('*').eq('conta_id', conta.id).order('data', { ascending: false }).limit(2000),
    sb.from('lancamentos').select('*').eq('clinica_id', cid).eq('carteira_id', cart.id).eq('status', 'previsto').order('vencimento'),
    sb.from('lancamentos').select('id, tipo, valor_realizado, data_realizado').eq('conta_id', conta.id).eq('status', 'pago'),
  ]);
  if (faltaBanco(e4, c, 'db/056_extrato_bancario.sql')) return;   // 056 ainda não aplicada: cartão "Falta um passo" em vez de erro
  if (e4 || e5 || e6) return falha(e4 || e5 || e6, 'Conciliação');
  const ligadosIds = [...new Set(movs.filter((m) => m.lancamento_id).map((m) => m.lancamento_id))];
  const ligados = {};
  for (const ids of lote(ligadosIds, 100)) {
    const { data: ls, error } = await sb.from('lancamentos').select('*').in('id', ids);
    if (error) return falha(error, 'Conciliação'); ls.forEach((l) => (ligados[l.id] = l));
  }
  const pend = movs.filter((m) => m.situacao === 'pendente'), conc = movs.filter((m) => m.situacao === 'conciliado'), ign = movs.filter((m) => m.situacao === 'ignorado');
  const sug = distribuir([...pend].sort((a, b) => a.data.localeCompare(b.data)), abertos);
  const certos = pend.filter((m) => sug.get(m.id)?.situacao === 'certo');

  // saldo do arquivo (só OFX; guardado na sessão ao importar) × saldo do sistema na conta
  let saldoArq = null; try { saldoArq = JSON.parse(sessionStorage.getItem('conc-saldo-' + conta.id) || 'null'); } catch {}
  const saldoSistema = (ate) => Number(conta.saldo_inicial || 0) + pagos.filter((l) => l.data_realizado >= conta.data_saldo_inicial && l.data_realizado <= ate)
    .reduce((s, l) => s + (l.tipo === 'receber' ? 1 : -1) * Number(l.valor_realizado), 0);

  const lista = filtro === 'todos' ? movs : movs.filter((m) => m.situacao === filtro);
  c.innerHTML = navCart + `
    <div class="cc-topo">
      <label class="cc-conta">Conta<select id="cc-conta">${opts(contas.map((k) => [k.id, k.nome + (k.banco ? ' · ' + k.banco : '')]), conta.id)}</select></label>
      <button class="btn primario" id="cc-importar">Importar extrato</button>
      <input type="file" id="cc-arquivo" accept=".ofx,.qfx,.csv,.txt" hidden>
    </div>
    <div class="kpis">
      <div class="kpi ${pend.length ? 'alerta' : ''}"><div class="rotulo">Pendentes</div><div class="valor">${pend.length}</div><div class="sub">${brl(soma(pend))} · ${certos.length} certo(s)</div></div>
      <div class="kpi"><div class="rotulo">Conciliados</div><div class="valor">${conc.length}</div><div class="sub">${brl(soma(conc))}</div></div>
      <div class="kpi"><div class="rotulo">Ignorados</div><div class="valor">${ign.length}</div><div class="sub">transferências, tarifas sem lançamento…</div></div>
      ${saldoArq ? (() => { const sis = saldoSistema(saldoArq.data || new Date().toLocaleDateString('sv')), dif = r2(saldoArq.valor - sis);
        return `<div class="kpi ${Math.abs(dif) > 0.009 ? 'alerta' : ''}"><div class="rotulo">Banco × sistema${saldoArq.data ? ' em ' + data(saldoArq.data) : ''}</div>
          <div class="valor">${Math.abs(dif) > 0.009 ? brl(dif) : 'confere'}</div><div class="sub">banco ${brl(saldoArq.valor)} · sistema ${brl(sis)}</div></div>`; })() : ''}
    </div>
    <div class="cc-barra">
      <div class="cc-chips">${FILTROS.map(([k, n]) => `<button class="chip-filtro ${k === filtro ? 'on' : ''}" data-filtro="${k}">${n} <b>${k === 'todos' ? movs.length : movs.filter((m) => m.situacao === k).length}</b></button>`).join('')}</div>
      ${certos.length ? `<button class="btn primario" id="cc-todos">Confirmar todos os certos (${certos.length})</button>` : ''}
    </div>
    ${movs.length ? '' : `<div class="dica">Nenhum movimento importado nesta conta ainda. Baixe o extrato em OFX no internet banking e use <strong>Importar extrato</strong>.</div>`}
    <div class="cc-lista">${lista.length ? lista.map((m) => linha(m)).join('') : (movs.length ? `<div class="cartao vazio">${filtro === 'pendente' ? 'Tudo conciliado nesta conta. 👏' : 'Nada nesta situação.'}</div>` : '')}</div>`;

  function linha(m) {
    const cred = Number(m.valor) > 0, l = m.lancamento_id ? ligados[m.lancamento_id] : null;
    const mov = `<div class="cc-mov">
        <div class="cc-data">${data(m.data)}</div>
        <div class="cc-desc"><strong>${esc(m.descricao || '(sem descrição)')}</strong>${m.documento ? ` <small class="muted">doc ${esc(m.documento)}</small>` : ''}</div>
        <div class="cc-valor ${cred ? 'cred' : 'deb'}">${cred ? '+' : '−'} ${brl(Math.abs(m.valor))}</div></div>`;
    let lado;
    if (m.situacao === 'conciliado') {
      lado = `<div class="cc-sug ok"><span class="selo ok">conciliado</span> ${l ? `<strong>${esc(l.descricao)}</strong> <small class="muted">${m.lancamento_criado ? 'criado aqui' : 'previsto ' + brl(l.valor_previsto) + ' · venc. ' + data(l.vencimento)}</small>` : '<small class="muted">lançamento não encontrado</small>'}
        <div class="cc-acoes"><button class="btn pequeno" data-desfazer="${esc(m.id)}">Desfazer</button></div></div>`;
    } else if (m.situacao === 'ignorado') {
      lado = `<div class="cc-sug"><span class="selo outra">ignorado</span><div class="cc-acoes"><button class="btn pequeno" data-desfazer="${esc(m.id)}">Desfazer</button></div></div>`;
    } else {
      const s = sug.get(m.id), b = s?.melhor;
      const [cl, rot] = NIVEL[s?.situacao] || [];
      lado = `<div class="cc-sug ${b ? '' : 'sem'}">${b ? `<div><span class="selo ${cl}">${rot}</span> <strong>${esc(b.lancamento.descricao)}</strong></div>
          <div class="cc-motivo">venc. ${data(b.lancamento.vencimento)} · previsto ${brl(b.lancamento.valor_previsto)} — ${esc(b.motivo)}</div>
          ${Math.abs(b.diferenca) > 0.009 ? `<div class="cc-dif">Diferença: banco ${b.diferenca < 0 ? 'menor' : 'maior'} em ${brl(Math.abs(b.diferenca))}</div>` : ''}
          ${s.candidatos.length > 1 ? `<div class="cc-motivo">+ ${s.candidatos.length - 1} outra(s) possibilidade(s)</div>` : ''}`
        : `<div class="muted">Sem lançamento em aberto parecido (${cred ? 'a receber' : 'a pagar'}).</div>`}
        <div class="cc-acoes">
          ${b ? `<button class="btn pequeno primario" data-confirmar="${esc(m.id)}">Confirmar</button>` : ''}
          <button class="btn pequeno" data-escolher="${esc(m.id)}">${b ? 'Escolher outro' : 'Escolher'}</button>
          <button class="btn pequeno" data-criar="${esc(m.id)}">Criar lançamento</button>
          <button class="btn pequeno fantasma" data-ignorar="${esc(m.id)}">Ignorar</button></div></div>`;
    }
    return `<div class="cartao cc-item cc-${m.situacao}">${mov}${lado}</div>`;
  }

  // ---------------- gravações ----------------
  const porId = Object.fromEntries(movs.map((m) => [m.id, m]));
  const recarregar = () => render();

  // Dá a baixa (igual ao Financeiro) e marca o movimento. Guarda o estado anterior para o "Desfazer".
  async function baixar(m, l) {
    const antes = { status: l.status, valor_realizado: l.valor_realizado ?? null, data_realizado: l.data_realizado ?? null,
      conta_id: l.conta_id ?? null, forma_pagamento: l.forma_pagamento ?? null, valor_confirmado: !!l.valor_confirmado };
    const baixa = { valor_confirmado: true, status: 'pago', data_realizado: m.data, valor_realizado: Math.abs(Number(m.valor)),
      conta_id: conta.id, forma_pagamento: l.forma_pagamento || formaPelaDescricao(m.descricao) || null };
    const { data: ok, error } = await sb.from('lancamentos').update(baixa).eq('id', l.id).eq('status', 'previsto').select('id');
    if (error) throw error;
    if (!ok?.length) throw new Error(`"${l.descricao}" não está mais em aberto (alguém baixou ou cancelou). Atualize a tela.`);
    const { error: e2 } = await sb.from('extrato_movimentos').update({ situacao: 'conciliado', lancamento_id: l.id, baixa_anterior: antes,
      lancamento_criado: false, conciliado_em: new Date().toISOString() }).eq('id', m.id).eq('situacao', 'pendente');
    if (e2) { await sb.from('lancamentos').update(antes).eq('id', l.id); throw e2; }   // volta a baixa se não marcou o movimento
  }

  async function confirmarUm(m, l) {
    const dif = r2(Math.abs(Number(m.valor)) - Number(l.valor_previsto));
    if (Math.abs(dif) > 0.009 && !(await confirmar(`Banco: ${brl(Math.abs(m.valor))} · previsto: ${brl(l.valor_previsto)} → diferença de ${brl(dif)}${dif < 0 && l.lote_id ? ' (possível glosa — confira no retorno da operadora)' : ''}. O lançamento "${l.descricao}" fica pago com o valor do banco, em ${data(m.data)}.`, 'Dar baixa com o valor do banco'))) return;
    try { await baixar(m, l); toast('Conciliado e baixado.'); } catch (e) { return falha(e, 'Confirmar'); }
    recarregar();
  }

  function escolher(m) {
    const tipo = Number(m.valor) > 0 ? 'receber' : 'pagar', v = Math.abs(Number(m.valor));
    const cands = abertos.filter((l) => l.tipo === tipo).sort((a, b) => Math.abs(a.valor_previsto - v) - Math.abs(b.valor_previsto - v));
    const sugIds = new Map(sugerir(m, abertos).map((x) => [x.lancamento_id, x]));
    modal(`<h3>Escolher lançamento ${tipo === 'receber' ? 'a receber' : 'a pagar'}</h3>
      <p class="muted">${data(m.data)} · <strong>${esc(m.descricao || '')}</strong> · ${brl(v)}</p>
      <input id="cc-busca" placeholder="Buscar por descrição, pagador ou valor" autocomplete="off">
      <div class="cc-escolha" id="cc-esc"></div>
      <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button></div>`, (cx, fechar) => {
      const desenha = () => {
        const q = semAcento($('#cc-busca', cx).value.trim());
        const vis = cands.filter((l) => !q || semAcento([l.descricao, l.fornecedor, String(l.valor_previsto).replace('.', ',')].join(' ')).includes(q)).slice(0, 60);
        $('#cc-esc', cx).innerHTML = vis.length ? vis.map((l) => { const d = r2(v - l.valor_previsto), sx = sugIds.get(l.id);
          return `<div class="cc-op"><div><strong>${esc(l.descricao)}</strong>${l.fornecedor ? ` <small class="muted">${esc(l.fornecedor)}</small>` : ''}
            <div class="cc-motivo">venc. ${data(l.vencimento)} · previsto ${brl(l.valor_previsto)}${Math.abs(d) > 0.009 ? ` · <span class="cc-dif-txt">diferença ${brl(d)}</span>` : ''}${sx ? ' · ' + esc(sx.motivo) : ''}</div></div>
            <button class="btn pequeno primario" data-usar="${esc(l.id)}">Usar este</button></div>`; }).join('')
          : `<div class="vazio">Nenhum lançamento ${tipo === 'receber' ? 'a receber' : 'a pagar'} em aberto${q ? ' com essa busca' : ''}. Use "Criar lançamento".</div>`;
        $$('[data-usar]', cx).forEach((b) => (b.onclick = () => { const l = cands.find((x) => x.id === b.dataset.usar); fechar(); confirmarUm(m, l); }));
      };
      $('#cc-busca', cx).oninput = desenha; desenha();
    });
  }

  function criar(m) {
    const receber = Number(m.valor) > 0, v = Math.abs(Number(m.valor)), pessoal = cart.tipo === 'pessoal';
    const cats = (cats0 || []).filter((k) => (k.uso || 'empresa') === (pessoal ? 'pessoal' : 'empresa') && k.tipo === (receber ? 'receita' : 'despesa'));
    modal(`<h3>Criar lançamento ${receber ? 'recebido' : 'pago'}</h3>
      <p class="muted">${data(m.data)} · ${brl(v)} · ${esc(conta.nome)}. Já nasce ${receber ? 'recebido' : 'pago'} e conciliado.</p>
      <form class="grade-form" id="cc-f">
        <label style="grid-column:1/-1">Descrição<input name="descricao" required value="${esc(m.descricao || '')}"></label>
        <label>Categoria<select name="categoria_id">${opts(cats.map((k) => [k.id, k.nome]), '', 'Sem categoria')}</select></label>
        ${pessoal ? '' : `<label>Área<select name="area">${opts(Object.entries(AREAS), 'geral')}</select></label>`}
        <label>${receber ? 'Pagador' : 'Fornecedor / favorecido'}<input name="fornecedor"></label>
        <label>Forma<select name="forma_pagamento">${opts(Object.entries(FORMAS), formaPelaDescricao(m.descricao), '—')}</select></label>
      </form>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="cc-salvar">Criar e conciliar</button></div>`, (cx, fechar) => {
      $('#cc-salvar', cx).onclick = async () => {
        const f = Object.fromEntries(new FormData($('#cc-f', cx)));
        if (!f.descricao.trim()) return toast('Informe a descrição.', true);
        const { data: novo, error } = await sb.from('lancamentos').insert({ clinica_id: cid, carteira_id: cart.id, tipo: receber ? 'receber' : 'pagar',
          descricao: f.descricao.trim(), categoria_id: f.categoria_id || null, area: pessoal ? 'geral' : f.area || 'geral', fornecedor: f.fornecedor || null,
          competencia: m.data.slice(0, 7) + '-01', vencimento: m.data, valor_previsto: v, status: 'pago', valor_realizado: v, data_realizado: m.data,
          conta_id: conta.id, forma_pagamento: f.forma_pagamento || null, valor_confirmado: true, documento: m.documento || null, origem: 'extrato' }).select('id').single();
        if (error) return falha(error, 'Criar lançamento');
        const { error: e2 } = await sb.from('extrato_movimentos').update({ situacao: 'conciliado', lancamento_id: novo.id, lancamento_criado: true,
          baixa_anterior: null, conciliado_em: new Date().toISOString() }).eq('id', m.id).eq('situacao', 'pendente');
        if (e2) { await sb.from('lancamentos').update({ status: 'cancelado' }).eq('id', novo.id); return falha(e2, 'Conciliar'); }
        fechar(); toast('Lançamento criado e conciliado.'); recarregar();
      };
    });
  }

  async function ignorar(m) {
    const { error } = await sb.from('extrato_movimentos').update({ situacao: 'ignorado', conciliado_em: new Date().toISOString() }).eq('id', m.id).eq('situacao', 'pendente');
    if (error) return falha(error, 'Ignorar'); toast('Ignorado. Dá para desfazer.'); recarregar();
  }

  // Desfazer: só volta o lançamento para "previsto" se foi esta conciliação que deu a baixa e ninguém mexeu depois.
  async function desfazer(m) {
    const l = m.lancamento_id ? ligados[m.lancamento_id] : null;
    const texto = m.situacao === 'ignorado' ? 'Voltar este movimento para pendente?'
      : m.lancamento_criado ? `Desfazer a conciliação? O lançamento "${l?.descricao || ''}" criado aqui será cancelado.`
      : m.baixa_anterior ? `Desfazer a conciliação? "${l?.descricao || ''}" volta a ficar em aberto.` : 'Desfazer a conciliação? O lançamento fica como está.';
    if (!(await confirmar(texto, 'Desfazer'))) return;
    let aviso = '';
    if (m.situacao === 'conciliado' && m.lancamento_id) {
      if (m.lancamento_criado) {
        const { error } = await sb.from('lancamentos').update({ status: 'cancelado' }).eq('id', m.lancamento_id).eq('origem', 'extrato');
        if (error) return falha(error, 'Desfazer');
      } else if (m.baixa_anterior) {
        const { data: ok, error } = await sb.from('lancamentos').update(m.baixa_anterior).eq('id', m.lancamento_id).eq('status', 'pago')
          .eq('data_realizado', m.data).eq('conta_id', m.conta_id).select('id');
        if (error) return falha(error, 'Desfazer');
        if (!ok?.length) aviso = ' O lançamento foi alterado depois da conciliação e ficou como está.';
      }
    }
    const { error } = await sb.from('extrato_movimentos').update({ situacao: 'pendente', lancamento_id: null, baixa_anterior: null,
      lancamento_criado: false, conciliado_em: null }).eq('id', m.id);
    if (error) return falha(error, 'Desfazer');
    toast('Desfeito.' + aviso); recarregar();
  }

  async function confirmarTodos() {
    const itens = certos.map((m) => [m, sug.get(m.id).melhor.lancamento]);
    if (!(await confirmar(`Dar baixa em ${itens.length} lançamento(s) com valor igual ao banco e vencimento a até 5 dias da data do extrato, somando ${brl(soma(itens.map(([m]) => m)))}? Cada um fica pago na data do banco.`, `Confirmar ${itens.length}`))) return;
    let ok = 0; const erros = [];
    for (const [m, l] of itens) { try { await baixar(m, l); ok++; } catch (e) { erros.push(e.message || String(e)); } }
    if (erros.length) { console.warn('Conciliação em lote', erros); toast(`${ok} conciliado(s); ${erros.length} não: ${erros[0]}`, true); } else toast(`${ok} conciliado(s).`);
    recarregar();
  }

  // ---------------- eventos ----------------
  $('#cc-conta').onchange = (e) => { sessionStorage.setItem('conc-conta', e.target.value); render(); };
  $$('[data-filtro]', c).forEach((b) => (b.onclick = () => { sessionStorage.setItem('conc-filtro', b.dataset.filtro); render(); }));
  $('#cc-todos')?.addEventListener('click', confirmarTodos);
  $$('[data-confirmar]', c).forEach((b) => (b.onclick = () => { const m = porId[b.dataset.confirmar]; confirmarUm(m, sug.get(m.id).melhor.lancamento); }));
  $$('[data-escolher]', c).forEach((b) => (b.onclick = () => escolher(porId[b.dataset.escolher])));
  $$('[data-criar]', c).forEach((b) => (b.onclick = () => criar(porId[b.dataset.criar])));
  $$('[data-ignorar]', c).forEach((b) => (b.onclick = () => ignorar(porId[b.dataset.ignorar])));
  $$('[data-desfazer]', c).forEach((b) => (b.onclick = () => desfazer(porId[b.dataset.desfazer])));
  $('#cc-importar').onclick = () => $('#cc-arquivo').click();
  $('#cc-arquivo').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('Arquivo acima de 5 MB. Exporte um período menor.', true);
    let texto; try { texto = decodificar(await f.arrayBuffer()); } catch (err) { return falha(err, 'Ler arquivo'); }
    if (pareceOFX(texto)) { const r = lerOFX(texto); return r.erro ? toast(r.erro, true) : previa(r, f.name); }
    const r = lerCSV(texto);
    return r.erro ? mapear(texto, r, f.name) : previa(r, f.name);
  };

  // CSV que não deu para entender: a pessoa diz o que é cada coluna
  function mapear(texto, r, nome) {
    const PAPEIS = [['', '— ignorar —'], ['data', 'Data'], ['descricao', 'Descrição / histórico'], ['valor', 'Valor (com sinal)'], ['credito', 'Crédito / entrada'], ['debito', 'Débito / saída'], ['documento', 'Documento']];
    const ncol = Math.max(r.cabecalho.length, ...r.amostra.map((l) => l.length));
    modal(`<h3>Quais são as colunas?</h3>
      <p class="muted">${esc(r.erro)} Escolha o que cada coluna significa (pelo menos Data e Valor, ou Data e Crédito/Débito).</p>
      <div class="tabela-rolagem"><table class="cc-mapa"><thead><tr>${Array.from({ length: ncol }, (_, j) => `<th><select data-col="${j}">${opts(PAPEIS, '')}</select><div class="muted">${esc(r.cabecalho[j] || 'Coluna ' + (j + 1))}</div></th>`).join('')}</tr></thead>
      <tbody>${r.amostra.slice(0, 6).map((l) => `<tr>${Array.from({ length: ncol }, (_, j) => `<td>${esc(l[j] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <label class="cc-chk"><input type="checkbox" id="cc-tem-cab" ${r.linhaCabecalho >= 0 ? 'checked' : ''}> A primeira linha acima do exemplo é o cabeçalho (não é movimento)</label>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="cc-ler">Ler com estas colunas</button></div>`, (cx) => {
      $('#cc-ler', cx).onclick = () => {
        const mapa = {}; $$('[data-col]', cx).forEach((s) => { if (s.value && mapa[s.value] == null) mapa[s.value] = Number(s.dataset.col); });
        if (mapa.data == null || (mapa.valor == null && mapa.credito == null && mapa.debito == null)) return toast('Indique a coluna de data e a de valor (ou crédito/débito).', true);
        const r2_ = lerCSV(texto, { mapa, separador: r.separador, linhaCabecalho: $('#cc-tem-cab', cx).checked ? r.linhaCabecalho : -1 });
        if (r2_.erro) return toast(r2_.erro, true);
        previa(r2_, nome);
      };
    });
  }

  async function previa(r, nome) {
    const ids = r.movimentos.map((m) => m.id_banco), ja = new Set();
    for (const parte of lote(ids, 100)) {
      const { data: ex, error } = await sb.from('extrato_movimentos').select('id_banco').eq('conta_id', conta.id).in('id_banco', parte);
      if (error) return falha(error, 'Prévia'); ex.forEach((x) => ja.add(x.id_banco));
    }
    const novos = r.movimentos.filter((m) => !ja.has(m.id_banco));
    const cr = r.movimentos.filter((m) => m.valor > 0), db = r.movimentos.filter((m) => m.valor < 0);
    const dig = (s) => String(s || '').replace(/\D/g, '');
    const contaDif = r.conta && conta.conta && !dig(r.conta).includes(dig(conta.conta).replace(/^0+/, '')) && !dig(conta.conta).includes(dig(r.conta).replace(/^0+/, ''));
    modal(`<h3>Prévia do extrato</h3>
      <p class="muted">${esc(nome)} → <strong>${esc(conta.nome)}</strong></p>
      ${contaDif ? `<div class="dica">O arquivo é da conta <strong>${esc(r.conta)}</strong>, mas a conta escolhida está cadastrada como <strong>${esc(conta.conta)}</strong>. Confira antes de importar.</div>` : ''}
      ${r.moeda && r.moeda !== 'BRL' ? `<div class="dica">Moeda do arquivo: ${esc(r.moeda)}.</div>` : ''}
      <div class="cc-previa">
        <div><span class="rotulo">Período</span><strong>${data(r.inicio)} a ${data(r.fim)}</strong></div>
        <div><span class="rotulo">Movimentos</span><strong>${r.movimentos.length}</strong></div>
        <div><span class="rotulo">Créditos</span><strong class="cred">${cr.length} · ${brl(soma(cr))}</strong></div>
        <div><span class="rotulo">Débitos</span><strong class="deb">${db.length} · ${brl(soma(db))}</strong></div>
        <div><span class="rotulo">Já importados</span><strong>${ja.size}</strong></div>
        ${r.saldo != null ? `<div><span class="rotulo">Saldo no arquivo</span><strong>${brl(r.saldo)}${r.saldo_data ? ' em ' + data(r.saldo_data) : ''}</strong></div>` : ''}
      </div>
      ${r.descartadas ? `<p class="muted">${r.descartadas} linha(s) sem data/valor (saldos, totais) foram deixadas de fora.</p>` : ''}
      <p class="muted">Nada é baixado agora: os movimentos entram como pendentes e você confirma cada casamento.</p>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button>
        <button class="btn primario" id="cc-gravar" ${novos.length ? '' : 'disabled'}>${novos.length ? `Importar ${novos.length} novo(s)` : 'Nada novo para importar'}</button></div>`, (cx, fechar) => {
      $('#cc-gravar', cx).onclick = async () => {
        $('#cc-gravar', cx).disabled = true;
        const linhas = novos.map((m) => ({ clinica_id: cid, conta_id: conta.id, data: m.data, valor: m.valor, descricao: m.descricao || null,
          documento: m.documento || null, id_banco: m.id_banco, arquivo: nome }));
        for (const parte of lote(linhas, 500)) {
          const { error } = await sb.from('extrato_movimentos').insert(parte);
          if (error) { $('#cc-gravar', cx).disabled = false; return falha(error, 'Importar'); }
        }
        if (r.saldo != null) sessionStorage.setItem('conc-saldo-' + conta.id, JSON.stringify({ valor: r.saldo, data: r.saldo_data || r.fim }));
        sessionStorage.setItem('conc-filtro', 'pendente');
        fechar(); toast(`${linhas.length} movimento(s) importado(s).`); recarregar();
      };
    });
  }
}
