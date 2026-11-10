// Módulo Ficha do paciente: tudo que se liga ao paciente num lugar só.
// Abas: Resumo · Cadastro e convênios · Encaminhamentos · Autorizações e agendamentos · Guias e glosas · Prontuário · Documentos
import { sb, estado, $, $$, esc, brl, data, tela, toast, falha, modal, confirmar, podeGerir } from '../core.js';
import { enviarArquivo, abrirArquivo, escolherArquivo, removerArquivo, ACEITA } from './documentos.js';
import { imprimirGuia } from './guia-impressa.js';
import { abaProntuario } from './prontuario.js';
import { abaDocumentos } from './emissao.js';

const ABAS = [['resumo', 'Resumo'], ['cadastro', 'Cadastro e convênios'], ['encaminhamentos', 'Encaminhamentos'],
  ['autorizacoes', 'Autorizações e agendamentos'], ['guias', 'Guias e glosas'], ['prontuario', 'Prontuário'], ['documentos', 'Documentos']];
const ALIAS = { dados: 'cadastro', convenios: 'cadastro', atendimentos: 'autorizacoes' };   // links antigos continuam valendo
// Situação de faturamento do atendimento, pela guia em que ele entrou
const FIN = { rascunho: ['a faturar', 'pendente'], pronta: ['a faturar', 'pendente'], enviada: ['faturado', 'clinica'], paga: ['pago', 'ok'],
  glosa_parcial: ['glosa parcial', 'alerta'], glosa_total: ['glosado', 'alerta'], cancelada: ['guia cancelada', 'outra'] };
const ST = { agendado: 'pendente', confirmado: 'pendente', presente: 'pendente', atendido: 'ok', faltou: 'alerta', cancelado: 'outra' };
const AREAS = { fisioterapia: 'Fisioterapia', nutricao: 'Nutrição', psicologia: 'Psicologia', palmilha: 'Palmilha / podologia', outra: 'Outra' };
const opcoesArea = (sel) => Object.entries(AREAS).map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');
const hojeIso = () => new Date().toISOString().slice(0, 10);
const dh = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function render(params) {
  const [id, abaHash] = [params.slice(0, 36), params.slice(37) || 'resumo'];
  const [abaBruta, abaExtra] = abaHash.split(':');
  const abaUrl = ALIAS[abaBruta] || abaBruta;
  const c = tela('Paciente', '<a class="btn" href="#pacientes">← Pacientes</a>');
  const gestao = podeGerir() || estado.perfil === 'recepcao';
  const cid = estado.clinica.id;

  const [{ data: p, error }, { data: planos }, { data: ats }, { data: auts }, { data: contratos }, { data: encs }, { data: sols }] = await Promise.all([
    sb.from('pacientes').select('*').eq('id', id).single(),
    sb.from('paciente_planos').select('*, contratos(id, nome)').eq('paciente_id', id).order('principal', { ascending: false }),
    sb.from('atendimentos').select('id, inicio, fim, status, servico, sala, autorizacao_id, paciente_plano_id, profissional_id, profissionais(nome)').eq('paciente_id', id).order('inicio', { ascending: false }),
    sb.from('autorizacoes').select('*, procedimentos(codigo, descricao), profissionais(nome), paciente_planos!inner(paciente_id, contratos(nome))')
      .eq('paciente_planos.paciente_id', id).order('data_autorizacao', { ascending: false }),
    gestao ? sb.from('contratos').select('id, nome').eq('clinica_id', cid).eq('ativo', true).order('nome') : Promise.resolve({ data: [] }),
    sb.from('encaminhamentos').select('*, solicitantes(nome, conselho, numero_conselho)').eq('paciente_id', id).order('data_pedido', { ascending: false }),
    sb.from('solicitantes').select('id, nome, conselho, numero_conselho').eq('clinica_id', cid).eq('ativo', true).order('nome'),
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

    cadastro() {
      alvo.innerHTML = '<div id="sub-dados"></div><h3 style="margin:18px 0 8px">Convênios</h3><div id="sub-conv"></div>';
      abas.dados($('#sub-dados')); abas.convenios($('#sub-conv'));
    },

    dados(t = alvo) {
      t.innerHTML = `<div class="cartao"><form class="grade-form" id="fdados">
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
      </form>${gestao ? '<div class="linha-acoes"><button class="btn primario" id="sdados">Salvar dados</button></div>' : ''}</div>`;
      $('#sdados')?.addEventListener('click', async () => {
        const fd = new FormData($('#fdados')), f = Object.fromEntries(fd);
        if (!f.nome.trim()) return toast('Informe o nome.', true);
        const { error: er } = await sb.from('pacientes').update({ nome: f.nome.trim(), nome_social: f.nome_social || null, cpf: f.cpf.replace(/\D/g, '') || null,
          data_nascimento: f.data_nascimento || null, sexo: f.sexo || null, nome_mae: f.nome_mae || null, cns: f.cns || null, telefone: f.telefone || null,
          email: f.email || null, consentimento_comunicacao: fd.has('consentimento_comunicacao'), ativo: fd.has('ativo'),
          endereco: { ...e, rua: f.rua, cep: f.cep, cidade: f.cidade, uf: f.uf.toUpperCase() } }).eq('id', id);
        if (er) return falha(er, er.code === '23505' ? 'CPF já cadastrado em outro paciente' : 'Salvar'); toast('Salvo.'); recarregar();
      });
    },

    convenios(t = alvo) {
      t.innerHTML = `<div class="cartao">
        ${x.convenio_origem ? `<div class="dica">No sistema antigo: <strong>${esc(x.convenio_origem)}</strong>${x.carteirinha_origem ? ` · carteirinha ${esc(x.carteirinha_origem)}` : ''}</div>` : ''}
        <table><thead><tr><th>Contrato</th><th>Plano</th><th>Carteirinha</th><th>Validade</th><th>Principal</th><th></th></tr></thead><tbody>
        ${(planos || []).map((pl) => `<tr><td>${esc(pl.contratos?.nome)}</td><td>${esc(pl.plano_nome || '—')}</td><td>${esc(pl.carteirinha)}</td>
          <td>${pl.validade ? `${data(pl.validade)}${pl.validade < hojeIso() ? ' <span class="selo alerta">vencida</span>' : ''}` : '—'}</td>
          <td>${pl.principal ? '✓' : ''}</td><td>${gestao ? `<button class="btn pequeno" data-del="${pl.id}">Remover</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="6" class="vazio">Nenhum convênio vinculado.</td></tr>'}</tbody></table>
        ${gestao ? `<h3 style="margin-top:16px">Vincular convênio</h3><form class="grade-form" id="fconv">
          <label>Contrato<select name="contrato_id">${contratos.map((k) => `<option value="${k.id}" ${sugere(k.nome) ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></label>
          <label>Plano<input name="plano_nome" placeholder="ex.: Executivo, Rede 843"></label>
          <label>Carteirinha<input name="carteirinha" required value="${esc(x.carteirinha_origem || '')}"></label>
          <label>Validade<input type="date" name="validade"></label>
          <label><span><input type="checkbox" name="principal" ${(planos || []).length ? '' : 'checked'}> Principal</span></label>
          </form><div class="linha-acoes"><button class="btn primario" id="sconv">Vincular</button></div>` : ''}</div>`;
      function sugere(nome) {
        const o = (x.convenio_origem || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0];
        return o && nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(o.replace('correios', 'postal'));
      }
      $('#sconv')?.addEventListener('click', async () => {
        const fd = new FormData($('#fconv')), f = Object.fromEntries(fd);
        if (!f.carteirinha.trim()) return toast('Informe a carteirinha.', true);
        if (fd.has('principal')) await sb.from('paciente_planos').update({ principal: false }).eq('paciente_id', id);
        const { error: er } = await sb.from('paciente_planos').insert({ clinica_id: cid, paciente_id: id, contrato_id: f.contrato_id,
          plano_nome: f.plano_nome || null, carteirinha: f.carteirinha.trim(), validade: f.validade || null, principal: fd.has('principal') });
        if (er) return falha(er); toast('Convênio vinculado.'); recarregar();
      });
      $$('[data-del]', t).forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Remover este vínculo? Guias já emitidas não são afetadas.', 'Remover'))) return;
        const { error: er } = await sb.from('paciente_planos').delete().eq('id', b.dataset.del);
        if (er) return falha(er, er.code === '23503' ? 'Há guias ou autorizações usando este convênio' : ''); recarregar();
      }));
    },

    encaminhamentos() {
      const vinc = {}; (auts || []).forEach((a) => a.encaminhamento_id && (vinc[a.encaminhamento_id] ||= []).push(a));
      const usadasDe = (a) => (ats || []).filter((t) => t.autorizacao_id === a.id && t.status === 'atendido').length;
      const linha = (en) => {
        const venc = en.validade && en.validade < hojeIso(), lig = vinc[en.id] || [];
        const usadas = lig.reduce((s, a) => s + usadasDe(a), 0);
        return `<tr class="${en.status === 'cancelado' ? 'muted' : ''}"><td><span class="selo clinica">${esc(AREAS[en.area])}</span></td>
          <td>${data(en.data_pedido)}</td><td>${en.validade ? data(en.validade) : '—'} ${venc ? '<span class="selo alerta">vencido</span>' : ''}</td>
          <td>${esc(en.solicitantes ? `${en.solicitantes.nome} (${en.solicitantes.conselho} ${en.solicitantes.numero_conselho})` : '—')}</td>
          <td>${esc(en.cid || '—')}</td>
          <td class="num">${usadas}${en.qtd_sessoes ? ' / ' + en.qtd_sessoes : ''}</td>
          <td>${lig.length ? `<span class="selo ok">✓ ${lig.length} autorização${lig.length > 1 ? 'ões' : ''}</span> <span class="muted">${lig.map((a) => esc(a.senha || 'sem senha')).join(', ')}</span>`
            : '<span class="selo pendente">não vinculado</span>'}</td>
          <td style="white-space:nowrap">${en.arquivo ? `<button class="btn pequeno" data-abrir="${esc(en.arquivo)}">Ver pedido</button>${gestao
              ? ` <button class="btn pequeno" data-anexar="${en.id}" title="Substituir pelo arquivo certo">Trocar</button> <button class="btn pequeno" data-rmarq="${en.id}">Remover arquivo</button>` : ''}`
            : `<span class="selo alerta">sem arquivo</span>${gestao ? ` <button class="btn pequeno" data-anexar="${en.id}">Anexar</button>` : ''}`}
            ${gestao && en.status === 'ativo' && !lig.length ? ` <button class="btn pequeno" data-cancen="${en.id}">Cancelar</button>` : ''}
            ${gestao && !lig.length ? ` <button class="btn pequeno escuro" data-excen="${en.id}" title="Para registro feito por engano">Excluir</button>` : ''}</td></tr>`;
      };
      alvo.innerHTML = `<div class="cartao tabela-rolagem">
        <p class="muted">Pedido médico de cada área. Vincule à autorização do convênio na aba Autorizações: o pedido vai como anexo obrigatório (03) das guias.</p>
        <table><thead><tr><th>Área</th><th>Pedido em</th><th>Validade</th><th>Solicitante</th><th>CID</th><th class="num">Sessões feitas / pedidas</th>
          <th>Vínculo</th><th></th></tr></thead><tbody>
        ${(encs || []).map(linha).join('') || '<tr><td colspan="8" class="vazio">Nenhum encaminhamento registrado.</td></tr>'}</tbody></table>
        ${gestao ? `<h3 style="margin-top:16px">Registrar encaminhamento</h3><form class="grade-form" id="f">
          <label>Área<select name="area">${opcoesArea('fisioterapia')}</select></label>
          <label>Solicitante <a href="#" id="novo-sol" style="font-weight:400">+ novo médico</a><select name="solicitante_id" id="sol"><option value="">—</option>${(sols || []).map((s) => `<option value="${s.id}">${esc(s.nome)} · ${esc(s.conselho)} ${esc(s.numero_conselho)}</option>`).join('')}</select></label>
          <label>Data do pedido<input type="date" name="data_pedido" value="${hojeIso()}" required></label>
          <label>Validade<input type="date" name="validade"></label>
          <label>CID<input name="cid" placeholder="ex.: M54.5"></label>
          <label>Sessões pedidas<input type="number" name="qtd_sessoes" min="1" placeholder="opcional"></label>
          <label style="grid-column:1/-1">Indicação clínica<input name="indicacao_clinica"></label>
          <label style="grid-column:1/-1">Arquivo do pedido (PDF/foto)<input type="file" name="arq" accept="${ACEITA}"></label>
          </form>
          <div class="linha-acoes"><button class="btn primario" id="s">Registrar</button></div>` : ''}</div>`;

      $$('[data-abrir]', alvo).forEach((b) => (b.onclick = () => abrirArquivo(b.dataset.abrir)));
      $('#novo-sol')?.addEventListener('click', (ev) => { ev.preventDefault(); novoSolicitante(); });
      $$('[data-anexar]', alvo).forEach((b) => (b.onclick = async () => {
        const f = await escolherArquivo(); if (!f) return;
        const antigo = (encs || []).find((x) => x.id === b.dataset.anexar)?.arquivo;
        try {
          const up = await enviarArquivo(f, `pacientes/${id}/encaminhamentos`);
          const { error: er } = await sb.from('encaminhamentos').update(up).eq('id', b.dataset.anexar);
          if (er) throw er;
          if (antigo) await removerArquivo(antigo).catch(() => {});   // o antigo sai só depois do novo gravado
          toast(antigo ? 'Pedido substituído.' : 'Pedido anexado.'); recarregar();
        } catch (e) { falha(e, 'Anexar'); }
      }));
      $$('[data-rmarq]', alvo).forEach((b) => (b.onclick = async () => {
        const en = (encs || []).find((x) => x.id === b.dataset.rmarq);
        if (!(await confirmar('Remover o arquivo deste encaminhamento? O arquivo é apagado do sistema (a cópia do backup semanal continua). O registro do encaminhamento fica.', 'Remover arquivo'))) return;
        try {
          const { error: er } = await sb.from('encaminhamentos').update({ arquivo: null, arquivo_nome: null }).eq('id', en.id);
          if (er) throw er;
          await removerArquivo(en.arquivo); toast('Arquivo removido.'); recarregar();
        } catch (e) { falha(e, 'Remover arquivo'); }
      }));
      $$('[data-excen]', alvo).forEach((b) => (b.onclick = async () => {
        const en = (encs || []).find((x) => x.id === b.dataset.excen);
        if (!(await confirmar('Excluir este encaminhamento e o arquivo dele? Use só para registro feito por engano — para pedido que perdeu a validade, prefira Cancelar.', 'Excluir'))) return;
        try {
          const { error: er } = await sb.from('encaminhamentos').delete().eq('id', en.id);
          if (er) throw er;
          if (en.arquivo) await removerArquivo(en.arquivo).catch(() => {});
          toast('Encaminhamento excluído.'); recarregar();
        } catch (e) { falha(e, 'Excluir'); }
      }));
      $$('[data-cancen]', alvo).forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Cancelar este encaminhamento?', 'Cancelar'))) return;
        const { error: er } = await sb.from('encaminhamentos').update({ status: 'cancelado' }).eq('id', b.dataset.cancen);
        if (er) return falha(er); recarregar();
      }));
      $('#s')?.addEventListener('click', async () => {
        const fd = new FormData($('#f')), f = Object.fromEntries(fd), arq = fd.get('arq');
        if (!f.data_pedido) return toast('Informe a data do pedido.', true);
        if (f.cid && !/^[A-Z][0-9]{2}(\.?[0-9A-Z]{0,2})?$/i.test(f.cid.trim())) return toast('CID em formato inválido (ex.: M54.5).', true);
        try {
          const up = arq && arq.size ? await enviarArquivo(arq, `pacientes/${id}/encaminhamentos`) : {};
          const { error: er } = await sb.from('encaminhamentos').insert({ clinica_id: cid, paciente_id: id, area: f.area,
            solicitante_id: f.solicitante_id || null, data_pedido: f.data_pedido, validade: f.validade || null,
            cid: f.cid.trim().toUpperCase() || null, indicacao_clinica: f.indicacao_clinica || null,
            qtd_sessoes: f.qtd_sessoes ? Number(f.qtd_sessoes) : null, ...up });
          if (er) throw er;
          toast(up.arquivo ? 'Encaminhamento registrado.' : 'Registrado sem arquivo: anexe o pedido antes do faturamento.'); recarregar();
        } catch (e) { falha(e, 'Registrar'); }
      });
    },

    async autorizacoes() {
      // Autorização (senha) com os agendamentos dela logo abaixo; status do atendimento + situação de faturamento da guia
      const usadas = {}; (ats || []).forEach((a) => a.autorizacao_id && a.status === 'atendido' && (usadas[a.autorizacao_id] = (usadas[a.autorizacao_id] || 0) + 1));
      const fin = {};
      const verFin = podeGerir();   // guia_itens: só gestão/financeiro (RLS)
      if (verFin && (ats || []).length) {
        const { data: its } = await sb.from('guia_itens').select('atendimento_id, guias(status)').in('atendimento_id', ats.map((a) => a.id));
        (its || []).forEach((g) => g.atendimento_id && g.guias && (fin[g.atendimento_id] = g.guias.status));
      }
      const linhaAt = (a) => { const f = FIN[fin[a.id]];
        return `<tr><td>${dh(a.inicio)}</td><td>${esc(a.servico || '—')}</td><td>${esc(a.profissionais?.nome || '')}</td><td>${esc(a.sala || '—')}</td>
          <td><span class="selo ${ST[a.status]}">${esc(a.status === 'atendido' ? 'realizado' : a.status)}</span></td>
          ${verFin ? `<td>${f ? `<span class="selo ${f[1]}">${f[0]}</span>` : a.status === 'atendido' && a.autorizacao_id ? '<span class="selo pendente">sem guia</span>' : '—'}</td>` : ''}</tr>`; };
      const tabAts = (lista, vazio) => lista.length ? `<table class="sub-ats"><thead><tr><th>Data</th><th>Serviço</th><th>Profissional</th><th>Sala</th><th>Atendimento</th>${verFin ? '<th>Faturamento</th>' : ''}</tr></thead>
        <tbody>${lista.map(linhaAt).join('')}</tbody></table>` : `<p class="muted">${vazio}</p>`;
      const atsDe = (aid) => (ats || []).filter((a) => a.autorizacao_id === aid).sort((x, y) => x.inicio.localeCompare(y.inicio));
      const semAut = (ats || []).filter((a) => !a.autorizacao_id).sort((x, y) => y.inicio.localeCompare(x.inicio));
      alvo.innerHTML = `<div class="cartao"><p class="muted">Cada autorização (senha) com os agendamentos ligados a ela. "Faturamento" vem da guia: a faturar → faturado (lote enviado) → pago ou glosado.</p>
        ${[...(auts || [])].sort((x, y) => (atsDe(x.id)[0]?.inicio || x.data_autorizacao || '').localeCompare(atsDe(y.id)[0]?.inicio || y.data_autorizacao || ''))
          .map((a) => { const u = usadas[a.id] || 0, venc = a.validade && a.validade < hojeIso(), lig = atsDe(a.id);
          const travada = lig.some((x) => x.status === 'atendido');
          return `<div class="aut-bloco" style="border:1px solid var(--borda,#ddd);border-radius:8px;padding:10px 12px;margin:10px 0">
            <div class="linha-acoes" style="justify-content:space-between;margin:0;flex-wrap:wrap">
              <div><strong>${a.status === 'pendente' ? '⏳ senha pendente' : 'Senha ' + esc(a.senha || '—')}</strong> · ${esc(a.paciente_planos?.contratos?.nome)} ·
                ${esc(a.procedimentos?.codigo)} ${esc((a.procedimentos?.descricao || '').slice(0, 60))}<br>
                <span class="muted">autorizada em ${data(a.data_autorizacao)} · validade ${a.validade ? data(a.validade) : '—'} ${venc ? '<span class="selo alerta">vencida</span>' : ''}
                · <strong>${u} / ${a.qtd_autorizada}</strong> usadas ${u >= a.qtd_autorizada ? '<span class="selo alerta">esgotada</span>' : ''}</span></div>
              <div>${celulaEnc(a)} ${gestao && !travada ? `<button class="btn pequeno escuro" data-excaut="${a.id}" title="Só sem atendimento realizado">Excluir</button>` : ''}</div>
            </div>${tabAts(lig, 'Nenhum agendamento ligado a esta autorização.')}</div>`; }).join('')
          || '<div class="vazio">Nenhuma autorização registrada.</div>'}
        <h3 style="margin-top:18px">Agendamentos sem autorização <span class="muted" style="font-weight:400">(particular ou convênio sem senha)</span></h3>
        ${tabAts(semAut, 'Nenhum.')}
        ${gestao && (planos || []).length ? `<h3 style="margin-top:16px">Registrar autorização</h3><form class="grade-form" id="f">
          <label>Convênio<select name="paciente_plano_id" id="pl">${planos.map((pl) => `<option value="${pl.id}" data-ct="${pl.contrato_id}">${esc(pl.contratos?.nome)}</option>`).join('')}</select></label>
          <label>Procedimento<select name="procedimento_id" id="proc"></select></label>
          <label>Área<select name="area" id="area">${opcoesArea('fisioterapia')}</select></label>
          <label>Encaminhamento<select name="encaminhamento_id" id="enc"></select></label>
          <label>Qtd. autorizada<input type="number" name="qtd" min="1" value="10"></label>
          <label>Senha<input name="senha"></label><label>Nº guia operadora<input name="guia"></label>
          <label>Data da autorização<input type="date" name="data" value="${hojeIso()}"></label><label>Validade<input type="date" name="validade"></label>
          </form><div class="linha-acoes"><button class="btn primario" id="s">Registrar</button></div>`
          : gestao ? '<div class="dica">Vincule um convênio na aba Cadastro e convênios para registrar autorizações.</div>' : ''}</div>`;
      const carregaProcs = async () => {
        const ct = $('#pl').selectedOptions[0].dataset.ct;
        const { data: itens } = await sb.from('contrato_tabela').select('procedimentos(id, codigo, descricao)').eq('contrato_id', ct).is('vigencia_fim', null);
        $('#proc').innerHTML = (itens || []).map((i) => `<option value="${i.procedimentos.id}">${esc(i.procedimentos.codigo)} · ${esc(i.procedimentos.descricao)}</option>`).join('');
      };
      if ($('#pl')) { $('#pl').onchange = carregaProcs; carregaProcs(); }
      const carregaEnc = () => { $('#enc').innerHTML = '<option value="">— sem encaminhamento —</option>' + opcoesEnc($('#area').value); };
      if ($('#area')) { $('#area').onchange = carregaEnc; carregaEnc(); }
      $$('[data-excaut]', alvo).forEach((b) => (b.onclick = async () => {
        const lig = atsDe(b.dataset.excaut).filter((x) => x.status !== 'cancelado');
        if (!(await confirmar(`Excluir esta autorização?${lig.length ? ` Os ${lig.length} agendamento(s) ligados continuam na agenda, mas ficam SEM autorização (convênio vai pedir de novo).` : ''}`, 'Excluir'))) return;
        const { error: e1 } = await sb.from('atendimentos').update({ autorizacao_id: null }).eq('autorizacao_id', b.dataset.excaut);
        if (e1) return falha(e1);
        const { error: er } = await sb.from('autorizacoes').delete().eq('id', b.dataset.excaut);
        if (er) return falha(er, er.code === '23503' ? 'Esta autorização já tem guia gerada — cancele a guia antes' : 'Excluir');
        toast('Autorização excluída.'); recarregar();
      }));
      $$('[data-vinc]', alvo).forEach((b) => (b.onclick = async () => {
        const sel = $(`select[data-encsel="${b.dataset.vinc}"]`, alvo);
        if (!sel.value) return toast('Escolha o encaminhamento.', true);
        const { data: rv, error: er } = await sb.rpc('vincular_encaminhamento', { p_autorizacao: b.dataset.vinc, p_encaminhamento: sel.value });
        if (er) return falha(er, 'Vincular');
        (rv?.avisos || []).forEach((m) => toast(m, true)); if (!(rv?.avisos || []).length) toast('Encaminhamento vinculado.');
        recarregar();
      }));
      $$('[data-desvinc]', alvo).forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Desvincular o encaminhamento desta autorização?', 'Desvincular'))) return;
        const { error: er } = await sb.rpc('vincular_encaminhamento', { p_autorizacao: b.dataset.desvinc, p_encaminhamento: null });
        if (er) return falha(er); recarregar();
      }));
      $('#s')?.addEventListener('click', async () => {
        const f = Object.fromEntries(new FormData($('#f')));
        if (!f.procedimento_id) return toast('Escolha o procedimento.', true);
        const { data: nova, error: er } = await sb.from('autorizacoes').insert({ clinica_id: cid, paciente_plano_id: f.paciente_plano_id, procedimento_id: f.procedimento_id,
          area: f.area, qtd_autorizada: Number(f.qtd), senha: f.senha || null, numero_guia_operadora: f.guia || null, data_autorizacao: f.data, validade: f.validade || null })
          .select('id').single();
        if (er) return falha(er);
        if (f.encaminhamento_id) {
          const { data: rv, error: e2 } = await sb.rpc('vincular_encaminhamento', { p_autorizacao: nova.id, p_encaminhamento: f.encaminhamento_id });
          if (e2) return falha(e2, 'Autorização salva, mas o vínculo falhou');
          (rv?.avisos || []).forEach((m) => toast(m, true));
        }
        toast(f.encaminhamento_id ? 'Autorização registrada e vinculada ao encaminhamento.' : 'Autorização registrada sem encaminhamento.'); recarregar();
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
        ${(gs || []).length ? `<table><thead><tr><th>Data</th><th>Guia</th><th>Contrato</th><th>Status</th><th class="num">Valor</th><th class="num">Glosa</th><th></th></tr></thead><tbody>
          ${gs.map((g) => `<tr><td>${data(g.data_atendimento)}</td><td>${esc(g.numero_guia_prestador)}</td><td>${esc(g.contratos?.nome)}</td><td>${esc(g.status)}</td>
            <td class="num">${brl(g.guia_itens.reduce((s, i) => s + Number(i.valor_informado), 0))}</td>
            <td class="num">${brl(g.guia_itens.reduce((s, i) => s + Number(i.valor_glosa), 0))}</td>
            <td style="white-space:nowrap"><button class="btn pequeno" data-impg="${g.id}">Imprimir</button>
              ${['rascunho', 'pronta'].includes(g.status) ? `<button class="btn pequeno" data-cancg="${g.id}">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<div class="vazio">Nenhuma guia ainda. Elas são geradas na Agenda, ao marcar o atendimento como Atendido.</div>'}</div>
        <div class="cartao"><h3>Histórico nos retornos das operadoras</h3>
        ${(rls || []).length ? `<p class="muted">${rls.length} itens encontrados pela carteirinha · ${glosadas.length} glosados (${brl(glosadas.reduce((s, l) => s + Number(l.valor_glosa), 0))})</p>
          <table><thead><tr><th>Data</th><th>Guia</th><th>Procedimento</th><th class="num">Informado</th><th class="num">Glosa</th><th>Motivo</th></tr></thead><tbody>
          ${rls.map((l) => `<tr><td>${data(l.data_realizacao)}</td><td>${esc(l.numero_guia_prestador)}</td><td>${esc(l.codigo_procedimento || 'guia')}</td>
            <td class="num">${brl(l.valor_informado)}</td><td class="num">${Number(l.valor_glosa) ? `<strong>${brl(l.valor_glosa)}</strong>` : '—'}</td>
            <td>${l.codigo_glosa ? `${esc(l.codigo_glosa)} ${esc((desc[l.codigo_glosa] || '').slice(0, 50))}` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<div class="vazio">Nenhum item nos retornos importados para a carteirinha deste paciente.</div>'}</div>`;
      $$('[data-impg]', alvo).forEach((b) => (b.onclick = () => imprimirGuia(b.dataset.impg)));
      $$('[data-cancg]', alvo).forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Cancelar esta guia? Ela não será enviada no lote.', 'Cancelar guia'))) return;
        const { error: e } = await sb.rpc('cancelar_guia', { p_guia: b.dataset.cancg });
        if (e) return falha(e); toast('Guia cancelada.'); abas.guias();
      }));
    },

    prontuario() { return abaProntuario(alvo, p, ats, abaExtra); },
    documentos() { return abaDocumentos(alvo, p, ats); },
  };

  // Cadastro rápido do médico do pedido (vai na guia SP/SADT: conselho, número, UF e CBO)
  function novoSolicitante() {
    modal(`<h3>Novo médico solicitante</h3><form class="grade-form" id="fs">
      <label style="grid-column:1/-1">Nome<input name="nome" required></label>
      <label>Conselho<select name="conselho">${['CRM', 'CRO', 'CREFITO', 'CRN', 'CRP', 'COREN', 'CRFA'].map((k) => `<option>${k}</option>`).join('')}</select></label>
      <label>Número<input name="numero_conselho" required inputmode="numeric"></label>
      <label>UF<input name="uf_conselho" value="SC" maxlength="2" required></label>
      <label>CBO<input name="cbo" value="225125" maxlength="6" title="225125 = médico clínico; especialistas têm CBO próprio (ex.: 225270 ortopedista)"></label>
      </form><p class="muted">CBO 225125 = médico clínico. Ortopedista 225270, neurologista 225112, psiquiatra 225133.</p>
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Salvar</button></div>`, (m, fechar) => {
      $('#ok', m).onclick = async () => {
        const f = Object.fromEntries(new FormData($('#fs', m)));
        if (!f.nome.trim() || !f.numero_conselho.trim()) return toast('Informe nome e número do conselho.', true);
        if (!/^\d{6}$/.test(f.cbo)) return toast('CBO deve ter 6 dígitos.', true);
        const { data: ex } = await sb.from('solicitantes').select('id').eq('clinica_id', cid).eq('conselho', f.conselho)
          .eq('numero_conselho', f.numero_conselho.trim()).eq('uf_conselho', f.uf_conselho.toUpperCase()).maybeSingle();
        let sid = ex?.id;
        if (!sid) {
          const { data: novo, error: er } = await sb.from('solicitantes').insert({ clinica_id: cid, nome: f.nome.trim(), conselho: f.conselho,
            numero_conselho: f.numero_conselho.trim(), uf_conselho: f.uf_conselho.toUpperCase(), cbo: f.cbo }).select('id, nome, conselho, numero_conselho').single();
          if (er) return falha(er, 'Salvar médico');
          sid = novo.id; sols.push(novo);
        } else toast('Este médico já estava cadastrado: selecionado.');
        const sel = $('#sol');
        if (sel && !sel.querySelector(`option[value="${sid}"]`)) sel.insertAdjacentHTML('beforeend', `<option value="${sid}">${esc(f.nome.trim())} · ${esc(f.conselho)} ${esc(f.numero_conselho.trim())}</option>`);
        if (sel) sel.value = sid;
        fechar();
      };
    });
  }

  function opcoesEnc(area) {
    return (encs || []).filter((en) => en.status === 'ativo' && (!area || en.area === area))
      .map((en) => `<option value="${en.id}">${esc(AREAS[en.area])} · ${data(en.data_pedido)}${en.cid ? ' · ' + esc(en.cid) : ''}${en.validade && en.validade < hojeIso() ? ' (vencido)' : ''}</option>`).join('');
  }
  function celulaEnc(a) {
    const en = (encs || []).find((x) => x.id === a.encaminhamento_id);
    if (en) return `<span class="selo ok">✓ ${esc(AREAS[en.area])} · ${data(en.data_pedido)}</span>${en.arquivo ? '' : ' <span class="selo alerta">sem arquivo</span>'}
      ${gestao ? ` <button class="btn pequeno" data-desvinc="${a.id}">Desvincular</button>` : ''}`;
    if (!gestao) return '<span class="selo alerta">sem encaminhamento</span>';
    const ops = opcoesEnc(a.area);
    return ops ? `<select data-encsel="${a.id}" style="max-width:220px">${ops}</select> <button class="btn pequeno" data-vinc="${a.id}">Vincular</button>`
      : `<span class="selo alerta">sem encaminhamento${a.area ? ' de ' + esc(AREAS[a.area]) : ''}</span>`;
  }

  function listaAts(lista) {
    return lista.length ? `<table><thead><tr><th>Data</th><th>Serviço</th><th>Profissional</th><th>Status</th></tr></thead><tbody>
      ${lista.map((a) => `<tr><td>${dh(a.inicio)}</td><td>${esc(a.servico || '—')}</td><td>${esc(a.profissionais?.nome)}</td>
        <td><span class="selo ${ST[a.status]}">${esc(a.status)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhum atendimento.</div>';
  }

  await (abas[abaUrl] || abas.resumo)();
}
