// Módulo Financeiro gerencial: lançamentos (a receber / a pagar), caixa por conta, DRE e cadastros.
// Rota: #financeiro-<aba>-<AAAA-MM>. Só gestor e financeiro (RLS).
import { sb, estado, $, $$, esc, brl, pct, data, tela, toast, falha, modal, confirmar } from '../core.js';

const ABAS = [['lancamentos', 'Lançamentos'], ['caixa', 'Caixa'], ['dre', 'DRE gerencial'], ['cadastros', 'Contas e categorias']];
const AREAS = { geral: 'Geral', fisioterapia: 'Fisioterapia', nutricao: 'Nutrição', psicologia: 'Psicologia', palmilha: 'Palmilha 3D' };
const FORMAS = { pix: 'Pix', boleto: 'Boleto', ted: 'TED/transferência', cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito', dinheiro: 'Dinheiro', debito_automatico: 'Débito automático', repasse_operadora: 'Repasse da operadora' };
const GRUPOS = [['receita_bruta', 'Receita bruta'], ['deducoes', '(−) Deduções: impostos e taxas'], ['custo_direto', '(−) Custos diretos'],
  ['despesa_operacional', '(−) Despesas operacionais'], ['resultado_financeiro', '(±) Resultado financeiro'],
  ['investimento', 'Investimentos (fora do resultado)'], ['retirada', 'Distribuição de lucros (fora do resultado)'], ['transferencia', 'Transferências']];
const hoje = () => new Date().toISOString().slice(0, 10);
const mesAtual = () => hoje().slice(0, 7);
const somaMes = (ym, n) => { const [a, m] = ym.split('-').map(Number); const d = new Date(a, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fimMes = (ym) => { const [a, m] = ym.split('-').map(Number); return new Date(a, m, 0).toISOString().slice(0, 10); };
const nomeMes = (ym) => new Date(ym + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const opts = (lista, sel, vazio) => (vazio ? `<option value="">${vazio}</option>` : '') +
  lista.map(([v, n]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(n)}</option>`).join('');

export async function render(params = '') {
  const [aba0, ...r] = params.split('-');
  const aba = ABAS.some(([k]) => k === aba0) ? aba0 : 'lancamentos';
  const ym = /^\d{4}-\d{2}$/.test(r.join('-')) ? r.join('-') : mesAtual();
  const ir = (a, m = ym) => (location.hash = `financeiro-${a}-${m}`);

  const c = tela('Financeiro', `<button class="btn" id="ant">‹</button><strong style="min-width:150px;text-align:center;text-transform:capitalize">${nomeMes(ym)}</strong><button class="btn" id="prox">›</button>`);
  $('#ant').onclick = () => ir(aba, somaMes(ym, -1));
  $('#prox').onclick = () => ir(aba, somaMes(ym, 1));

  const cid = estado.clinica.id;
  const [{ data: cats, error: e1 }, { data: contas, error: e2 }] = await Promise.all([
    sb.from('categorias_financeiras').select('*').eq('clinica_id', cid).order('ordem'),
    sb.from('contas_financeiras').select('*').eq('clinica_id', cid).order('nome'),
  ]);
  if (e1 || e2) return falha(e1 || e2, 'Financeiro');
  const catPor = Object.fromEntries(cats.map((k) => [k.id, k]));
  const contaPor = Object.fromEntries(contas.map((k) => [k.id, k]));
  const nav = `<nav class="abas">${ABAS.map(([k, n]) => `<a href="#financeiro-${k}-${ym}" class="${k === aba ? 'ativa' : ''}">${n}</a>`).join('')}</nav>`;

  // ---------------- Lançamentos ----------------
  async function lancamentos() {
    const ini = ym + '-01', fim = fimMes(ym);
    const { data: ls, error } = await sb.from('lancamentos').select('*').eq('clinica_id', cid)
      .neq('status', 'cancelado').gte('vencimento', ini).lte('vencimento', fim).order('vencimento');
    if (error) return falha(error);
    const { data: atrasados } = await sb.from('lancamentos').select('id, tipo, valor_previsto').eq('clinica_id', cid)
      .eq('status', 'previsto').lt('vencimento', ini);
    const filtro = sessionStorage.getItem('fin-filtro') || 'todos';
    const visiveis = ls.filter((l) => filtro === 'todos' || l.tipo === filtro);
    const soma = (t, st) => ls.filter((l) => l.tipo === t && (!st || l.status === st)).reduce((s, l) => s + Number(l.status === 'pago' ? l.valor_realizado : l.valor_previsto), 0);
    const rec = soma('receber'), recOk = soma('receber', 'pago'), pag = soma('pagar'), pagOk = soma('pagar', 'pago');
    const atrR = (atrasados || []).filter((l) => l.tipo === 'receber'), atrP = (atrasados || []).filter((l) => l.tipo === 'pagar');
    const vencido = (l) => l.status === 'previsto' && l.vencimento < hoje();

    c.innerHTML = nav + `
      <div class="kpis">
        <div class="kpi"><div class="rotulo">A receber no mês</div><div class="valor">${brl(rec)}</div><div class="sub">recebido ${brl(recOk)}</div></div>
        <div class="kpi"><div class="rotulo">A pagar no mês</div><div class="valor">${brl(pag)}</div><div class="sub">pago ${brl(pagOk)}</div></div>
        <div class="kpi ${rec - pag < 0 ? 'alerta' : ''}"><div class="rotulo">Saldo previsto do mês</div><div class="valor">${brl(rec - pag)}</div><div class="sub">realizado ${brl(recOk - pagOk)}</div></div>
        <div class="kpi ${atrR.length + atrP.length ? 'alerta' : ''}"><div class="rotulo">Em atraso (meses anteriores)</div><div class="valor">${atrR.length + atrP.length}</div>
          <div class="sub">receber ${brl(atrR.reduce((s, l) => s + Number(l.valor_previsto), 0))} · pagar ${brl(atrP.reduce((s, l) => s + Number(l.valor_previsto), 0))}</div></div>
      </div>
      ${contas.length ? '' : '<div class="dica"><strong>Comece pelas contas:</strong> cadastre a conta bancária e o caixa em "Contas e categorias", com o saldo inicial. Sem isso o Caixa não fecha.</div>'}
      <div class="linha-acoes" style="justify-content:flex-start;margin-bottom:12px">
        <button class="btn primario" id="nr">+ A receber</button><button class="btn primario" id="np">+ A pagar</button>
        <button class="btn" id="rep">Gerar repasse de ${nomeMes(somaMes(ym, -1))}</button>
        <select id="filtro" style="margin-left:auto">${opts([['todos', 'Todos'], ['receber', 'Só a receber'], ['pagar', 'Só a pagar']], filtro)}</select>
      </div>
      <div class="cartao tabela-rolagem">${visiveis.length ? `<table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Área</th>
        <th class="num">Previsto</th><th>Situação</th><th class="num">Realizado</th><th></th></tr></thead><tbody>
        ${visiveis.map((l) => `<tr>
          <td>${data(l.vencimento)}</td>
          <td><span class="selo ${l.tipo === 'receber' ? 'ok' : 'outra'}">${l.tipo === 'receber' ? '↓ receber' : '↑ pagar'}</span>
            <strong>${esc(l.descricao)}</strong>${l.parcela ? ` <small>(${esc(l.parcela)})</small>` : ''}${l.fornecedor ? `<br><small>${esc(l.fornecedor)}</small>` : ''}</td>
          <td>${esc(catPor[l.categoria_id]?.nome || '—')}</td><td>${esc(AREAS[l.area] || '—')}</td>
          <td class="num">${brl(l.valor_previsto)}</td>
          <td>${l.status === 'pago' ? `<span class="selo ok">${l.tipo === 'receber' ? 'recebido' : 'pago'} ${data(l.data_realizado)}</span>`
            : vencido(l) ? '<span class="selo alerta">vencido</span>' : '<span class="selo pendente">previsto</span>'}</td>
          <td class="num">${l.status === 'pago' ? brl(l.valor_realizado) : ''}</td>
          <td style="white-space:nowrap">${l.status === 'previsto' ? `<button class="btn pequeno primario" data-baixa="${l.id}">Baixar</button>` : `<button class="btn pequeno" data-estorna="${l.id}">Estornar</button>`}
            <button class="btn pequeno" data-ed="${l.id}">Editar</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="vazio">Nenhum lançamento com vencimento neste mês.</div>'}</div>`;

    $('#filtro').onchange = (e) => { sessionStorage.setItem('fin-filtro', e.target.value); lancamentos(); };
    $('#nr').onclick = () => formLanc({ tipo: 'receber' });
    $('#np').onclick = () => formLanc({ tipo: 'pagar' });
    $('#rep').onclick = gerarRepasse;
    $$('[data-ed]', c).forEach((b) => (b.onclick = () => formLanc(ls.find((l) => l.id === b.dataset.ed))));
    $$('[data-baixa]', c).forEach((b) => (b.onclick = () => baixar(ls.find((l) => l.id === b.dataset.baixa))));
    $$('[data-estorna]', c).forEach((b) => (b.onclick = async () => {
      if (!(await confirmar('Voltar este lançamento para "previsto"? O valor sai do caixa.', 'Estornar'))) return;
      const { error: e } = await sb.from('lancamentos').update({ status: 'previsto', valor_realizado: null, data_realizado: null }).eq('id', b.dataset.estorna);
      if (e) return falha(e); toast('Estornado.'); lancamentos();
    }));
  }

  function formLanc(l) {
    const novo = !l.id, receber = l.tipo === 'receber';
    const catsTipo = cats.filter((k) => k.ativo && k.tipo === (receber ? 'receita' : 'despesa')).map((k) => [k.id, k.nome]);
    modal(`<h3>${novo ? 'Novo lançamento' : 'Editar lançamento'} · ${receber ? 'a receber' : 'a pagar'}</h3>
      ${l.origem === 'repasse' ? '<div class="dica">Gerado pelo repasse do mês. Se as guias mudarem, gere o repasse de novo em vez de editar.</div>' : ''}
      <form class="grade-form" id="f">
        <label style="grid-column:1/-1">Descrição<input name="descricao" required value="${esc(l.descricao)}"></label>
        <label>${receber ? 'Pagador' : 'Fornecedor / favorecido'}<input name="fornecedor" value="${esc(l.fornecedor)}"></label>
        <label>Categoria<select name="categoria_id">${opts(catsTipo, l.categoria_id, 'Sem categoria')}</select></label>
        <label>Área<select name="area">${opts(Object.entries(AREAS), l.area || 'geral')}</select></label>
        <label>Valor (R$)<input name="valor_previsto" type="number" step="0.01" min="0" required value="${esc(l.valor_previsto)}"></label>
        <label>Vencimento<input name="vencimento" type="date" required value="${esc(l.vencimento || (ym === mesAtual() ? hoje() : ym + '-10'))}"></label>
        <label>Competência (mês da DRE)<input name="competencia" type="month" value="${esc((l.competencia || ym + '-01').slice(0, 7))}"></label>
        <label>Forma de pagamento<select name="forma_pagamento">${opts(Object.entries(FORMAS), l.forma_pagamento, '—')}</select></label>
        <label>Conta<select name="conta_id">${opts(contas.filter((k) => k.ativo).map((k) => [k.id, k.nome]), l.conta_id, '—')}</select></label>
        <label>Documento (NF, boleto)<input name="documento" value="${esc(l.documento)}"></label>
        ${novo ? `<label>Repetir<select name="rep">${opts([['1', 'Não repete'], ['rec', 'Mensal (recorrente)'], ['parc', 'Parcelado']], '1')}</select></label>
          <label>Nº de meses / parcelas<input name="n" type="number" min="2" max="60" value="12"></label>` : ''}
        <label style="grid-column:1/-1">Observação<input name="observacao" value="${esc(l.observacao)}"></label>
      </form>
      ${novo ? '<p class="dica" style="margin-top:10px">Parcelado divide o valor pelo nº de parcelas. Mensal repete o mesmo valor todo mês (aluguel, contador, sistemas).</p>' : ''}
      <div class="linha-acoes">${novo ? '' : '<button class="btn" id="canc" style="margin-right:auto">Cancelar lançamento</button>'}
        <button class="btn" data-fechar>Fechar</button><button class="btn primario" id="s">Salvar</button></div>`,
    (m, fechar) => {
      $('#canc', m)?.addEventListener('click', async () => {
        const serie = l.serie_id && await confirmar('Cancelar também as próximas parcelas/recorrências ainda em aberto?', 'Sim, as próximas também');
        let q = sb.from('lancamentos').update({ status: 'cancelado' });
        q = serie ? q.eq('serie_id', l.serie_id).eq('status', 'previsto').gte('vencimento', l.vencimento) : q.eq('id', l.id);
        const { error: e } = await q; if (e) return falha(e); fechar(); toast('Cancelado.'); lancamentos();
      });
      $('#s', m).onclick = async () => {
        const f = Object.fromEntries(new FormData($('#f', m)));
        if (!f.descricao.trim() || f.valor_previsto === '' || !f.vencimento) return toast('Preencha descrição, valor e vencimento.', true);
        const base = { descricao: f.descricao.trim(), fornecedor: f.fornecedor || null, categoria_id: f.categoria_id || null, area: f.area,
          forma_pagamento: f.forma_pagamento || null, conta_id: f.conta_id || null, documento: f.documento || null, observacao: f.observacao || null,
          competencia: (f.competencia || f.vencimento.slice(0, 7)) + '-01' };
        const valor = Number(f.valor_previsto);
        if (!novo) {
          const { error: e } = await sb.from('lancamentos').update({ ...base, valor_previsto: valor, vencimento: f.vencimento }).eq('id', l.id);
          if (e) return falha(e); fechar(); toast('Salvo.'); return lancamentos();
        }
        const n = f.rep === '1' ? 1 : Math.max(2, Math.min(60, Number(f.n) || 2));
        const serie = n > 1 ? crypto.randomUUID() : null;
        const parcela = f.rep === 'parc' ? Math.floor((valor / n) * 100) / 100 : valor;
        const linhas = Array.from({ length: n }, (_, i) => {
          const venc = somaMes(f.vencimento.slice(0, 7), i) + '-' + f.vencimento.slice(8);
          const vencOk = venc.slice(0, 7) + '-' + String(Math.min(Number(f.vencimento.slice(8)), Number(fimMes(venc.slice(0, 7)).slice(8)))).padStart(2, '0');
          return { ...base, clinica_id: cid, tipo: l.tipo, vencimento: vencOk, serie_id: serie,
            competencia: f.rep === 'parc' ? base.competencia : somaMes(base.competencia.slice(0, 7), i) + '-01',
            valor_previsto: f.rep === 'parc' && i === n - 1 ? Math.round((valor - parcela * (n - 1)) * 100) / 100 : parcela,
            parcela: f.rep === 'parc' ? `${i + 1}/${n}` : null };
        });
        const { error: e } = await sb.from('lancamentos').insert(linhas);
        if (e) return falha(e); fechar(); toast(n > 1 ? `${n} lançamentos criados.` : 'Salvo.'); lancamentos();
      };
    });
  }

  function baixar(l) {
    if (!contas.length) return toast('Cadastre uma conta em "Contas e categorias" antes de baixar.', true);
    modal(`<h3>${l.tipo === 'receber' ? 'Registrar recebimento' : 'Registrar pagamento'}</h3><p><strong>${esc(l.descricao)}</strong> · previsto ${brl(l.valor_previsto)}</p>
      <form class="grade-form" id="f">
        <label>Data<input name="data_realizado" type="date" value="${hoje()}"></label>
        <label>Valor efetivo (R$)<input name="valor_realizado" type="number" step="0.01" min="0" value="${esc(l.valor_previsto)}"></label>
        <label>Conta<select name="conta_id">${opts(contas.filter((k) => k.ativo).map((k) => [k.id, k.nome]), l.conta_id || contas[0].id)}</select></label>
        <label>Forma<select name="forma_pagamento">${opts(Object.entries(FORMAS), l.forma_pagamento, '—')}</select></label>
      </form>
      <p class="dica" style="margin-top:10px">Se o valor vier menor (glosa, taxa de cartão), registre o que entrou de fato. A diferença fica visível no previsto × realizado.</p>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Confirmar</button></div>`,
    (m, fechar) => ($('#s', m).onclick = async () => {
      const f = Object.fromEntries(new FormData($('#f', m)));
      if (f.valor_realizado === '' || !f.data_realizado) return toast('Informe data e valor.', true);
      const { error: e } = await sb.from('lancamentos').update({ status: 'pago', data_realizado: f.data_realizado,
        valor_realizado: Number(f.valor_realizado), conta_id: f.conta_id, forma_pagamento: f.forma_pagamento || null }).eq('id', l.id);
      if (e) return falha(e); fechar(); toast('Baixado.'); lancamentos();
    }));
  }

  function gerarRepasse() {
    const comp = somaMes(ym, -1);
    modal(`<h3>Repasse de ${nomeMes(comp)}</h3>
      <p>Soma o repasse final (já descontadas as glosas) de todas as guias com atendimento em ${nomeMes(comp)} e cria um lançamento a pagar por profissional.
      Repasses já pagos não são alterados; os ainda previstos são recalculados.</p>
      <form class="grade-form" id="f"><label>Vencimento<input name="v" type="date" value="${ym}-10"></label></form>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Gerar</button></div>`,
    (m, fechar) => ($('#s', m).onclick = async () => {
      const { data: n, error: e } = await sb.rpc('gerar_repasse_mes', { p_clinica: cid, p_competencia: comp + '-01', p_vencimento: $('[name=v]', m).value });
      if (e) return falha(e); fechar(); toast(n ? `${n} repasse(s) lançados.` : 'Nenhum repasse com valor no mês (ou todos já pagos).'); lancamentos();
    }));
  }

  // ---------------- Caixa ----------------
  async function caixa() {
    const fim = fimMes(ym);
    const { data: ls, error } = await sb.from('lancamentos').select('tipo, status, conta_id, valor_previsto, valor_realizado, data_realizado, vencimento')
      .eq('clinica_id', cid).neq('status', 'cancelado').lte('vencimento', fimMes(somaMes(ym, 3)));
    if (error) return falha(error);
    const sinal = (l) => (l.tipo === 'receber' ? 1 : -1);
    const linhas = contas.filter((k) => k.ativo).map((k) => {
      const pagos = ls.filter((l) => l.status === 'pago' && l.conta_id === k.id && l.data_realizado >= k.data_saldo_inicial);
      const ate = (d) => Number(k.saldo_inicial) + pagos.filter((l) => l.data_realizado <= d).reduce((s, l) => s + sinal(l) * l.valor_realizado, 0);
      const entMes = pagos.filter((l) => l.tipo === 'receber' && l.data_realizado.startsWith(ym)).reduce((s, l) => s + Number(l.valor_realizado), 0);
      const saiMes = pagos.filter((l) => l.tipo === 'pagar' && l.data_realizado.startsWith(ym)).reduce((s, l) => s + Number(l.valor_realizado), 0);
      return { k, inicial: ate(fimMes(somaMes(ym, -1))), entMes, saiMes, final: ate(fim) };
    });
    const total = (c2) => linhas.reduce((s, x) => s + x[c2], 0);
    const semConta = ls.filter((l) => l.status === 'pago' && !l.conta_id).length;
    // projeção: saldo de hoje + previstos em aberto até o fim de cada mês
    const saldoHoje = linhas.reduce((s, x) => s + Number(x.k.saldo_inicial) + ls.filter((l) => l.status === 'pago' && l.conta_id === x.k.id && l.data_realizado >= x.k.data_saldo_inicial && l.data_realizado <= hoje()).reduce((a, l) => a + sinal(l) * l.valor_realizado, 0), 0);
    const proj = [0, 1, 2, 3].map((i) => somaMes(mesAtual(), i)).map((m2) => {
      const abertos = ls.filter((l) => l.status === 'previsto' && l.vencimento <= fimMes(m2));
      return { m2, ent: abertos.filter((l) => l.tipo === 'receber').reduce((s, l) => s + Number(l.valor_previsto), 0),
        sai: abertos.filter((l) => l.tipo === 'pagar').reduce((s, l) => s + Number(l.valor_previsto), 0) };
    });
    c.innerHTML = nav + `
      ${semConta ? `<div class="dica"><strong>${semConta} baixa(s) sem conta</strong> não entram no saldo. Edite e informe a conta.</div>` : ''}
      <div class="cartao tabela-rolagem"><h3>Saldo por conta · ${nomeMes(ym)}</h3>${linhas.length ? `<table><thead><tr><th>Conta</th>
        <th class="num">Saldo inicial do mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo final</th></tr></thead><tbody>
        ${linhas.map((x) => `<tr><td><strong>${esc(x.k.nome)}</strong></td><td class="num">${brl(x.inicial)}</td><td class="num">${brl(x.entMes)}</td>
          <td class="num">${brl(x.saiMes)}</td><td class="num"><strong>${brl(x.final)}</strong></td></tr>`).join('')}
        <tr><td><strong>Total</strong></td><td class="num">${brl(total('inicial'))}</td><td class="num">${brl(total('entMes'))}</td><td class="num">${brl(total('saiMes'))}</td>
          <td class="num"><strong>${brl(total('final'))}</strong></td></tr></tbody></table>` : '<div class="vazio">Nenhuma conta cadastrada.</div>'}</div>
      <div class="cartao tabela-rolagem"><h3>Projeção de caixa (saldo de hoje + previstos em aberto)</h3>
        <table><thead><tr><th>Até o fim de</th><th class="num">A receber em aberto</th><th class="num">A pagar em aberto</th><th class="num">Saldo projetado</th></tr></thead><tbody>
        ${proj.map((p) => `<tr><td style="text-transform:capitalize">${nomeMes(p.m2)}</td><td class="num">${brl(p.ent)}</td><td class="num">${brl(p.sai)}</td>
          <td class="num"><strong style="color:${saldoHoje + p.ent - p.sai < 0 ? 'var(--vermelho)' : 'inherit'}">${brl(saldoHoje + p.ent - p.sai)}</strong></td></tr>`).join('')}
        </tbody></table><p class="dica" style="margin-top:10px">Inclui atrasados ainda não baixados. Convênios entram aqui quando o lote TISS gerar o "a receber" (próxima fase).</p></div>`;
  }

  // ---------------- DRE gerencial (competência) ----------------
  async function dre() {
    const modo = sessionStorage.getItem('fin-dre') || 'mes';
    const ini = modo === 'ano' ? ym.slice(0, 4) + '-01-01' : ym + '-01';
    const fim = modo === 'ano' ? ym.slice(0, 4) + '-12-01' : ym + '-01';
    const { data: ls, error } = await sb.from('lancamentos').select('tipo, status, categoria_id, area, valor_previsto, valor_realizado')
      .eq('clinica_id', cid).neq('status', 'cancelado').gte('competencia', ini).lte('competencia', fim);
    if (error) return falha(error);
    const areas = Object.keys(AREAS);
    const val = (l) => Number(l.status === 'pago' ? l.valor_realizado : l.valor_previsto) * (l.tipo === 'receber' ? 1 : -1);
    const mat = {}; // grupo -> categoria -> area -> valor
    let semCat = 0;
    ls.forEach((l) => {
      const k = catPor[l.categoria_id]; if (!k) { semCat++; return; }
      const a = l.area || 'geral';
      ((mat[k.grupo_dre] ??= {})[k.id] ??= {})[a] = (mat[k.grupo_dre][k.id][a] || 0) + val(l);
    });
    const totGrupo = (g, a) => Object.values(mat[g] || {}).reduce((s, porA) => s + (a ? porA[a] || 0 : Object.values(porA).reduce((x, y) => x + y, 0)), 0);
    const cols = areas.filter((a) => Object.values(mat).some((gr) => Object.values(gr).some((porA) => porA[a])));
    const cel = (v) => `<td class="num" style="${v < 0 ? 'color:var(--vermelho)' : ''}">${v ? brl(v) : '—'}</td>`;
    const linhaTotal = (rot, fn, forte) => `<tr style="background:var(--papel)"><td><strong>${rot}</strong></td>${cols.map((a) => cel(fn(a))).join('')}${cel(fn())}${forte ? `<td class="num">${pct(totGrupo('receita_bruta') ? (fn() / totGrupo('receita_bruta')) * 100 : 0)}</td>` : '<td></td>'}</tr>`;
    const bloco = (g, rot) => `<tr><td colspan="${cols.length + 3}" style="padding-top:14px"><strong>${rot}</strong></td></tr>` +
      Object.entries(mat[g] || {}).map(([kid, porA]) => `<tr><td style="padding-left:22px">${esc(catPor[kid].nome)}</td>${cols.map((a) => cel(porA[a] || 0)).join('')}${cel(Object.values(porA).reduce((x, y) => x + y, 0))}<td></td></tr>`).join('');
    const liq = (a) => totGrupo('receita_bruta', a) + totGrupo('deducoes', a);
    const marg = (a) => liq(a) + totGrupo('custo_direto', a);
    const oper = (a) => marg(a) + totGrupo('despesa_operacional', a);
    const res = (a) => oper(a) + totGrupo('resultado_financeiro', a);
    c.innerHTML = nav + `
      <div class="linha-acoes" style="justify-content:flex-start;margin-bottom:12px">
        <select id="modo">${opts([['mes', 'Mês'], ['ano', 'Ano ' + ym.slice(0, 4)]], modo)}</select>
        <span class="dica" style="margin:0">Regime de competência: previstos entram pelo valor previsto, baixados pelo valor efetivo.</span></div>
      ${semCat ? `<div class="dica"><strong>${semCat} lançamento(s) sem categoria</strong> ficaram fora da DRE.</div>` : ''}
      <div class="cartao tabela-rolagem">${ls.length ? `<table><thead><tr><th></th>${cols.map((a) => `<th class="num">${AREAS[a]}</th>`).join('')}<th class="num">Total</th><th class="num">% receita</th></tr></thead><tbody>
        ${bloco('receita_bruta', 'Receita bruta')}${linhaTotal('Receita bruta', (a) => totGrupo('receita_bruta', a), true)}
        ${bloco('deducoes', GRUPOS[1][1])}${linhaTotal('Receita líquida', liq, true)}
        ${bloco('custo_direto', GRUPOS[2][1])}${linhaTotal('Margem de contribuição', marg, true)}
        ${bloco('despesa_operacional', GRUPOS[3][1])}${linhaTotal('Resultado operacional', oper, true)}
        ${bloco('resultado_financeiro', GRUPOS[4][1])}${linhaTotal('Resultado do período', res, true)}
        ${bloco('investimento', GRUPOS[5][1])}${bloco('retirada', GRUPOS[6][1])}
      </tbody></table>` : '<div class="vazio">Sem lançamentos nesta competência.</div>'}</div>
      <p class="dica">DRE gerencial para decisão, não substitui a contábil. Despesas lançadas como "Geral" não são rateadas entre as áreas: a margem por área é a <em>contribuição</em> de cada uma.</p>`;
    $('#modo').onchange = (e) => { sessionStorage.setItem('fin-dre', e.target.value); dre(); };
  }

  // ---------------- Cadastros ----------------
  function cadastros() {
    c.innerHTML = nav + `
      <div class="cartao tabela-rolagem"><div class="linha-acoes" style="justify-content:space-between"><h3>Contas</h3><button class="btn primario" id="nc">+ Conta</button></div>
        ${contas.length ? `<table><thead><tr><th>Conta</th><th>Tipo</th><th>Banco / ag. / conta</th><th class="num">Saldo inicial</th><th>Em</th><th></th></tr></thead><tbody>
        ${contas.map((k) => `<tr class="${k.ativo ? '' : 'inativo'}"><td><strong>${esc(k.nome)}</strong>${k.ativo ? '' : ' <small>(inativa)</small>'}</td><td>${esc(k.tipo)}</td>
          <td>${esc([k.banco, k.agencia, k.conta].filter(Boolean).join(' · ') || '—')}</td><td class="num">${brl(k.saldo_inicial)}</td><td>${data(k.data_saldo_inicial)}</td>
          <td><button class="btn pequeno" data-conta="${k.id}">Editar</button></td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhuma conta. Cadastre a conta PJ e o caixa físico.</div>'}</div>
      <div class="cartao tabela-rolagem"><div class="linha-acoes" style="justify-content:space-between"><h3>Categorias</h3><button class="btn primario" id="ncat">+ Categoria</button></div>
        <table><thead><tr><th>Categoria</th><th>Tipo</th><th>Linha da DRE</th><th></th></tr></thead><tbody>
        ${cats.map((k) => `<tr><td>${esc(k.nome)}${k.ativo ? '' : ' <small>(inativa)</small>'}</td><td>${k.tipo}</td><td>${esc(GRUPOS.find(([g]) => g === k.grupo_dre)?.[1])}</td>
          <td><button class="btn pequeno" data-cat="${k.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;

    const formConta = (k = {}) => modal(`<h3>${k.id ? 'Editar conta' : 'Nova conta'}</h3><form class="grade-form" id="f">
        <label>Nome<input name="nome" required value="${esc(k.nome)}" placeholder="ex.: Conta PJ Sicoob"></label>
        <label>Tipo<select name="tipo">${opts([['banco', 'Conta bancária'], ['caixa', 'Caixa físico'], ['cartao', 'Cartão / maquininha'], ['aplicacao', 'Aplicação']], k.tipo || 'banco')}</select></label>
        <label>Banco<input name="banco" value="${esc(k.banco)}"></label><label>Agência<input name="agencia" value="${esc(k.agencia)}"></label>
        <label>Conta<input name="conta" value="${esc(k.conta)}"></label>
        <label>Saldo inicial (R$)<input name="saldo_inicial" type="number" step="0.01" value="${esc(k.saldo_inicial ?? 0)}"></label>
        <label>Saldo na data<input name="data_saldo_inicial" type="date" value="${esc(k.data_saldo_inicial || hoje())}"></label>
        <label><span><input type="checkbox" name="ativo" ${k.ativo !== false ? 'checked' : ''}> Ativa</span></label></form>
      <p class="dica" style="margin-top:10px">Use o saldo do extrato no dia anterior ao primeiro lançamento que for registrar.</p>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
    (m, fechar) => ($('#s', m).onclick = async () => {
      const fd = new FormData($('#f', m)); const f = Object.fromEntries(fd); f.ativo = fd.has('ativo'); f.saldo_inicial = Number(f.saldo_inicial) || 0;
      if (!f.nome.trim()) return toast('Informe o nome.', true);
      const q = k.id ? sb.from('contas_financeiras').update(f).eq('id', k.id) : sb.from('contas_financeiras').insert({ ...f, clinica_id: cid });
      const { error: e } = await q; if (e) return falha(e); fechar(); toast('Salvo.'); render(`cadastros-${ym}`);
    }));

    const formCat = (k = {}) => modal(`<h3>${k.id ? 'Editar categoria' : 'Nova categoria'}</h3><form class="grade-form" id="f">
        <label>Nome<input name="nome" required value="${esc(k.nome)}"></label>
        <label>Tipo<select name="tipo">${opts([['receita', 'Receita'], ['despesa', 'Despesa']], k.tipo || 'despesa')}</select></label>
        <label>Linha da DRE<select name="grupo_dre">${opts(GRUPOS, k.grupo_dre || 'despesa_operacional')}</select></label>
        <label>Ordem<input name="ordem" type="number" value="${esc(k.ordem ?? 100)}"></label>
        <label><span><input type="checkbox" name="ativo" ${k.ativo !== false ? 'checked' : ''}> Ativa</span></label></form>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
    (m, fechar) => ($('#s', m).onclick = async () => {
      const fd = new FormData($('#f', m)); const f = Object.fromEntries(fd); f.ativo = fd.has('ativo'); f.ordem = Number(f.ordem) || 100;
      if (!f.nome.trim()) return toast('Informe o nome.', true);
      const q = k.id ? sb.from('categorias_financeiras').update(f).eq('id', k.id) : sb.from('categorias_financeiras').insert({ ...f, clinica_id: cid });
      const { error: e } = await q; if (e) return falha(e); fechar(); toast('Salvo.'); render(`cadastros-${ym}`);
    }));

    $('#nc').onclick = () => formConta();
    $('#ncat').onclick = () => formCat();
    $$('[data-conta]', c).forEach((b) => (b.onclick = () => formConta(contas.find((k) => k.id === b.dataset.conta))));
    $$('[data-cat]', c).forEach((b) => (b.onclick = () => formCat(cats.find((k) => k.id === b.dataset.cat))));
  }

  await ({ lancamentos, caixa, dre, cadastros }[aba])();
}
