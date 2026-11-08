// Módulo Retornos e glosas: importar o demonstrativo, separar lotes da clínica, revisar e confirmar.
import { sb, estado, $, $$, esc, brl, pct, data, tela, toast, falha, modal, confirmar } from '../core.js';
import { lerArquivoXml, resumoPorLote } from './tiss.js';

const STATUS = { processando: ['pendente', 'Processando'], em_revisao: ['pendente', 'Em revisão'],
  confirmado: ['ok', 'Confirmado'], descartado: ['outra', 'Descartado'] };

export async function render(id) {
  if (id) return detalhe(id);
  const c = tela('Retornos e glosas', '<button class="btn primario" id="btn-importar">+ Importar retorno</button>');
  $('#btn-importar').onclick = importar;
  const { data: rs, error } = await sb.from('retornos')
    .select('id, criado_em, data_emissao, arquivo, formato, status, total_informado, total_glosa, soma_confere, contratos(nome)')
    .eq('clinica_id', estado.clinica.id).order('criado_em', { ascending: false });
  if (error) return falha(error);
  if (!rs.length) { c.innerHTML = '<div class="cartao vazio">Nenhum retorno importado ainda.</div>'; return; }
  c.innerHTML = `<div class="cartao tabela-rolagem"><table>
    <thead><tr><th>Emissão</th><th>Contrato</th><th>Arquivo</th><th class="num">Informado (arquivo)</th>
    <th class="num">Glosa (arquivo)</th><th>Conferência</th><th>Status</th></tr></thead><tbody>
    ${rs.map((r) => `<tr class="clicavel" data-id="${r.id}">
      <td>${data(r.data_emissao)}</td><td>${esc(r.contratos?.nome)}</td><td>${esc(r.arquivo.split('/').pop())}</td>
      <td class="num">${brl(r.total_informado)}</td><td class="num">${brl(r.total_glosa)}</td>
      <td>${r.soma_confere ? '<span class="selo ok">Soma confere</span>' : '<span class="selo alerta">Divergente</span>'}</td>
      <td><span class="selo ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></td></tr>`).join('')}
    </tbody></table></div>`;
  $$('tr[data-id]', c).forEach((tr) => (tr.onclick = () => (location.hash = 'retornos-' + tr.dataset.id)));
}

async function importar() {
  const { data: contratos, error } = await sb.from('contratos')
    .select('id, nome, codigo_prestador_operadora, operadoras(nome, registro_ans)').eq('clinica_id', estado.clinica.id).eq('ativo', true);
  if (error) return falha(error);
  if (!contratos.length) return toast('Cadastre um contrato antes de importar retornos.', true);

  modal(`<h3>Importar retorno da operadora</h3>
    <div class="dica">Por enquanto: XML TISS (Demonstrativo de Análise de Conta). PDF e planilha entram na próxima etapa.</div>
    <label>Contrato<select id="contrato">${contratos.map((k) => `<option value="${k.id}">${esc(k.nome)}</option>`).join('')}</select></label>
    <div class="solta" id="solta" style="margin-top:12px">Arraste o XML aqui ou clique para escolher
      <input type="file" id="arq" accept=".xml,.XML" hidden></div>
    <div id="previa"></div>`, (c, fechar) => {
    const arq = $('#arq', c), solta = $('#solta', c);
    solta.onclick = () => arq.click();
    solta.ondragover = (e) => { e.preventDefault(); solta.classList.add('sobre'); };
    solta.ondragleave = () => solta.classList.remove('sobre');
    solta.ondrop = (e) => { e.preventDefault(); solta.classList.remove('sobre'); processar(e.dataTransfer.files[0]); };
    arq.onchange = () => processar(arq.files[0]);

    async function processar(arquivo) {
      if (!arquivo) return;
      const contrato = contratos.find((k) => k.id === $('#contrato', c).value);
      let r;
      try { r = await lerArquivoXml(arquivo); } catch (e) { return toast(e.message, true); }
      const { data: lotesConhecidos } = await sb.from('lotes').select('numero_lote').eq('contrato_id', contrato.id);
      const conhecidos = new Set((lotesConhecidos || []).map((l) => l.numero_lote));
      const { data: repetido } = await sb.from('retornos').select('id').eq('contrato_id', contrato.id)
        .like('arquivo', '%' + arquivo.name).limit(1);
      const lotes = resumoPorLote(r.linhas);
      const avisos = [];
      if (contrato.codigo_prestador_operadora && r.codigoPrestador !== contrato.codigo_prestador_operadora)
        avisos.push(`Código do prestador no arquivo (${r.codigoPrestador}) é diferente do contrato (${contrato.codigo_prestador_operadora}).`);
      if (repetido?.length) avisos.push('Um arquivo com este nome já foi importado neste contrato.');
      if (!r.somaConfere) avisos.push('A soma das linhas não bate com o total do arquivo. Revise antes de confirmar.');

      $('#previa', c).innerHTML = `<p style="margin-top:14px"><strong>${esc(r.nomeOperadora)}</strong> · emissão ${data(r.dataEmissao)} ·
        ${r.linhas.length} linhas · glosa total ${brl(r.totais.glosa)}
        ${r.somaConfere ? '<span class="selo ok">Soma confere</span>' : ''}</p>
        ${avisos.map((a) => `<div class="dica">⚠️ ${esc(a)}</div>`).join('')}
        <p><strong>Quais lotes são da clínica?</strong> <span class="muted">Os outros são guardados só com números e valores, sem dados de paciente.</span></p>
        <table><thead><tr><th></th><th>Lote</th><th class="num">Guias</th><th class="num">Informado</th><th class="num">Glosa</th></tr></thead><tbody>
        ${lotes.map((l) => `<tr><td><input type="checkbox" class="lote" value="${esc(l.lote)}" ${conhecidos.has(l.lote) ? 'checked' : ''}></td>
          <td>${esc(l.lote)} ${conhecidos.has(l.lote) ? '<span class="selo clinica">já vinculado</span>' : ''}</td>
          <td class="num">${l.guias}</td><td class="num">${brl(l.informado)}</td><td class="num">${brl(l.glosa)}</td></tr>`).join('')}
        </tbody></table>
        <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="gravar">Importar</button></div>`;
      $$('[data-fechar]', c).forEach((b) => (b.onclick = fechar));
      $('#gravar', c).onclick = async (ev) => {
        ev.target.disabled = true;
        const daClinica = new Set($$('.lote:checked', c).map((x) => x.value));
        try {
          const id = await gravar(contrato, arquivo.name, r, lotes, daClinica, conhecidos);
          fechar(); toast('Retorno importado.'); location.hash = 'retornos-' + id;
        } catch (e) { ev.target.disabled = false; falha(e, 'Importação'); }
      };
    }
  });
}

async function gravar(contrato, nomeArquivo, r, lotes, daClinica, conhecidos) {
  const cid = estado.clinica.id;
  const novos = lotes.filter((l) => daClinica.has(l.lote) && !conhecidos.has(l.lote)).map((l) => ({
    clinica_id: cid, contrato_id: contrato.id, numero_lote: l.lote, protocolo: l.protocolo,
    competencia: (r.dataEmissao || new Date().toISOString()).slice(0, 8) + '01', status: 'retornado' }));
  if (novos.length) { const { error } = await sb.from('lotes').insert(novos); if (error) throw error; }

  const { data: ret, error } = await sb.from('retornos').insert({
    clinica_id: cid, contrato_id: contrato.id, formato: 'xml', arquivo: 'retornos/' + nomeArquivo,
    registro_ans: r.registroAns, codigo_prestador: r.codigoPrestador, data_emissao: r.dataEmissao,
    total_informado: r.totais.informado, total_liberado: r.totais.liberado, total_glosa: r.totais.glosa,
    soma_confere: r.somaConfere, status: 'em_revisao', enviado_por: estado.user.id }).select('id').single();
  if (error) throw error;

  const linhas = r.linhas.map((l) => {
    const minha = daClinica.has(l.numero_lote);
    return { ...l, carteirinha: minha ? l.carteirinha : null, classe: minha ? 'da_clinica' : 'outra_clinica',
      clinica_id: cid, retorno_id: ret.id, confianca: 1 };
  });
  for (let i = 0; i < linhas.length; i += 500) {
    const { error: e2 } = await sb.from('retorno_linhas').insert(linhas.slice(i, i + 500));
    if (e2) { await sb.from('retornos').delete().eq('id', ret.id); throw e2; }
  }
  return ret.id;
}

async function detalhe(id) {
  const c = tela('Retorno', '<a class="btn" href="#retornos">← Voltar</a>');
  const [{ data: r, error }, { data: ls, error: e2 }, { data: motivos }] = await Promise.all([
    sb.from('retornos').select('*, contratos(nome)').eq('id', id).single(),
    sb.from('retorno_linhas').select('*').eq('retorno_id', id).order('numero_lote').order('numero_guia_prestador'),
    sb.from('motivos_glosa').select('codigo, descricao'),
  ]);
  if (error || e2) return falha(error || e2);
  const desc = Object.fromEntries((motivos || []).map((m) => [m.codigo, m.descricao]));
  const minhas = ls.filter((l) => l.classe === 'da_clinica');
  const inf = minhas.reduce((s, l) => s + Number(l.valor_informado), 0);
  const glo = minhas.reduce((s, l) => s + Number(l.valor_glosa), 0);
  const glosadas = minhas.filter((l) => Number(l.valor_glosa) > 0);
  const porMotivo = {};
  glosadas.forEach((l) => { const k = l.codigo_glosa || '—'; (porMotivo[k] ||= { n: 0, v: 0 }); porMotivo[k].n++; porMotivo[k].v += Number(l.valor_glosa); });
  const motivosOrd = Object.entries(porMotivo).sort((a, b) => b[1].v - a[1].v);
  const lotes = resumoPorLote(ls.map((l) => ({ ...l, valor_informado: Number(l.valor_informado), valor_glosa: Number(l.valor_glosa) })));
  const loteMeu = new Set(minhas.map((l) => l.numero_lote));
  const st = STATUS[r.status];

  $('#titulo-tela').textContent = `Retorno ${r.contratos?.nome || ''} · ${data(r.data_emissao)}`;
  $('#acoes-tela').innerHTML = `<a class="btn" href="#retornos">← Voltar</a>
    ${r.status === 'em_revisao' ? '<button class="btn escuro" id="excluir">Excluir</button><button class="btn primario" id="confirmar">Confirmar retorno</button>' : ''}`;

  c.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="rotulo">Faturado pela clínica</div><div class="valor">${brl(inf)}</div><div class="sub">${new Set(minhas.map((l) => l.numero_guia_prestador)).size} guias</div></div>
      <div class="kpi alerta"><div class="rotulo">Glosado</div><div class="valor">${brl(glo)}</div><div class="sub">${glosadas.length} itens glosados</div></div>
      <div class="kpi ${inf && glo / inf > 0.05 ? 'alerta' : ''}"><div class="rotulo">Taxa de glosa</div><div class="valor">${pct(inf ? (glo / inf) * 100 : 0)}</div></div>
      <div class="kpi"><div class="rotulo">Status</div><div class="valor" style="font-size:18px"><span class="selo ${st[0]}">${st[1]}</span></div>
        <div class="sub">${r.soma_confere ? 'Soma do arquivo confere ✓' : 'Soma divergente ⚠️'}</div></div>
    </div>

    <div class="cartao"><h3>Lotes no arquivo</h3>
      <table><thead><tr><th>Lote</th><th>Protocolo</th><th class="num">Guias</th><th class="num">Informado</th><th class="num">Glosa</th><th class="num">Taxa</th><th>De quem</th></tr></thead><tbody>
      ${lotes.map((l) => `<tr><td>${esc(l.lote)}</td><td>${esc(l.protocolo)}</td><td class="num">${l.guias}</td>
        <td class="num">${brl(l.informado)}</td><td class="num">${brl(l.glosa)}</td><td class="num">${pct(l.informado ? (l.glosa / l.informado) * 100 : 0)}</td>
        <td>${loteMeu.has(l.lote) ? '<span class="selo clinica">Da clínica</span>' : '<span class="selo outra">Outra clínica</span>'}</td></tr>`).join('')}
      </tbody></table></div>

    <div class="cartao"><h3>Por que glosou</h3>
      ${motivosOrd.length ? `<table><tbody>${motivosOrd.map(([k, v]) => `<tr><td style="width:70px"><strong>${esc(k)}</strong></td>
        <td>${esc(desc[k] || 'Descrição a cadastrar (tabela ANS)')}</td><td class="num" style="width:60px">${v.n}×</td>
        <td style="width:160px"><div class="barra"><span style="width:${(v.v / glo) * 100}%"></span></div></td>
        <td class="num" style="width:110px">${brl(v.v)}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhuma glosa nos lotes da clínica. 🎉</div>'}
    </div>

    <div class="cartao tabela-rolagem"><h3>Itens glosados da clínica</h3>
      ${glosadas.length ? `<table><thead><tr><th>Revisado</th><th>Guia</th><th>Guia operadora</th><th>Data</th><th>Procedimento</th>
        <th class="num">Informado</th><th class="num">Glosa</th><th>Motivo</th></tr></thead><tbody>
      ${glosadas.map((l) => `<tr><td><input type="checkbox" class="rev" data-id="${l.id}" ${l.revisado ? 'checked' : ''} ${r.status !== 'em_revisao' ? 'disabled' : ''}></td>
        <td>${esc(l.numero_guia_prestador)}</td><td>${esc(l.numero_guia_operadora)}</td><td>${data(l.data_realizacao)}</td>
        <td>${esc(l.codigo_procedimento || 'guia inteira')}</td><td class="num">${brl(l.valor_informado)}</td>
        <td class="num"><strong>${brl(l.valor_glosa)}</strong></td>
        <td title="${esc(desc[l.codigo_glosa] || '')}"><strong>${esc(l.codigo_glosa || '—')}</strong> ${esc((desc[l.codigo_glosa] || '').slice(0, 48))}</td></tr>`).join('')}
      </tbody></table>` : '<div class="vazio">Sem itens glosados.</div>'}
    </div>`;

  $$('.rev', c).forEach((cb) => (cb.onchange = async () => {
    const { error: e } = await sb.from('retorno_linhas').update({ revisado: cb.checked }).eq('id', cb.dataset.id);
    if (e) { cb.checked = !cb.checked; falha(e); }
  }));
  $('#confirmar')?.addEventListener('click', async () => {
    const pend = $$('.rev', c).filter((x) => !x.checked).length;
    if (!(await confirmar(pend ? `Ainda há ${pend} itens glosados não marcados como revisados. Confirmar mesmo assim?` :
      'Confirmar este retorno? As glosas passam a valer para os relatórios.'))) return;
    const { error: e } = await sb.from('retornos').update({ status: 'confirmado', confirmado_por: estado.user.id, confirmado_em: new Date().toISOString() }).eq('id', id);
    if (e) return falha(e); toast('Retorno confirmado.'); detalhe(id);
  });
  $('#excluir')?.addEventListener('click', async () => {
    if (!(await confirmar('Excluir este retorno importado? Os lotes vinculados continuam cadastrados.', 'Excluir'))) return;
    const { error: e } = await sb.from('retornos').delete().eq('id', id);
    if (e) return falha(e); toast('Retorno excluído.'); location.hash = 'retornos';
  });
}
