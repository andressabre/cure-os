// Módulo Lotes TISS: guias prontas (cheias ou com senha vencida) → lote → XML 4.03.00 → envio → "a receber".
import { sb, estado, $, $$, esc, brl, data, tela, toast, falha, modal, confirmar } from '../core.js';
import { gerarXmlLote, latin1 } from './tiss-xml.js';
import { enviarArquivo, abrirArquivo, escolherArquivo } from './documentos.js';

const STATUS = { fechado: ['pendente', 'Fechado – enviar'], enviado: ['ok', 'Enviado'], protocolado: ['ok', 'Protocolado'],
  retornado: ['outra', 'Retornado'], aberto: ['pendente', 'Aberto'] };
const MOTIVO = { cheia: ['ok', 'Cheia'], senha_vencida: ['alerta', 'Senha vencida'], sem_exigencia: ['ok', 'Sem senha exigida'],
  aguardando: ['pendente', 'Em andamento'], sem_senha: ['alerta', 'Sem senha'],
  prazo_entrega: ['alerta', 'Prazo de entrega'] };
const PRONTA = ['cheia', 'senha_vencida', 'sem_exigencia', 'prazo_entrega'];
const ALERTA_DIAS = 15;
const mesAtual = () => new Date().toISOString().slice(0, 7);

export async function render(id) {
  if (id) return detalhe(id);
  const c = tela('Lotes TISS');
  const [cand, lotes] = await Promise.all([
    sb.rpc('lote_candidatas', { p_clinica: estado.clinica.id }),
    sb.from('lotes').select('id, numero_lote, competencia, status, qtd_guias, valor_total, data_envio, protocolo, previsto_pagamento, contratos(nome)')
      .eq('clinica_id', estado.clinica.id).order('criado_em', { ascending: false }).limit(60),
  ]);
  if (cand.error) return falha(cand.error, 'Guias');
  if (lotes.error) return falha(lotes.error, 'Lotes');

  const grupos = cand.data || [];
  const alertas = grupos.flatMap((g) => g.guias.filter((x) => x.situacao.motivo === 'aguardando'
    && x.situacao.dias_para_vencer != null && x.situacao.dias_para_vencer <= ALERTA_DIAS)
    .map((x) => ({ ...x, contrato: g.contrato })));

  c.innerHTML = `
    <div class="dica">Entra no lote só a guia <strong>cheia</strong> (todas as sessões autorizadas feitas) ou com a <strong>senha vencida</strong>
      (vai com as sessões realizadas). Guia em andamento espera o próximo fechamento — exceto quando a 1ª sessão se aproxima
      do prazo de entrega do contrato (SulAmérica: 90 dias), para não perder a conta.</div>
    ${alertas.length ? `<div class="cartao" style="border-left:4px solid var(--alerta,#c0392b)"><h3>Senhas perto de vencer</h3>
      <table><thead><tr><th>Guia</th><th>Paciente</th><th>Contrato</th><th class="num">Feitas</th><th>Vence</th><th></th></tr></thead><tbody>
      ${alertas.map((x) => `<tr><td>${esc(x.numero)}</td><td>${esc(x.paciente)}</td><td>${esc(x.contrato)}</td>
        <td class="num">${x.situacao.realizadas}/${x.situacao.autorizadas ?? '—'}</td><td>${data(x.situacao.validade)}
        (${x.situacao.dias_para_vencer < 0 ? 'vencida' : x.situacao.dias_para_vencer + ' dias'})</td>
        <td class="muted">${(x.situacao.autorizadas ?? 0) - x.situacao.realizadas} sessões restantes: remarcar ou pedir prorrogação</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    ${grupos.length ? grupos.map(blocoContrato).join('') : '<div class="cartao vazio">Nenhuma guia aberta com atendimento.</div>'}
    <h3 style="margin-top:22px">Lotes gerados</h3>
    <div class="cartao tabela-rolagem">${lotes.data.length ? `<table><thead><tr><th>Lote</th><th>Contrato</th><th>Competência</th>
      <th class="num">Guias</th><th class="num">Valor</th><th>Situação</th><th>Envio</th><th>Pagamento previsto</th></tr></thead><tbody>
      ${lotes.data.map((l) => `<tr class="clicavel" data-lote="${l.id}"><td>${esc(l.numero_lote)}</td><td>${esc(l.contratos?.nome)}</td>
        <td>${esc(String(l.competencia).slice(5, 7) + '/' + String(l.competencia).slice(0, 4))}</td>
        <td class="num">${l.qtd_guias ?? '—'}</td><td class="num">${l.valor_total != null ? brl(l.valor_total) : '—'}</td>
        <td><span class="selo ${(STATUS[l.status] || STATUS.aberto)[0]}">${(STATUS[l.status] || STATUS.aberto)[1]}</span></td>
        <td>${data(l.data_envio)}${l.protocolo ? ' · prot. ' + esc(l.protocolo) : ''}</td><td>${data(l.previsto_pagamento)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="vazio">Nenhum lote ainda.</div>'}</div>`;

  $$('tr[data-lote]', c).forEach((tr) => (tr.onclick = () => (location.hash = 'lotes-' + tr.dataset.lote)));
  $$('[data-criar]', c).forEach((b) => (b.onclick = () => criar(grupos.find((g) => g.contrato_id === b.dataset.criar))));
  $$('[data-todas]', c).forEach((b) => (b.onchange = () =>
    $$(`input.g[data-k="${b.dataset.todas}"]:not(:disabled)`, c).forEach((x) => (x.checked = b.checked))));
}

function blocoContrato(g) {
  const prontas = g.guias.filter((x) => PRONTA.includes(x.situacao.motivo));
  const linha = (x) => {
    const s = x.situacao, [cls, rot] = MOTIVO[s.motivo] || MOTIVO.aguardando, ok = PRONTA.includes(s.motivo);
    return `<tr><td><input type="checkbox" class="g" data-k="${g.contrato_id}" value="${x.id}" ${ok ? 'checked' : 'disabled'}></td>
      <td>${esc(x.numero)}</td><td>${esc(x.paciente)}</td><td>${esc(x.profissional)}</td><td>${esc(x.senha || '—')}</td>
      <td class="num">${s.realizadas}/${s.autorizadas ?? '—'}</td><td>${data(x.primeira)}${x.ultima !== x.primeira ? ' a ' + data(x.ultima) : ''}</td>
      <td>${s.validade ? data(s.validade) : '—'}</td><td class="num">${brl(x.valor)}</td><td><span class="selo ${cls}">${rot}</span></td></tr>`;
  };
  return `<div class="cartao tabela-rolagem" style="margin-bottom:14px">
    <div class="linha-acoes" style="justify-content:space-between"><h3 style="margin:0">${esc(g.contrato)}</h3>
      <span class="muted">${prontas.length} de ${g.guias.length} guias prontas · ${brl(prontas.reduce((s, x) => s + Number(x.valor), 0))}</span>
      <button class="btn primario" data-criar="${g.contrato_id}" ${prontas.length ? '' : 'disabled'}>Criar lote</button></div>
    <table><thead><tr><th><input type="checkbox" data-todas="${g.contrato_id}" checked></th><th>Guia</th><th>Paciente</th><th>Profissional</th>
      <th>Senha</th><th class="num">Sessões</th><th>Atendimentos</th><th>Validade</th><th class="num">Valor</th><th>Situação</th></tr></thead>
      <tbody>${g.guias.map(linha).join('')}</tbody></table></div>`;
}

async function criar(g) {
  const ids = $$(`input.g[data-k="${g.contrato_id}"]:checked`).map((x) => x.value);
  if (!ids.length) return toast('Marque ao menos uma guia pronta.', true);
  const tipos = new Set(g.guias.filter((x) => ids.includes(x.id)).map((x) => x.tipo));
  if (tipos.size > 1) return toast('Separe em lotes diferentes: um lote só pode ter um tipo de guia.', true);
  if (ids.length > 100) return toast('Máximo de 100 guias por lote (padrão TISS).', true);
  modal(`<h3>Criar lote – ${esc(g.contrato)}</h3>
    <p>${ids.length} guias. O número do lote é gerado pelo sistema.</p>
    <label>Competência<input type="month" id="comp" value="${mesAtual()}"></label>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Criar lote</button></div>`,
  (c, fechar) => {
    $('#ok', c).onclick = async () => {
      const { data: id, error } = await sb.rpc('criar_lote', { p_contrato: g.contrato_id, p_competencia: $('#comp', c).value + '-01', p_guias: ids });
      if (error) return falha(error, 'Criar lote');
      fechar(); toast('Lote criado.'); location.hash = 'lotes-' + id;
    };
  });
}

async function detalhe(id) {
  const c = tela('Lote TISS', '<button class="btn" id="voltar">‹ Lotes</button>');
  $('#voltar').onclick = () => (location.hash = 'lotes');
  const [{ data: d, error }, { data: l, error: e2 }] = await Promise.all([
    sb.rpc('dados_xml_lote', { p_lote: id }),
    sb.from('lotes').select('id, numero_lote, status, data_envio, protocolo, previsto_pagamento, hash_md5, gerado_em, arquivo_xml, contratos(regras)').eq('id', id).single(),
  ]);
  if (error || e2) return falha(error || e2, 'Lote');
  const r = gerarXmlLote(d);
  const bloqueios = r.pendencias.filter((p) => p.bloqueia), avisos = r.pendencias.filter((p) => !p.bloqueia);
  const fechado = l.status === 'fechado';
  $('#titulo-tela').textContent = `Lote ${l.numero_lote}`;

  c.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="rotulo">Contrato</div><div class="valor" style="font-size:1rem">${esc(d.contrato.nome)}</div>
        <div class="sub">ANS ${esc(d.contrato.registro_ans)} · prestador ${esc(d.contrato.codigo_prestador)} · TISS ${esc(d.contrato.versao)}</div></div>
      <div class="kpi"><div class="rotulo">Guias</div><div class="valor">${d.guias.length}</div>
        <div class="sub">${d.guias.reduce((s, g) => s + (g.itens?.length || 0), 0)} procedimentos</div></div>
      <div class="kpi"><div class="rotulo">Valor informado</div><div class="valor">${brl(r.total)}</div></div>
      <div class="kpi"><div class="rotulo">Situação</div><div class="valor" style="font-size:1rem">
        <span class="selo ${(STATUS[l.status] || STATUS.aberto)[0]}">${(STATUS[l.status] || STATUS.aberto)[1]}</span></div>
        <div class="sub">${l.data_envio ? 'enviado ' + data(l.data_envio) + (l.protocolo ? ' · prot. ' + esc(l.protocolo) : '') : ''}
        ${l.previsto_pagamento ? ' · pagamento previsto ' + data(l.previsto_pagamento) : ''}</div></div>
    </div>
    ${anexos(l)}
    ${bloqueios.map((p) => `<div class="dica" style="border-left:4px solid #c0392b">⛔ ${esc(p.msg)}</div>`).join('')}
    ${avisos.map((p) => `<div class="dica">⚠️ ${esc(p.msg)}</div>`).join('')}
    <div class="linha-acoes" style="justify-content:flex-start;margin:12px 0">
      ${fechado ? `<button class="btn primario" id="gerar" ${bloqueios.length ? 'disabled title="Resolva os bloqueios acima"' : ''}>Gerar e baixar XML</button>` : ''}
      ${l.arquivo_xml ? `<button class="btn" id="baixar">Baixar XML gravado</button>` : ''}
      ${fechado ? `<button class="btn primario" id="enviar">Registrar envio à operadora</button>` : ''}
      ${fechado ? `<button class="btn" id="desfazer">Desfazer lote</button>` : ''}
    </div>
    <div id="anexos"></div>
    ${l.hash_md5 ? `<p class="muted">XML gerado em ${new Date(l.gerado_em).toLocaleString('pt-BR')} · hash ${esc(l.hash_md5)}</p>` : ''}
    <div class="cartao tabela-rolagem"><table><thead><tr><th>Guia</th><th>Senha</th><th>Carteirinha</th><th>Solicitante</th>
      <th>Data</th><th>Procedimento</th><th>Executante</th><th class="num">Valor</th></tr></thead><tbody>
      ${d.guias.map((g) => (g.itens || []).map((it, i) => `<tr>${i ? '<td></td><td></td><td></td><td></td>'
        : `<td>${esc(g.numero)}</td><td>${esc(g.senha || '—')}</td><td>${esc(g.carteirinha)}</td><td>${esc(g.solicitante?.nome || '—')}</td>`}
        <td>${data(it.data)}</td><td>${esc(it.codigo)} ${esc(it.descricao)}</td><td>${esc(it.profissional?.nome)}</td>
        <td class="num">${brl(it.valor)}</td></tr>`).join('')).join('')}
    </tbody></table></div>`;

  anexosLote(id, l);
  const baixar = (bytes, nome) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/xml' })); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#gerar', c)?.addEventListener('click', async () => {
    if (l.arquivo_xml && !(await confirmar('Já existe um XML gravado para este lote. Gerar de novo substitui o arquivo e o hash.', 'Gerar de novo'))) return;
    const novo = gerarXmlLote(d);
    const { error: e } = await sb.rpc('salvar_xml_lote', { p_lote: id, p_xml: novo.xml, p_hash: novo.hash });
    if (e) return falha(e, 'Gravar XML');
    baixar(novo.bytes, novo.nomeArquivo); toast('XML gerado. Envie pelo portal da operadora e registre o envio aqui.');
    render(id);
  });
  $('#baixar', c)?.addEventListener('click', () => baixar(latin1(l.arquivo_xml), `${l.numero_lote}_${l.hash_md5}.xml`));
  $('#desfazer', c)?.addEventListener('click', async () => {
    if (!(await confirmar('As guias voltam para a lista de prontas e o número deste lote é descartado.', 'Desfazer'))) return;
    const { error: e } = await sb.rpc('desfazer_lote', { p_lote: id });
    if (e) return falha(e, 'Desfazer');
    toast('Lote desfeito.'); location.hash = 'lotes';
  });
  $('#enviar', c)?.addEventListener('click', () => modal(`<h3>Registrar envio do lote ${esc(l.numero_lote)}</h3>
    <label>Data do envio<input type="date" id="dt" value="${new Date().toISOString().slice(0, 10)}"></label>
    <label>Nº do lote/GRD dado pela operadora<input id="numop" placeholder="ex.: SulAmérica 261109010459 — deixe vazio se for o nosso (${esc(l.numero_lote)})"></label>
    <label>Protocolo da operadora (se já tiver)<input id="prot" placeholder="opcional"></label>
    <p class="muted">O número do lote é o que volta no retorno de glosas. Se o portal deu outro, informe aqui para o retorno encontrar este lote.</p>
    <p class="dica">Depois do envio o lote não pode mais ser alterado. O valor entra no Financeiro como "a receber", com vencimento pelo prazo de pagamento do contrato (padrão 30 dias).</p>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Registrar envio</button></div>`,
  (m, fechar) => {
    $('#ok', m).onclick = async () => {
      const { data: venc, error: e } = await sb.rpc('registrar_envio_lote', { p_lote: id, p_data_envio: $('#dt', m).value, p_protocolo: $('#prot', m).value, p_numero_operadora: $('#numop', m).value });
      if (e) return falha(e, 'Registrar envio');
      fechar(); toast(`Envio registrado. A receber previsto para ${data(venc)}.`); render(id);
    };
  }));
}

// Dias úteis (seg–sex; feriados não considerados)
function maisDiasUteis(iso, n) {
  const d = new Date(iso + 'T12:00');
  while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n--; }
  return d.toISOString().slice(0, 10);
}

function anexos(l) {
  const rg = l.contratos?.regras || {}, lista = rg.anexos_obrigatorios || [];
  if (!lista.length) return '';
  const prazo = rg.prazo_anexos_dias_uteis, limite = l.data_envio && prazo ? maisDiasUteis(l.data_envio, prazo) : null;
  return `<div class="dica"><strong>Anexos obrigatórios por guia no portal</strong> (depois do upload do XML):
    ${lista.map(esc).join(' · ')}.
    ${prazo ? (limite ? `Prazo: até <strong>${data(limite)}</strong> (${prazo} dias úteis após o envio).` : `Prazo: ${prazo} dias úteis após o envio.`) : ''}
    ${rg.cancelamento_dias_uteis ? `Cancelar faturamento: até ${rg.cancelamento_dias_uteis} dias úteis do protocolo.` : ''}</div>`;
}

// Anexos por guia: 03 = pedido médico (vem do encaminhamento vinculado à autorização), 06 = guia assinada
async function anexosLote(id, l) {
  const alvo = $('#anexos');
  if (!(l.contratos?.regras?.anexos_obrigatorios || []).length) return;
  const { data: gs, error } = await sb.rpc('anexos_lote', { p_lote: id });
  if (error) return falha(error, 'Anexos');
  const tem = (g, t) => g.anexos.find((a) => a.tipo === t);
  const pedido = (g) => tem(g, '03')?.arquivo || g.encaminhamento?.arquivo;
  const completos = gs.filter((g) => pedido(g) && tem(g, '06')).length;
  alvo.innerHTML = `<div class="cartao tabela-rolagem" style="margin-bottom:14px"><div class="linha-acoes" style="justify-content:space-between">
      <h3 style="margin:0">Anexos das guias</h3><span class="muted">${completos} de ${gs.length} guias com pedido e guia assinada</span></div>
    <table><thead><tr><th>Guia</th><th>Paciente</th><th>03 · Pedido médico</th><th>06 · Guia assinada</th><th>Enviado ao portal</th></tr></thead><tbody>
    ${gs.map((g) => {
      const en = g.encaminhamento, ped = pedido(g), ass = tem(g, '06'), enviado = g.anexos.length && g.anexos.every((a) => a.enviado);
      const vencido = en?.validade && g.primeira && en.validade < g.primeira;
      return `<tr><td>${esc(g.numero)}</td><td>${esc(g.paciente)}</td>
        <td>${ped ? `<button class="btn pequeno" data-abrir="${esc(ped)}">Ver</button>` : `<span class="selo alerta">${en ? 'encaminhamento sem arquivo' : 'sem encaminhamento'}</span>`}
          ${vencido ? ' <span class="selo alerta">vencido antes da 1ª sessão</span>' : ''}
          ${!ped ? ` <button class="btn pequeno" data-sobe="03" data-g="${g.guia_id}">Anexar</button>` : ''}</td>
        <td>${ass ? `<button class="btn pequeno" data-abrir="${esc(ass.arquivo)}">Ver</button>` : '<span class="selo alerta">falta</span>'}
          <button class="btn pequeno" data-sobe="06" data-g="${g.guia_id}">${ass ? 'Trocar' : 'Anexar'}</button></td>
        <td>${enviado ? `<span class="selo ok">✓ ${data(g.anexos[0].enviado)}</span>`
          : ped && ass ? `<button class="btn pequeno" data-env="${g.guia_id}">Marcar enviados</button>` : '<span class="muted">—</span>'}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="muted">O pedido vem do encaminhamento vinculado à autorização (ficha do paciente). Depois do upload do XML, envie os anexos de cada guia no portal e marque aqui.</p></div>`;

  $$('[data-abrir]', alvo).forEach((b) => (b.onclick = () => abrirArquivo(b.dataset.abrir)));
  $$('[data-sobe]', alvo).forEach((b) => (b.onclick = async () => {
    const f = await escolherArquivo(); if (!f) return;
    try {
      const up = await enviarArquivo(f, `guias/${b.dataset.g}`);
      if (b.dataset.sobe === '06') await sb.from('guia_anexos').delete().eq('guia_id', b.dataset.g).eq('tipo', '06');
      const { error: e } = await sb.from('guia_anexos').insert({ clinica_id: estado.clinica.id, guia_id: b.dataset.g, tipo: b.dataset.sobe, ...up });
      if (e) throw e; toast('Anexo salvo.'); anexosLote(id, l);
    } catch (e) { falha(e, 'Anexar'); }
  }));
  $$('[data-env]', alvo).forEach((b) => (b.onclick = async () => {
    const g = gs.find((x) => x.guia_id === b.dataset.env), hoje = new Date().toISOString().slice(0, 10);
    // o pedido que vem do encaminhamento vira registro da guia, para guardar a data de envio
    if (!tem(g, '03') && g.encaminhamento?.arquivo) {
      const { error: e } = await sb.from('guia_anexos').insert({ clinica_id: estado.clinica.id, guia_id: g.guia_id, tipo: '03',
        arquivo: g.encaminhamento.arquivo, arquivo_nome: g.encaminhamento.arquivo_nome });
      if (e) return falha(e);
    }
    const { error: e } = await sb.from('guia_anexos').update({ enviado_portal_em: hoje }).eq('guia_id', g.guia_id);
    if (e) return falha(e); anexosLote(id, l);
  }));
}
