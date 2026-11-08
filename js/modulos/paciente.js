// Módulo Ficha do paciente: tudo que se liga ao paciente num lugar só.
// Abas: Resumo · Dados · Convênios · Autorizações · Atendimentos · Guias e glosas · Prontuário
import { sb, estado, $, $$, esc, brl, data, tela, toast, falha, modal, confirmar, podeGerir } from '../core.js';

const ABAS = [['resumo', 'Resumo'], ['dados', 'Dados'], ['convenios', 'Convênios'], ['autorizacoes', 'Autorizações'],
  ['atendimentos', 'Atendimentos'], ['guias', 'Guias e glosas'], ['prontuario', 'Prontuário']];
const ST = { agendado: 'pendente', confirmado: 'pendente', presente: 'pendente', atendido: 'ok', faltou: 'alerta', cancelado: 'outra' };
const hojeIso = () => new Date().toISOString().slice(0, 10);
const dh = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function render(params) {
  const [id, abaUrl] = [params.slice(0, 36), params.slice(37) || 'resumo'];
  const c = tela('Paciente', '<a class="btn" href="#pacientes">← Pacientes</a>');
  const gestao = podeGerir() || estado.perfil === 'recepcao';
  const cid = estado.clinica.id;

  const [{ data: p, error }, { data: planos }, { data: ats }, { data: auts }, { data: contratos }] = await Promise.all([
    sb.from('pacientes').select('*').eq('id', id).single(),
    sb.from('paciente_planos').select('*, contratos(id, nome)').eq('paciente_id', id).order('principal', { ascending: false }),
    sb.from('atendimentos').select('id, inicio, status, servico, autorizacao_id, profissionais(nome)').eq('paciente_id', id).order('inicio', { ascending: false }),
    sb.from('autorizacoes').select('*, procedimentos(codigo, descricao), profissionais(nome), paciente_planos!inner(paciente_id, contratos(nome))')
      .eq('paciente_planos.paciente_id', id).order('data_autorizacao', { ascending: false }),
    gestao ? sb.from('contratos').select('id, nome').eq('clinica_id', cid).eq('ativo', true).order('nome') : Promise.resolve({ data: [] }),
  ]);
  if (error) return falha(error);
  const x = p.campos_extras || {}, e = p.endereco || {};

  // Pendências do cadastro que travam a guia TISS
  const faltas = [];
  if (!p.cpf) faltas.push('CPF'); if (!p.data_nascimento) faltas.push('data de nascimento');
  if (!(planos || []).length && x.convenio_origem && !/particular/i.test(x.convenio_origem)) faltas.push('vínculo com o contrato do convênio');
  (planos || []).forEach((pl) => { if (pl.validade && pl.validade < hojeIso()) faltas.push(`carteirinha vencida (${pl.contratos?.nome})`); });

  const passado = (ats || []).filter((a) => new Date(a.inicio) < new Date());
  const futuros = (ats || []).filter((a) => new Date(a.inicio) >= new Date() && a.status !== 'cancelado').reverse();
  const idade = p.data_nascimento ? Math.floor((Date.now() - new Date(p.data_nascimento)) / 31557600000) : null;

  $('#titulo-tela').textContent = p.nome;
  $('#acoes-tela').innerHTML = `<a class="btn" href="#pacientes">← Pacientes</a>${p.ativo ? '' : ' <span class="selo outra">inativo</span>'}`;
  c.innerHTML = `
    <div class="cartao ficha-topo">
      <div><span class="muted">${[idade != null ? idade + ' anos' : null, p.sexo, p.telefone].filter(Boolean).map(esc).join(' · ') || 'Sem dados básicos'}</span>
        ${(planos || []).map((pl) => `<span class="selo clinica">${esc(pl.contratos?.nome)} · ${esc(pl.carteirinha)}</span>`).join(' ')
          || (x.convenio_origem ? `<span class="selo outra">Sistema antigo: ${esc(x.convenio_origem)}</span>` : '')}</div>
      ${faltas.length ? `<div class="dica" style="margin:10px 0 0">⚠️ Para faturar convênio falta: <strong>${faltas.map(esc).join(', ')}</strong></div>` : ''}
    </div>
    <nav class="abas">${ABAS.map(([k, n]) => `<a href="#paciente-${id}-${k}" class="${k === abaUrl ? 'ativa' : ''}">${n}</a>`).join('')}</nav>
    <div id="aba"></div>`;
  const alvo = $('#aba');
  const recarregar = () => render(params);

  const abas = {
    resumo() {
      const faltou = passado.filter((a) => a.status === 'faltou').length, atend = passado.filter((a) => a.status === 'atendido').length;
      const ultima = passado.find((a) => a.status === 'atendido');
      alvo.innerHTML = `<div class="kpis">
          <div class="kpi"><div class="rotulo">Atendimentos realizados</div><div class="valor">${atend}</div><div class="sub">última: ${ultima ? data(ultima.inicio.slice(0, 10)) : '—'}</div></div>
          <div class="kpi ${faltou >= 2 ? 'alerta' : ''}"><div class="rotulo">Faltas</div><div class="valor">${faltou}</div><div class="sub">${passado.length ? Math.round((faltou / passado.length) * 100) : 0}% dos agendamentos</div></div>
          <div class="kpi"><div class="rotulo">Próximos agendamentos</div><div class="valor">${futuros.length}</div><div class="sub">${futuros[0] ? dh(futuros[0].inicio) : '—'}</div></div>
          <div class="kpi"><div class="rotulo">Autorizações ativas</div><div class="valor">${(auts || []).filter((a) => !a.validade || a.validade >= hojeIso()).length}</div></div>
        </div>
        <div class="cartao"><h3>Próximos</h3>${listaAts(futuros.slice(0, 5))}</div>
        ${Object.keys(x).length ? `<div class="cartao"><h3>Do sistema antigo</h3><p class="muted">${Object.entries(x).map(([k, v]) => `<strong>${esc(k.replace(/_/g, ' '))}:</strong> ${esc(v)}`).join(' · ')}</p></div>` : ''}`;
    },

    dados() {
      alvo.innerHTML = `<div class="cartao"><form class="grade-form" id="f">
        <label>Nome<input name="nome" required value="${esc(p.nome)}"></label>
        <label>Nome social<input name="nome_social" value="${esc(p.nome_social)}"></label>
        <label>CPF<input name="cpf" value="${esc(p.cpf)}"></label>
        <label>Nascimento<input type="date" name="data_nascimento" value="${esc(p.data_nascimento)}"></label>
        <label>Sexo<select name="sexo"><option value=""></option><option ${p.sexo === 'F' ? 'selected' : ''}>F</option><option ${p.sexo === 'M' ? 'selected' : ''}>M</option></select></label>
        <label>Nome da mãe<input name="nome_mae" value="${esc(p.nome_mae)}"></label>
        <label>CNS (cartão SUS)<input name="cns" value="${esc(p.cns)}"></label>
        <label>Telefone<input name="telefone" value="${esc(p.telefone)}"></label>
        <label>E-mail<input name="email" value="${esc(p.email)}"></label>
        <label>Rua<input name="rua" value="${esc(e.rua)}"></label><label>CEP<input name="cep" value="${esc(e.cep)}"></label>
        <label>Cidade<input name="cidade" value="${esc(e.cidade)}"></label><label>UF<input name="uf" maxlength="2" value="${esc(e.uf)}"></label>
        <label><span><input type="checkbox" name="consentimento_comunicacao" ${p.consentimento_comunicacao ? 'checked' : ''}> Aceita lembretes (LGPD)</span></label>
        <label><span><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativo</span></label>
      </form>${gestao ? '<div class="linha-acoes"><button class="btn primario" id="s">Salvar</button></div>' : ''}</div>`;
      $('#s')?.addEventListener('click', async () => {
        const fd = new FormData($('#f')), f = Object.fromEntries(fd);
        if (!f.nome.trim()) return toast('Informe o nome.', true);
        const { error: er } = await sb.from('pacientes').update({ nome: f.nome.trim(), nome_social: f.nome_social || null, cpf: f.cpf.replace(/\D/g, '') || null,
          data_nascimento: f.data_nascimento || null, sexo: f.sexo || null, nome_mae: f.nome_mae || null, cns: f.cns || null, telefone: f.telefone || null,
          email: f.email || null, consentimento_comunicacao: fd.has('consentimento_comunicacao'), ativo: fd.has('ativo'),
          endereco: { ...e, rua: f.rua, cep: f.cep, cidade: f.cidade, uf: f.uf.toUpperCase() } }).eq('id', id);
        if (er) return falha(er, er.code === '23505' ? 'CPF já cadastrado em outro paciente' : 'Salvar'); toast('Salvo.'); recarregar();
      });
    },

    convenios() {
      alvo.innerHTML = `<div class="cartao">
        ${x.convenio_origem ? `<div class="dica">No sistema antigo: <strong>${esc(x.convenio_origem)}</strong>${x.carteirinha_origem ? ` · carteirinha ${esc(x.carteirinha_origem)}` : ''}</div>` : ''}
        <table><thead><tr><th>Contrato</th><th>Plano</th><th>Carteirinha</th><th>Validade</th><th>Principal</th><th></th></tr></thead><tbody>
        ${(planos || []).map((pl) => `<tr><td>${esc(pl.contratos?.nome)}</td><td>${esc(pl.plano_nome || '—')}</td><td>${esc(pl.carteirinha)}</td>
          <td>${pl.validade ? `${data(pl.validade)}${pl.validade < hojeIso() ? ' <span class="selo alerta">vencida</span>' : ''}` : '—'}</td>
          <td>${pl.principal ? '✓' : ''}</td><td>${gestao ? `<button class="btn pequeno" data-del="${pl.id}">Remover</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="6" class="vazio">Nenhum convênio vinculado.</td></tr>'}</tbody></table>
        ${gestao ? `<h3 style="margin-top:16px">Vincular convênio</h3><form class="grade-form" id="f">
          <label>Contrato<select name="contrato_id">${contratos.map((k) => `<option value="${k.id}" ${sugere(k.nome) ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></label>
          <label>Plano<input name="plano_nome" placeholder="ex.: Executivo, Rede 843"></label>
          <label>Carteirinha<input name="carteirinha" required value="${esc(x.carteirinha_origem || '')}"></label>
          <label>Validade<input type="date" name="validade"></label>
          <label><span><input type="checkbox" name="principal" ${(planos || []).length ? '' : 'checked'}> Principal</span></label>
          </form><div class="linha-acoes"><button class="btn primario" id="s">Vincular</button></div>` : ''}</div>`;
      function sugere(nome) {
        const o = (x.convenio_origem || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0];
        return o && nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(o.replace('correios', 'postal'));
      }
      $('#s')?.addEventListener('click', async () => {
        const fd = new FormData($('#f')), f = Object.fromEntries(fd);
        if (!f.carteirinha.trim()) return toast('Informe a carteirinha.', true);
        if (fd.has('principal')) await sb.from('paciente_planos').update({ principal: false }).eq('paciente_id', id);
        const { error: er } = await sb.from('paciente_planos').insert({ clinica_id: cid, paciente_id: id, contrato_id: f.contrato_id,
          plano_nome: f.plano_nome || null, carteirinha: f.carteirinha.trim(), validade: f.validade || null, principal: fd.has('principal') });
        if (er) return falha(er); toast('Convênio vinculado.'); recarregar();
      });
      $$('[data-del]', alvo).forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Remover este vínculo? Guias já emitidas não são afetadas.', 'Remover'))) return;
        const { error: er } = await sb.from('paciente_planos').delete().eq('id', b.dataset.del);
        if (er) return falha(er, er.code === '23503' ? 'Há guias ou autorizações usando este convênio' : ''); recarregar();
      }));
    },

    async autorizacoes() {
      // sessões usadas = atendimentos realizados ligados à autorização
      const usadas = {}; (ats || []).forEach((a) => a.autorizacao_id && a.status === 'atendido' && (usadas[a.autorizacao_id] = (usadas[a.autorizacao_id] || 0) + 1));
      alvo.innerHTML = `<div class="cartao"><table><thead><tr><th>Data</th><th>Convênio</th><th>Procedimento</th><th>Senha</th><th class="num">Usadas / autorizadas</th><th>Validade</th></tr></thead><tbody>
        ${(auts || []).map((a) => { const u = usadas[a.id] || 0, venc = a.validade && a.validade < hojeIso();
          return `<tr><td>${data(a.data_autorizacao)}</td><td>${esc(a.paciente_planos?.contratos?.nome)}</td>
          <td>${esc(a.procedimentos?.codigo)} · ${esc(a.procedimentos?.descricao)}</td><td>${esc(a.senha || '—')}</td>
          <td class="num"><strong>${u} / ${a.qtd_autorizada}</strong> ${u >= a.qtd_autorizada ? '<span class="selo alerta">esgotada</span>' : ''}</td>
          <td>${a.validade ? data(a.validade) : '—'} ${venc ? '<span class="selo alerta">vencida</span>' : ''}</td></tr>`; }).join('')
        || '<tr><td colspan="6" class="vazio">Nenhuma autorização registrada.</td></tr>'}</tbody></table>
        ${gestao && (planos || []).length ? `<h3 style="margin-top:16px">Registrar autorização</h3><form class="grade-form" id="f">
          <label>Convênio<select name="paciente_plano_id" id="pl">${planos.map((pl) => `<option value="${pl.id}" data-ct="${pl.contrato_id}">${esc(pl.contratos?.nome)}</option>`).join('')}</select></label>
          <label>Procedimento<select name="procedimento_id" id="proc"></select></label>
          <label>Qtd. autorizada<input type="number" name="qtd" min="1" value="10"></label>
          <label>Senha<input name="senha"></label><label>Nº guia operadora<input name="guia"></label>
          <label>Data da autorização<input type="date" name="data" value="${hojeIso()}"></label><label>Validade<input type="date" name="validade"></label>
          </form><div class="linha-acoes"><button class="btn primario" id="s">Registrar</button></div>`
          : gestao ? '<div class="dica">Vincule um convênio na aba Convênios para registrar autorizações.</div>' : ''}</div>`;
      const carregaProcs = async () => {
        const ct = $('#pl').selectedOptions[0].dataset.ct;
        const { data: itens } = await sb.from('contrato_tabela').select('procedimentos(id, codigo, descricao)').eq('contrato_id', ct).is('vigencia_fim', null);
        $('#proc').innerHTML = (itens || []).map((i) => `<option value="${i.procedimentos.id}">${esc(i.procedimentos.codigo)} · ${esc(i.procedimentos.descricao)}</option>`).join('');
      };
      if ($('#pl')) { $('#pl').onchange = carregaProcs; carregaProcs(); }
      $('#s')?.addEventListener('click', async () => {
        const f = Object.fromEntries(new FormData($('#f')));
        if (!f.procedimento_id) return toast('Escolha o procedimento.', true);
        const { error: er } = await sb.from('autorizacoes').insert({ clinica_id: cid, paciente_plano_id: f.paciente_plano_id, procedimento_id: f.procedimento_id,
          qtd_autorizada: Number(f.qtd), senha: f.senha || null, numero_guia_operadora: f.guia || null, data_autorizacao: f.data, validade: f.validade || null });
        if (er) return falha(er); toast('Autorização registrada.'); recarregar();
      });
    },

    atendimentos() {
      alvo.innerHTML = `<div class="cartao">${listaAts(ats || [])}</div>`;
    },

    async guias() {
      if (!podeGerir()) { alvo.innerHTML = '<div class="cartao vazio">Disponível para a gestão.</div>'; return; }
      const carts = [...new Set([...(planos || []).map((pl) => pl.carteirinha), x.carteirinha_origem].filter(Boolean).map((k) => k.replace(/\D/g, '')))];
      const [{ data: gs }, { data: rls }, { data: mot }] = await Promise.all([
        sb.from('guias').select('id, numero_guia_prestador, data_atendimento, status, contratos(nome), guia_itens(valor_informado, valor_glosa, procedimentos(codigo))')
          .in('paciente_plano_id', (planos || []).map((pl) => pl.id).concat(['00000000-0000-0000-0000-000000000000'])).order('data_atendimento', { ascending: false }),
        carts.length ? sb.from('retorno_linhas').select('numero_lote, numero_guia_prestador, data_realizacao, codigo_procedimento, valor_informado, valor_glosa, codigo_glosa')
          .eq('clinica_id', cid).in('carteirinha', carts).order('data_realizacao', { ascending: false }) : Promise.resolve({ data: [] }),
        sb.from('motivos_glosa').select('codigo, descricao'),
      ]);
      const desc = Object.fromEntries((mot || []).map((m) => [m.codigo, m.descricao]));
      const glosadas = (rls || []).filter((l) => Number(l.valor_glosa) > 0);
      alvo.innerHTML = `<div class="cartao"><h3>Guias emitidas pelo Cure OS</h3>
        ${(gs || []).length ? `<table><thead><tr><th>Data</th><th>Guia</th><th>Contrato</th><th>Status</th><th class="num">Valor</th><th class="num">Glosa</th></tr></thead><tbody>
          ${gs.map((g) => `<tr><td>${data(g.data_atendimento)}</td><td>${esc(g.numero_guia_prestador)}</td><td>${esc(g.contratos?.nome)}</td><td>${esc(g.status)}</td>
            <td class="num">${brl(g.guia_itens.reduce((s, i) => s + Number(i.valor_informado), 0))}</td>
            <td class="num">${brl(g.guia_itens.reduce((s, i) => s + Number(i.valor_glosa), 0))}</td></tr>`).join('')}</tbody></table>`
          : '<div class="vazio">Nenhuma guia ainda — serão geradas a partir dos atendimentos (próxima etapa).</div>'}</div>
        <div class="cartao"><h3>Histórico nos retornos das operadoras</h3>
        ${(rls || []).length ? `<p class="muted">${rls.length} itens encontrados pela carteirinha · ${glosadas.length} glosados (${brl(glosadas.reduce((s, l) => s + Number(l.valor_glosa), 0))})</p>
          <table><thead><tr><th>Data</th><th>Guia</th><th>Procedimento</th><th class="num">Informado</th><th class="num">Glosa</th><th>Motivo</th></tr></thead><tbody>
          ${rls.map((l) => `<tr><td>${data(l.data_realizacao)}</td><td>${esc(l.numero_guia_prestador)}</td><td>${esc(l.codigo_procedimento || 'guia')}</td>
            <td class="num">${brl(l.valor_informado)}</td><td class="num">${Number(l.valor_glosa) ? `<strong>${brl(l.valor_glosa)}</strong>` : '—'}</td>
            <td>${l.codigo_glosa ? `${esc(l.codigo_glosa)} ${esc((desc[l.codigo_glosa] || '').slice(0, 50))}` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<div class="vazio">Nenhum item nos retornos importados para a carteirinha deste paciente.</div>'}</div>`;
    },

    prontuario() {
      alvo.innerHTML = `<div class="cartao vazio">O prontuário entra na próxima fase, junto com a importação dos prontuários antigos
        ${p.origem_id ? `(este paciente tem o ID antigo <strong>${esc(p.origem_id)}</strong>, que liga aos arquivos do sistema anterior)` : ''}.</div>`;
    },
  };

  function listaAts(lista) {
    return lista.length ? `<table><thead><tr><th>Data</th><th>Serviço</th><th>Profissional</th><th>Status</th></tr></thead><tbody>
      ${lista.map((a) => `<tr><td>${dh(a.inicio)}</td><td>${esc(a.servico || '—')}</td><td>${esc(a.profissionais?.nome)}</td>
        <td><span class="selo ${ST[a.status]}">${esc(a.status)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhum atendimento.</div>';
  }

  await (abas[abaUrl] || abas.resumo)();
}
