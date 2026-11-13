// Módulo Ficha do paciente: tudo que se liga ao paciente num lugar só.
// Abas: Resumo · Cadastro (dados, convênio, encaminhamentos) · Autorizações e guias · Prontuário · Documentos
import { sb, estado, $, $$, esc, brl, data, tela, toast, falha, modal, confirmar, podeGerir,
  foneFmt, foneDig, foneValido, mascaraFone, soNumeros, descricaoCid, normCid } from '../core.js';
import { enviarArquivo, abrirArquivo, escolherArquivo, removerArquivo, ACEITA } from './documentos.js';
import { imprimirGuia } from './guia-impressa.js';
import { abaProntuario } from './prontuario.js';
import { abaDocumentos } from './emissao.js';
import { registrarPagamento, seloPagamento, excluirPagamento, fazerNota } from './particular.js';

const ABAS = [['resumo', 'Resumo'], ['cadastro', 'Cadastro e encaminhamentos'], ['autorizacoes', 'Autorizações e guias'],
  ['prontuario', 'Prontuário'], ['documentos', 'Documentos']];
const ALIAS = { dados: 'cadastro', convenios: 'cadastro', encaminhamentos: 'cadastro', atendimentos: 'autorizacoes', guias: 'autorizacoes' };   // links antigos continuam valendo
// Situação de faturamento do atendimento, pela guia em que ele entrou
const FIN = { rascunho: ['a faturar', 'pendente'], pronta: ['a faturar', 'pendente'], enviada: ['faturado', 'clinica'], paga: ['pago', 'ok'],
  glosa_parcial: ['glosa parcial', 'alerta'], glosa_total: ['glosado', 'alerta'], cancelada: ['guia cancelada', 'outra'] };
const ST = { agendado: 'pendente', confirmado: 'pendente', presente: 'pendente', atendido: 'ok', faltou: 'alerta', cancelado: 'outra' };
const AREAS = { fisioterapia: 'Fisioterapia', nutricao: 'Nutrição', psicologia: 'Psicologia', palmilha: 'Palmilha / podologia', outra: 'Outra' };
const opcoesArea = (sel) => Object.entries(AREAS).map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');
const hojeIso = () => new Date().toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
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
    sb.from('paciente_planos').select('*, contratos(id, nome, regras)').eq('paciente_id', id).order('principal', { ascending: false }),
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
      <div><span class="muted">${[idade != null ? idade + ' anos' : null, p.sexo, p.celular && foneFmt(p.celular), p.telefone && foneFmt(p.telefone)].filter(Boolean).map(esc).join(' · ') || 'Sem dados básicos'}</span>
        ${(planos || []).map((pl) => `<span class="selo clinica">${esc(pl.contratos?.nome)} · ${esc(pl.carteirinha)}</span>`).join(' ')
          || (x.convenio_origem ? `<span class="selo outra">Sistema antigo: ${esc(x.convenio_origem)}</span>` : '')}</div>
      ${p.alerta ? `<div class="alerta-paciente">⚠️ <strong>Alerta:</strong> ${esc(p.alerta)}</div>` : ''}
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
      alvo.innerHTML = '<div id="sub-dados"></div><div id="sub-conv"></div><div id="sub-enc"></div>';
      abas.dados($('#sub-dados')); abas.convenios($('#sub-conv')); abas.encaminhamentos($('#sub-enc'));
    },

    dados(t = alvo) {
      t.innerHTML = `<div class="cartao"><div class="linha-acoes" style="justify-content:space-between;margin:0 0 10px"><h3>Dados do paciente</h3>
          ${gestao ? '<button class="btn pequeno" id="boasvindas" title="Mensagem de boas-vindas com as combinações da clínica">✉ Boas-vindas</button>' : ''}</div>
        <form class="form-dados" id="fdados">
        <label class="c5">Nome<input name="nome" required value="${esc(p.nome)}"></label>
        <label class="c3">Nome social<input name="nome_social" value="${esc(p.nome_social)}"></label>
        <label class="c2">CPF<input name="cpf" value="${esc(p.cpf)}"></label>
        <label class="c2">Nascimento<input type="date" name="data_nascimento" value="${esc(p.data_nascimento)}"></label>
        <label class="c1">Sexo<select name="sexo"><option value=""></option><option ${p.sexo === 'F' ? 'selected' : ''}>F</option><option ${p.sexo === 'M' ? 'selected' : ''}>M</option></select></label>
        <label class="c7">Nome da mãe<input name="nome_mae" value="${esc(p.nome_mae)}"></label>
        <label class="c4">CNS (cartão SUS)<input name="cns" value="${esc(p.cns)}"></label>
        <div class="c12 sep-form">Contato e endereço</div>
        <label class="c3">Celular (WhatsApp)<input name="celular" value="${esc(p.celular)}"></label>
        <label class="c3">Telefone fixo<input name="telefone" value="${esc(p.telefone)}"></label>
        <label class="c6">E-mail<input name="email" value="${esc(p.email)}"></label>
        <label class="c6">Rua<input name="rua" value="${esc(e.rua)}"></label>
        <label class="c2">CEP<input name="cep" value="${esc(e.cep)}"></label>
        <label class="c3">Cidade<input name="cidade" value="${esc(e.cidade)}"></label>
        <label class="c1">UF<input name="uf" maxlength="2" value="${esc(e.uf)}"></label>
        <label class="c12">Observações<textarea name="observacao" rows="2" placeholder="Preferências, horários, combinações…">${esc(p.observacao)}</textarea></label>
        <div class="c12 icones-dados">
          <label class="icone-check" title="Recebe mensagens de relacionamento (aniversário, reavaliação)${p.comunicacao_optout_em ? ` — pediu para sair em ${data(p.comunicacao_optout_em.slice(0, 10))}` : ''}">
            <input type="checkbox" name="consentimento_comunicacao" ${p.consentimento_comunicacao ? 'checked' : ''}> 💬 Mensagens</label>
          <label class="icone-check" title="Paciente ativo (aparece nas buscas e na agenda)"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> ✓ Ativo</label>
          ${gestao ? `<button type="button" class="icone-check ${p.alerta ? 'com-alerta' : ''}" id="ed-alerta" title="${p.alerta ? 'Alerta: ' + esc(p.alerta) : 'Adicionar alerta interno (aparece na ficha e na agenda)'}">⚠️ ${p.alerta ? 'Alerta ativo' : 'Alerta'}</button>` : ''}
          ${gestao ? '<button type="button" class="btn primario" id="sdados" style="margin-left:auto">Salvar dados</button>' : ''}
        </div>
      </form></div>`;
      const fm = $('#fdados', t);
      mascaraFone(fm.celular); mascaraFone(fm.telefone); soNumeros(fm.cns);
      $('#sdados')?.addEventListener('click', async () => {
        const fd = new FormData(fm), f = Object.fromEntries(fd);
        if (!f.nome.trim()) return toast('Informe o nome.', true);
        // Telefone antigo sem DDD continua aceito enquanto não for alterado; número novo/alterado precisa de DDD.
        const fone = (campo, cel) => { const novo = foneDig(f[campo]); if (!f[campo].trim()) return null;
          if (novo === foneDig(p[campo]) || foneValido(f[campo], cel)) return foneValido(f[campo], cel) ? novo : p[campo]; throw new Error(cel ? 'Celular: informe DDD + 9 dígitos.' : 'Telefone: informe DDD + número.'); };
        let celular, telefone;
        try { celular = fone('celular', true); telefone = fone('telefone', false); } catch (er) { return toast(er.message, true); }
        const { error: er } = await sb.from('pacientes').update({ nome: f.nome.trim(), nome_social: f.nome_social || null, cpf: f.cpf.replace(/\D/g, '') || null,
          data_nascimento: f.data_nascimento || null, sexo: f.sexo || null, nome_mae: f.nome_mae || null, cns: f.cns.replace(/\D/g, '') || null,
          celular, telefone, email: f.email || null, observacao: f.observacao.trim() || null, consentimento_comunicacao: fd.has('consentimento_comunicacao'), ativo: fd.has('ativo'),
          comunicacao_optout_em: fd.has('consentimento_comunicacao') ? null : (p.comunicacao_optout_em || new Date().toISOString()),
          endereco: { ...e, rua: f.rua, cep: f.cep, cidade: f.cidade, uf: f.uf.toUpperCase() } }).eq('id', id);
        if (er) return falha(er, er.code === '23505' ? 'CPF já cadastrado em outro paciente' : 'Salvar'); toast('Salvo.'); recarregar();
      });
      $('#boasvindas', t)?.addEventListener('click', boasVindas);
      // Alerta interno: só um ícone; abre uma caixinha para escrever, salva direto
      $('#ed-alerta', t)?.addEventListener('click', () => modal(`<h3>⚠️ Alerta interno</h3>
        <p class="muted">Aparece em destaque na ficha e quando o paciente é escolhido na agenda. Escreva só fatos objetivos (o paciente pode pedir acesso ao cadastro).</p>
        <textarea id="txal" rows="4" style="width:100%" placeholder="Ex.: não reagendar — decisão da gestão em 10/2026.">${esc(p.alerta)}</textarea>
        <div class="linha-acoes">${p.alerta ? '<button class="btn" id="rmal">Remover alerta</button>' : ''}<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="okal">Salvar</button></div>`, (m, fechar) => {
        const grava = async (v) => { const { error: er } = await sb.from('pacientes').update({ alerta: v }).eq('id', id); if (er) return falha(er, 'Alerta'); fechar(); toast(v ? 'Alerta salvo.' : 'Alerta removido.'); recarregar(); };
        $('#okal', m).onclick = () => grava($('#txal', m).value.trim() || null);
        $('#rmal', m) && ($('#rmal', m).onclick = () => grava(null));
      }));
    },

    convenios(t = alvo) {
      const formConv = (pl = {}) => `<form class="grade-form" id="fconv">
          <label>Contrato<select name="contrato_id">${contratos.map((k) => `<option value="${k.id}" ${(pl.contrato_id ? pl.contrato_id === k.id : sugere(k.nome)) ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></label>
          <label>Plano<input name="plano_nome" placeholder="ex.: Executivo, Rede 843" value="${esc(pl.plano_nome)}"></label>
          <label>Carteirinha (só números)<input name="carteirinha" required value="${esc((pl.carteirinha ?? x.carteirinha_origem ?? '').replace(/\D/g, ''))}"></label>
          <label>Validade<input type="date" name="validade" value="${esc(pl.validade)}"></label>
          <label><span><input type="checkbox" name="principal" ${(pl.id ? pl.principal : !(planos || []).length) ? 'checked' : ''}> Principal</span></label></form>`;
      t.innerHTML = `<div class="cartao"><div class="linha-acoes" style="justify-content:space-between;margin:0 0 8px"><h3>Convênio</h3>
          ${gestao ? '<button class="btn pequeno" id="abrir-conv">+ Vincular convênio</button>' : ''}</div>
        ${x.convenio_origem && !(planos || []).length ? `<div class="dica">No sistema antigo: <strong>${esc(x.convenio_origem)}</strong>${x.carteirinha_origem ? ` · carteirinha ${esc(x.carteirinha_origem)}` : ''}</div>` : ''}
        <table><thead><tr><th>Contrato</th><th>Plano</th><th>Carteirinha</th><th>Validade</th><th>Principal</th><th></th></tr></thead><tbody>
        ${(planos || []).map((pl) => `<tr><td>${esc(pl.contratos?.nome)}</td><td>${esc(pl.plano_nome || '—')}</td><td>${esc(pl.carteirinha)}</td>
          <td>${pl.validade ? `${data(pl.validade)}${pl.validade < hojeIso() ? ' <span class="selo alerta">vencida</span>' : ''}` : '—'}</td>
          <td>${pl.principal ? '✓' : ''}</td><td style="white-space:nowrap">${gestao ? `<button class="btn pequeno" data-edconv="${pl.id}">Editar</button> <button class="btn pequeno" data-del="${pl.id}">Remover</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="6" class="vazio">Nenhum convênio vinculado.</td></tr>'}</tbody></table>
        <div id="novo-conv" hidden><h3 style="margin-top:14px">Vincular convênio</h3>${gestao ? formConv() : ''}
          <div class="linha-acoes"><button class="btn" id="fechar-conv">Cancelar</button><button class="btn primario" id="sconv">Vincular</button></div></div></div>`;
      function sugere(nome) {
        const o = (x.convenio_origem || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0];
        return o && nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(o.replace('correios', 'postal'));
      }
      const caixa = $('#novo-conv', t);
      $('#abrir-conv', t)?.addEventListener('click', () => { caixa.hidden = !caixa.hidden; if (!caixa.hidden) soNumeros($('#fconv', t).carteirinha); });
      $('#fechar-conv', t)?.addEventListener('click', () => (caixa.hidden = true));
      const salvaConv = async (form, plId) => {
        const fd = new FormData(form), f = Object.fromEntries(fd), cart = f.carteirinha.replace(/\D/g, '');
        if (!cart) { toast('Informe a carteirinha (só números).', true); return false; }
        if (fd.has('principal')) await sb.from('paciente_planos').update({ principal: false }).eq('paciente_id', id).neq('id', plId || '00000000-0000-0000-0000-000000000000');
        const reg = { contrato_id: f.contrato_id, plano_nome: f.plano_nome || null, carteirinha: cart, validade: f.validade || null, principal: fd.has('principal') };
        const { error: er } = plId ? await sb.from('paciente_planos').update(reg).eq('id', plId)
          : await sb.from('paciente_planos').insert({ ...reg, clinica_id: cid, paciente_id: id });
        if (er) { falha(er); return false; } return true;
      };
      $('#sconv', t)?.addEventListener('click', async () => { if (await salvaConv($('#fconv', t))) { toast('Convênio vinculado.'); recarregar(); } });
      $$('[data-edconv]', t).forEach((b) => (b.onclick = () => {
        const pl = planos.find((k) => k.id === b.dataset.edconv);
        modal(`<h3>Editar convênio</h3>${formConv(pl)}<p class="muted">Guias já emitidas mantêm os dados com que foram geradas.</p>
          <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Salvar</button></div>`, (m, fechar) => {
          soNumeros($('#fconv', m).carteirinha);
          $('#ok', m).onclick = async () => { if (await salvaConv($('#fconv', m), pl.id)) { fechar(); toast('Convênio atualizado.'); recarregar(); } };
        });
      }));
      $$('[data-del]', t).forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Remover este vínculo? Guias já emitidas não são afetadas.', 'Remover'))) return;
        const { error: er } = await sb.from('paciente_planos').delete().eq('id', b.dataset.del);
        if (er) return falha(er, er.code === '23503' ? 'Há guias ou autorizações usando este convênio — use Editar' : ''); recarregar();
      }));
    },

    encaminhamentos(t = alvo) {
      const vinc = {}; (auts || []).forEach((a) => a.encaminhamento_id && (vinc[a.encaminhamento_id] ||= []).push(a));
      const usadasDe = (a) => (ats || []).filter((x) => x.autorizacao_id === a.id && x.status === 'atendido').length;
      const optsSol = (sel) => `<option value="">—</option>${(sols || []).map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.nome)} · ${esc(s.conselho)} ${esc(s.numero_conselho)}</option>`).join('')}`;
      const linha = (en) => {
        const venc = en.validade && en.validade < hojeIso(), lig = vinc[en.id] || [];
        const usadas = lig.reduce((s, a) => s + usadasDe(a), 0);
        return `<tr class="${en.status === 'cancelado' ? 'muted' : ''}"><td><span class="selo clinica">${esc(AREAS[en.area])}</span></td>
          <td>${data(en.data_pedido)}</td><td>${en.validade ? data(en.validade) : '—'} ${venc ? '<span class="selo alerta">vencido</span>' : ''}</td>
          <td>${esc(en.solicitantes ? `${en.solicitantes.nome} (${en.solicitantes.conselho} ${en.solicitantes.numero_conselho})` : '—')}</td>
          <td title="${esc(en.indicacao_clinica || '')}">${esc(en.cid || '—')}</td>
          <td class="num">${usadas}${en.qtd_sessoes ? ' / ' + en.qtd_sessoes : ''}</td>
          <td>${lig.length ? `<span class="selo ok">✓ ${lig.map((a) => esc(a.senha || 'sem senha')).join(', ')}</span>` : '<span class="selo pendente">sem autorização</span>'}</td>
          <td style="white-space:nowrap">${en.arquivo ? `<button class="btn pequeno" data-abrir="${esc(en.arquivo)}">Ver pedido</button>` : '<span class="selo alerta">sem arquivo</span>'}
            ${gestao ? ` <button class="btn pequeno" data-eden="${en.id}">Editar</button> <button class="btn pequeno escuro" data-excen="${en.id}">Excluir</button>` : ''}</td></tr>`;
      };
      // Formulário compacto (registrar e editar usam o mesmo)
      const formEnc = (en = {}) => `<form class="form-linha" id="fenc">
          <label>Área<select name="area">${opcoesArea(en.area || 'fisioterapia')}</select></label>
          <label class="larga">Solicitante <a href="#" class="novo-sol" style="font-weight:400">+ novo</a><select name="solicitante_id" class="sol">${optsSol(en.solicitante_id)}</select></label>
          <label>Pedido em<input type="date" name="data_pedido" value="${esc(en.data_pedido || hojeIso())}" required></label>
          <label>Validade<input type="date" name="validade" value="${esc(en.validade || somaDias(en.data_pedido || hojeIso(), 180))}"></label>
          <label class="estreita">CID<input name="cid" placeholder="M54.2" value="${esc(en.cid)}"></label>
          <label class="estreita">Sessões<input type="number" name="qtd_sessoes" min="1" value="${esc(en.qtd_sessoes)}"></label>
          <label class="larga2">Indicação clínica<input name="indicacao_clinica" value="${esc(en.indicacao_clinica)}" data-auto="${en.indicacao_clinica ? '' : '1'}"></label>
          <label class="larga">${en.id ? 'Trocar arquivo' : 'Arquivo do pedido'}<input type="file" name="arq" accept="${ACEITA}"></label></form>`;
      const ligaForm = (raiz) => {
        const fm = $('#fenc', raiz);
        $('.novo-sol', raiz).onclick = (ev) => { ev.preventDefault(); novoSolicitante($('.sol', raiz)); };
        // Validade = pedido + 180 dias enquanto não for editada à mão
        let validadeManual = false;
        fm.validade.addEventListener('input', () => (validadeManual = true));
        fm.data_pedido.addEventListener('change', () => { if (!validadeManual && fm.data_pedido.value) fm.validade.value = somaDias(fm.data_pedido.value, 180); });
        // CID → indicação clínica automática (editável; não sobrescreve texto digitado à mão)
        const dica = document.createElement('small'); dica.className = 'muted'; fm.cid.after(dica);
        fm.indicacao_clinica.addEventListener('input', () => (fm.indicacao_clinica.dataset.auto = ''));
        const atualizaCid = async () => {
          if (!fm.cid.value.trim()) { dica.textContent = ''; return; }
          fm.cid.value = normCid(fm.cid.value);
          const d = await descricaoCid(fm.cid.value);
          dica.textContent = d || 'CID não encontrado';
          if (d && (fm.indicacao_clinica.dataset.auto || !fm.indicacao_clinica.value)) { fm.indicacao_clinica.value = `${fm.cid.value} ${d}`; fm.indicacao_clinica.dataset.auto = '1'; }
        };
        fm.cid.addEventListener('change', atualizaCid);
        if (fm.cid.value) descricaoCid(fm.cid.value).then((d) => (dica.textContent = d));
        return fm;
      };
      const salvaEnc = async (fm, en) => {
        const fd = new FormData(fm), f = Object.fromEntries(fd), arq = fd.get('arq');
        if (!f.data_pedido) { toast('Informe a data do pedido.', true); return false; }
        const cidN = normCid(f.cid);
        if (cidN && !/^[A-Z][0-9]{2}(\.[0-9A-Z])?$/.test(cidN)) { toast('CID em formato inválido (ex.: M54.2).', true); return false; }
        try {
          const up = arq && arq.size ? await enviarArquivo(arq, `pacientes/${id}/encaminhamentos`) : {};
          const reg = { area: f.area, solicitante_id: f.solicitante_id || null, data_pedido: f.data_pedido, validade: f.validade || null,
            cid: cidN || null, indicacao_clinica: f.indicacao_clinica.trim() || null, qtd_sessoes: f.qtd_sessoes ? Number(f.qtd_sessoes) : null, ...up };
          const { error: er } = en ? await sb.from('encaminhamentos').update(reg).eq('id', en.id)
            : await sb.from('encaminhamentos').insert({ ...reg, clinica_id: cid, paciente_id: id });
          if (er) throw er;
          if (en && up.arquivo && en.arquivo) await removerArquivo(en.arquivo).catch(() => {});   // o antigo sai só depois do novo gravado
          toast(en ? 'Encaminhamento atualizado.' : up.arquivo ? 'Encaminhamento registrado.' : 'Registrado sem arquivo: anexe o pedido antes do faturamento.');
          return true;
        } catch (e) { falha(e, en ? 'Editar' : 'Registrar'); return false; }
      };

      t.innerHTML = `<div class="cartao tabela-rolagem"><div class="linha-acoes" style="justify-content:space-between;margin:0 0 8px"><h3>Encaminhamentos (pedidos médicos)</h3>
          ${gestao ? '<button class="btn pequeno" id="abrir-enc">+ Registrar encaminhamento</button>' : ''}</div>
        ${gestao ? `<div id="novo-enc" class="caixa-form" hidden>${formEnc()}<div class="linha-acoes"><button class="btn" id="fechar-enc">Cancelar</button><button class="btn primario" id="senc">Registrar</button></div></div>` : ''}
        <table><thead><tr><th>Área</th><th>Pedido em</th><th>Validade</th><th>Solicitante</th><th>CID</th><th class="num">Feitas / pedidas</th>
          <th>Autorização</th><th></th></tr></thead><tbody>
        ${(encs || []).map(linha).join('') || '<tr><td colspan="8" class="vazio">Nenhum encaminhamento registrado.</td></tr>'}</tbody></table></div>`;

      $$('[data-abrir]', t).forEach((b) => (b.onclick = () => abrirArquivo(b.dataset.abrir)));
      if (gestao) {
        const caixa = $('#novo-enc', t); let ligado = false;
        $('#abrir-enc', t).onclick = () => { caixa.hidden = !caixa.hidden; if (!ligado) { ligaForm(caixa); ligado = true; } };
        $('#fechar-enc', t).onclick = () => (caixa.hidden = true);
        $('#senc', t).onclick = async () => { if (await salvaEnc($('#fenc', caixa))) recarregar(); };
      }
      $$('[data-eden]', t).forEach((b) => (b.onclick = () => {
        const en = encs.find((k) => k.id === b.dataset.eden);
        modal(`<h3>Editar encaminhamento</h3>${formEnc(en)}
          <label style="margin-top:8px"><span><input type="checkbox" id="canc" ${en.status === 'cancelado' ? 'checked' : ''}> Cancelado (pedido não será mais usado)</span></label>
          ${en.arquivo ? '<p class="muted">Para remover o arquivo sem trocar, use "Remover arquivo".</p>' : ''}
          <div class="linha-acoes">${en.arquivo ? '<button class="btn" id="rmarq">Remover arquivo</button>' : ''}<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Salvar</button></div>`, (m, fechar) => {
          const fm = ligaForm(m);
          $('#ok', m).onclick = async () => {
            const canc = $('#canc', m).checked;
            if (!(await salvaEnc(fm, en))) return;
            if ((en.status === 'cancelado') !== canc) await sb.from('encaminhamentos').update({ status: canc ? 'cancelado' : 'ativo' }).eq('id', en.id);
            fechar(); recarregar();
          };
          $('#rmarq', m) && ($('#rmarq', m).onclick = async () => {
            try {
              const { error: er } = await sb.from('encaminhamentos').update({ arquivo: null, arquivo_nome: null }).eq('id', en.id);
              if (er) throw er; await removerArquivo(en.arquivo); fechar(); toast('Arquivo removido.'); recarregar();
            } catch (e) { falha(e, 'Remover arquivo'); }
          });
        });
      }));
      $$('[data-excen]', t).forEach((b) => (b.onclick = async () => {
        const en = (encs || []).find((k) => k.id === b.dataset.excen), lig = vinc[en.id] || [];
        if (!(await confirmar(`Excluir este encaminhamento e o arquivo dele?${lig.length ? ` Ele está ligado a ${lig.length} autorização(ões): elas ficam sem encaminhamento.` : ''} Use para registro feito por engano.`, 'Excluir'))) return;
        try {
          if (lig.length) { const { error: e1 } = await sb.from('autorizacoes').update({ encaminhamento_id: null }).eq('encaminhamento_id', en.id); if (e1) throw e1; }
          const { error: er } = await sb.from('encaminhamentos').delete().eq('id', en.id);
          if (er) throw er;
          if (en.arquivo) await removerArquivo(en.arquivo).catch(() => {});
          toast('Encaminhamento excluído.'); recarregar();
        } catch (e) { falha(e, 'Excluir'); }
      }));
    },

    async autorizacoes() {
      // Autorização (senha) + agendamentos + guias geradas, num bloco só, com filtro e ordenação.
      const usadas = {}; (ats || []).forEach((a) => a.autorizacao_id && a.status === 'atendido' && (usadas[a.autorizacao_id] = (usadas[a.autorizacao_id] || 0) + 1));
      const fin = {}, verFin = podeGerir();   // guias/guia_itens: só gestão/financeiro (RLS)
      let gs = [], rls = [], desc = {};
      if (verFin) {
        const carts = [...new Set([...(planos || []).map((pl) => pl.carteirinha), x.carteirinha_origem].filter(Boolean).map((k) => k.replace(/\D/g, '')))];
        const [r1, r2, r3, r4] = await Promise.all([
          (ats || []).length ? sb.from('guia_itens').select('atendimento_id, guias(status)').in('atendimento_id', ats.map((a) => a.id)) : Promise.resolve({ data: [] }),
          sb.from('guias').select('id, autorizacao_id, numero_guia_prestador, data_atendimento, status, lote_id, liberada_em, segurada, contratos(nome), guia_itens(valor_informado, valor_glosa)')
            .in('paciente_plano_id', (planos || []).map((pl) => pl.id).concat(['00000000-0000-0000-0000-000000000000'])).order('data_atendimento', { ascending: false }),
          carts.length ? sb.from('retorno_linhas').select('numero_guia_prestador, data_realizacao, codigo_procedimento, valor_informado, valor_glosa, codigo_glosa')
            .eq('clinica_id', cid).in('carteirinha', carts).order('data_realizacao', { ascending: false }) : Promise.resolve({ data: [] }),
          sb.from('motivos_glosa').select('codigo, descricao'),
        ]);
        (r1.data || []).forEach((g) => g.atendimento_id && g.guias && (fin[g.atendimento_id] = g.guias.status));
        gs = r2.data || []; rls = r3.data || []; desc = Object.fromEntries((r4.data || []).map((m) => [m.codigo, m.descricao]));
      }
      const { data: recs } = await sb.from('recebimentos').select('*').eq('paciente_id', id);
      const recDe = {}; (recs || []).forEach((r) => r.atendimento_id && (recDe[r.atendimento_id] = r));
      const linhaAt = (a) => { const f = FIN[fin[a.id]];
        if (!a.paciente_plano_id) {   // particular: pagamento + NF no lugar do faturamento do convênio
          const r = recDe[a.id], pode = a.status !== 'cancelado' && (gestao || a.profissional_id === estado.profissionalId);
          return `<tr><td>${dh(a.inicio)}</td><td>${esc(a.servico || '—')}</td><td>${esc(a.profissionais?.nome || '')}</td><td>${esc(a.sala || '—')}</td>
            <td><span class="selo ${ST[a.status]}">${esc(a.status === 'atendido' ? 'realizado' : a.status)}</span></td>
            <td>${a.status === 'cancelado' ? '—' : seloPagamento(r)} ${pode ? `<span style="white-space:nowrap"><button class="btn pequeno ${r ? '' : 'primario'}" data-pgto="${a.id}">${r ? 'Editar' : 'Registrar pagamento'}</button>${r ? `
              <button class="btn pequeno" data-nota="${a.id}">📄 Nota</button> <button class="btn pequeno escuro" data-delpg="${a.id}">Excluir</button>` : ''}</span>` : ''}</td></tr>`; }
        return `<tr><td>${dh(a.inicio)}</td><td>${esc(a.servico || '—')}</td><td>${esc(a.profissionais?.nome || '')}</td><td>${esc(a.sala || '—')}</td>
          <td><span class="selo ${ST[a.status]}">${esc(a.status === 'atendido' ? 'realizado' : a.status)}</span></td>
          <td>${verFin ? (f ? `<span class="selo ${f[1]}">${f[0]}</span>` : a.status === 'atendido' && a.autorizacao_id ? '<span class="selo pendente">sem guia</span>' : '—') : ''}</td></tr>`; };
      const tabAts = (lista, vazio) => lista.length ? `<table class="sub-ats"><thead><tr><th>Data</th><th>Serviço</th><th>Profissional</th><th>Sala</th><th>Atendimento</th><th>${verFin ? 'Faturamento / pagamento' : 'Pagamento'}</th></tr></thead>
        <tbody>${lista.map(linhaAt).join('')}</tbody></table>` : `<p class="muted" style="margin:6px 0 0">${vazio}</p>`;
      const atsDe = (aid) => (ats || []).filter((a) => a.autorizacao_id === aid).sort((k, y) => k.inicio.localeCompare(y.inicio));
      const semAut = (ats || []).filter((a) => !a.autorizacao_id).sort((k, y) => y.inicio.localeCompare(k.inicio));
      const guiasDe = (aid) => gs.filter((g) => g.autorizacao_id === aid);
      const tabGuias = (lista) => !lista.length ? '' : `<table class="sub-ats"><thead><tr><th>Guia</th><th>Atendimento</th><th>Situação</th><th class="num">Valor</th><th class="num">Glosa</th><th></th></tr></thead><tbody>
        ${lista.map((g) => `<tr><td>${esc(g.numero_guia_prestador)}</td><td>${data(g.data_atendimento)}</td><td>${FIN[g.status] ? `<span class="selo ${FIN[g.status][1]}">${FIN[g.status][0]}</span>` : esc(g.status)}</td>
          <td class="num">${brl(g.guia_itens.reduce((s, i) => s + Number(i.valor_informado), 0))}</td><td class="num">${brl(g.guia_itens.reduce((s, i) => s + Number(i.valor_glosa), 0))}</td>
          <td style="white-space:nowrap"><button class="btn pequeno" data-impg="${g.id}">🖨 Imprimir guia</button>
            ${['rascunho', 'pronta'].includes(g.status) ? ` <button class="btn pequeno" data-cancg="${g.id}">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table>`;

      // Situação de cada autorização (cor, filtro e ordem)
      const particular = (a) => /particular/i.test(a.paciente_planos?.contratos?.nome || '');
      const situ = (a) => { const u = usadas[a.id] || 0;
        if (['negada', 'cancelada'].includes(a.status)) return 'encerrada';
        if (a.status === 'pendente' || (!a.senha && !particular(a))) return 'pendente';
        if (a.validade && a.validade < hojeIso()) return 'vencida';
        if (a.qtd_autorizada && u >= a.qtd_autorizada) return 'esgotada';
        return 'ativa'; };
      const SIT = { ativa: ['ativa', 'ok'], pendente: ['senha pendente', 'pendente'], vencida: ['vencida', 'alerta'], esgotada: ['esgotada', 'outra'], encerrada: ['negada/cancelada', 'outra'] };
      // Chips (13/11/2026): categorias exclusivas para a lista não ficar comprida
      const CHIPS = { abertas: 'Abertas', pendentes: 'Pendentes', realizadas: 'Realizadas', liberadas: 'Liberadas p/ faturar', historico: 'Histórico', todas: 'Todas' };
      const sit0 = sessionStorage.getItem('aut_sit');
      const filtro = { sit: CHIPS[sit0] ? sit0 : 'abertas', conv: '', ordem: sessionStorage.getItem('aut_ordem') || 'recente', todasAbertas: false };
      const FATURADA = ['enviada', 'paga', 'glosa_parcial', 'glosa_total'];
      const categoria = (a) => { const st = situ(a), u = usadas[a.id] || 0, g = guiasDe(a.id).filter((k) => k.status !== 'cancelada');
        if (st === 'encerrada') return 'historico';
        if (st === 'pendente') return 'pendentes';
        if (st === 'ativa') return 'abertas';
        // esgotada ou vencida
        if (g.length && g.every((k) => FATURADA.includes(k.status))) return 'historico';
        if (!u && st === 'vencida') return 'historico';
        if (g.some((k) => !FATURADA.includes(k.status) && !k.segurada && (k.lote_id || k.liberada_em || st === 'esgotada' || st === 'vencida'))) return 'liberadas';
        return 'realizadas'; };
      const convs = [...new Set((auts || []).map((a) => a.paciente_planos?.contratos?.nome).filter(Boolean))];

      const chipEnc = (a) => { const en = (encs || []).find((k) => k.id === a.encaminhamento_id);
        if (!en) return '<span class="selo alerta">sem encaminhamento</span>';
        return `<button class="chip-link" ${en.arquivo ? `data-abrir-enc="${esc(en.arquivo)}"` : 'disabled'} title="${en.arquivo ? 'Abrir o pedido médico' : 'Pedido sem arquivo'}">📋 Pedido ${esc(AREAS[en.area])} · ${data(en.data_pedido)}${en.cid ? ' · ' + esc(en.cid) : ''}</button>${en.arquivo ? '' : ' <span class="selo alerta">sem arquivo</span>'}`; };
      // Agendar da ficha (13/11/2026): leva à agenda com paciente/convênio/senha preenchidos (a agenda continua mostrando horários e conflitos)
      const porSessao = (a) => !!(planos || []).find((pl) => pl.id === a.paciente_plano_id)?.contratos?.regras?.senha_por_sessao;
      const podeAgendar = (a, livres) => estado.perfil !== 'profissional' && !['negada', 'cancelada', 'pendente'].includes(a.status) && !(a.validade && a.validade < hojeIso())
        && (livres > 0 || porSessao(a));
      const irAgendar = (a) => { const lig = atsDe(a.id), q = a.qtd_autorizada || 0;
        const livres = q - lig.filter((x) => ['agendado', 'confirmado', 'presente', 'atendido'].includes(x.status)).length;
        const nova = livres <= 0 && porSessao(a);   // 1 senha por sessão: próxima sessão = nova solicitação do mesmo procedimento
        const prof = a.profissional_id || [...lig].reverse().find((x) => x.profissional_id)?.profissional_id || '';
        sessionStorage.setItem('agendar_para', JSON.stringify({ paciente: id, nome: x.nome, plano: a.paciente_plano_id, aut: nova ? 'nova' : a.id, proc: a.procedimento_id,
          porSessao: porSessao(a), prof, resumo: `${a.paciente_planos?.contratos?.nome || ''} · ${nova ? 'nova senha (1 por sessão)' : 'senha ' + (a.senha || '—')}` }));
        location.hash = 'agenda'; };
      const bolinhas = (a, lig, q) => { const vivos = lig.filter((x) => x.status !== 'cancelado');
        const cls = (x) => x.status === 'atendido' ? 'f' : x.status === 'faltou' ? 'x' : 'a';
        if (q > 20) return '';
        return `<span class="bolas">${vivos.map((x) => `<i class="${cls(x)}" title="${data(x.inicio.slice(0, 10))} · ${esc(x.status)}"></i>`).join('')}${'<i></i>'.repeat(Math.max(0, q - vivos.length))}</span>`; };
      const datas = (lig) => lig.filter((x) => x.status !== 'cancelado').map((x) => `<span class="dt dt-${x.status}">${data(x.inicio.slice(0, 10)).slice(0, 5)}${x.status === 'atendido' ? ' ✓' : x.status === 'faltou' ? ' ✗' : ''}</span>`).join('');
      const bloco = (a, aberto) => { const u = usadas[a.id] || 0, sit = situ(a), lig = atsDe(a.id), q = a.qtd_autorizada || 0;
        const ag = lig.filter((x) => ['agendado', 'confirmado', 'presente'].includes(x.status)).length, livres = q - u - ag;
        const acabando = sit === 'ativa' && q > 1 && (livres <= 2 || (a.validade && (new Date(a.validade + 'T12:00') - new Date()) / 864e5 <= 7));
        const en = (encs || []).find((k) => k.id === a.encaminhamento_id);
        const alertas = [acabando ? '<span class="selo pendente">acabando</span>' : '', !en ? '<span class="selo alerta">sem encaminhamento</span>' : !en.arquivo ? '<span class="selo alerta">pedido sem arquivo</span>' : '',
          guiasDe(a.id).some((g) => g.segurada) ? '<span class="selo outra">guia segurada</span>' : ''].join('');
        return `<details class="aut-bloco sit-${sit}" data-aut="${a.id}" ${aberto ? 'open' : ''}>
          <summary class="aut-linha">
            <span class="aut-l1"><strong>${a.senha ? 'Senha ' + esc(a.senha) : 'Sem senha'}</strong><span class="selo ${SIT[sit][1]}">${SIT[sit][0]}</span>${alertas}
              <span class="aut-vence">${a.validade ? 'vence ' + data(a.validade).slice(0, 5) : ''}</span>${podeAgendar(a, livres) ? `<button class="btn pequeno" data-agendar="${a.id}" title="Abrir a agenda do profissional com este paciente e esta senha já preenchidos">📅 Agendar</button>` : ''}</span>
            <span class="aut-l2 muted">${esc(a.paciente_planos?.contratos?.nome)} · <code>${esc(a.procedimentos?.codigo)}</code> · ${u} de ${q || '?'}${ag ? ` (+${ag} agend.)` : ''} ${bolinhas(a, lig, q)}</span>
          </summary>
          <div class="aut-corpo">
            <div class="aut-cab"><div class="aut-proc"><code>${esc(a.procedimentos?.codigo)}</code> ${esc(a.procedimentos?.descricao || '')}</div>
              <div class="aut-acoes">${a.guia_arquivo ? `<button class="btn pequeno primario" data-guiaop="${esc(a.guia_arquivo)}" title="Abrir/imprimir a guia autorizada pela operadora">📄 Guia da operadora</button>`
                : gestao && a.senha ? `<button class="btn pequeno" data-anxguia="${a.id}" title="Anexar o PDF da guia emitida pelo portal">📎 Anexar guia</button>` : ''}
              ${gestao ? `<button class="btn pequeno" data-edaut="${a.id}">Editar</button>` : ''}</div></div>
            <div class="aut-meta">
              <span>📅 ${a.data_autorizacao ? data(a.data_autorizacao) : 'solicitada'} → <strong>${a.validade ? data(a.validade) : 'sem validade'}</strong></span>
              ${a.numero_guia_operadora ? `<span>guia operadora ${esc(a.numero_guia_operadora)}</span>` : ''}
              <span>${u} feitas · ${ag} agend. · ${q ? Math.max(0, livres) + ' livres de ' + q : '?'}</span>
              ${chipEnc(a)}
            </div>
            ${lig.length ? `<div class="aut-datas">${datas(lig)}</div>` : ''}
            ${tabGuias(guiasDe(a.id))}
            ${lig.length ? `<details class="aut-sub"><summary>Agendamentos desta senha (${lig.length})</summary>${tabAts(lig, '')}</details>` : ''}
          </div></details>`; };

      const desenha = () => {
        const ord = { recente: (k, y) => (y.data_autorizacao || y.solicitada_em || '').localeCompare(k.data_autorizacao || k.solicitada_em || ''),
          antiga: (k, y) => (k.data_autorizacao || k.solicitada_em || '').localeCompare(y.data_autorizacao || y.solicitada_em || ''),
          validade: (k, y) => (k.validade || '9999').localeCompare(y.validade || '9999') }[filtro.ordem];
        const doConv = (auts || []).filter((a) => !filtro.conv || a.paciente_planos?.contratos?.nome === filtro.conv);
        const lista = doConv.filter((a) => filtro.sit === 'todas' || categoria(a) === filtro.sit).sort(ord);
        // aberta por padrão: só a autorização com a próxima sessão agendada (ou todas, pelo botão)
        const agora = new Date().toISOString();
        const prox = lista.map((a) => ({ a, d: atsDe(a.id).find((x) => x.inicio >= agora && x.status !== 'cancelado')?.inicio })).filter((x) => x.d).sort((k, y) => k.d.localeCompare(y.d))[0]?.a.id;
        $('#lista-aut').innerHTML = lista.map((a) => bloco(a, filtro.todasAbertas || a.id === prox)).join('') || '<div class="vazio">Nenhuma autorização neste filtro.</div>';
        const conta = (k) => k === 'todas' ? doConv.length : doConv.filter((a) => categoria(a) === k).length;
        $('#chips-aut').innerHTML = Object.entries(CHIPS).filter(([k]) => k !== 'liberadas' || verFin)
          .map(([k, v]) => `<button class="chip-filtro ${filtro.sit === k ? 'on' : ''}" data-chip="${k}">${v} <b>${conta(k)}</b></button>`).join('');
        $$('[data-chip]', $('#chips-aut')).forEach((b) => (b.onclick = () => { filtro.sit = b.dataset.chip; sessionStorage.setItem('aut_sit', filtro.sit); desenha(); }));
        $('#abrir-todas') && ($('#abrir-todas').textContent = filtro.todasAbertas ? 'Fechar todas' : 'Abrir todas');
        $$('[data-agendar]', $('#lista-aut')).forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); irAgendar((auts || []).find((k) => k.id === b.dataset.agendar)); }));
        ligaBotoes($('#lista-aut'));
      };

      const avulsas = gs.filter((g) => !g.autorizacao_id), glosadas = rls.filter((l) => Number(l.valor_glosa) > 0);
      alvo.innerHTML = `<div class="cartao" id="cartao-aut">
        <div class="filtros-aut">
          <div id="chips-aut" class="chips-aut"></div>
          ${convs.length > 1 ? `<label>Convênio<select id="f-conv"><option value="">Todos</option>${convs.map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>` : ''}
          <label>Ordem<select id="f-ord"><option value="recente">Autorização mais recente</option><option value="antiga">Autorização mais antiga</option><option value="validade">Vence primeiro</option></select></label>
          <button class="btn pequeno" id="abrir-todas">Abrir todas</button>
          ${gestao && (planos || []).length ? '<button class="btn primario" id="abrir-aut">+ Registrar autorização</button>' : ''}
        </div>
        ${gestao && (planos || []).length ? `<div id="nova-aut" class="caixa-form" hidden><form class="form-linha" id="f">
          <label class="larga">Convênio<select name="paciente_plano_id" id="pl">${planos.map((pl) => `<option value="${pl.id}" data-ct="${pl.contrato_id}">${esc(pl.contratos?.nome)}</option>`).join('')}</select></label>
          <label class="larga2">Procedimento<select name="procedimento_id" id="proc"></select></label>
          <label>Área<select name="area" id="area">${opcoesArea('fisioterapia')}</select></label>
          <label class="larga">Encaminhamento<select name="encaminhamento_id" id="enc"></select></label>
          <label class="estreita">Qtd.<input type="number" name="qtd" min="1" value="10"></label>
          <label>Senha<input name="senha" placeholder="vazio = pendente"></label><label>Nº guia operadora<input name="guia"></label>
          <label>Data da autorização<input type="date" name="data" value="${hojeIso()}"></label><label>Validade<input type="date" name="validade"></label>
          </form><div class="linha-acoes"><button class="btn" id="fechar-aut">Cancelar</button><button class="btn primario" id="s">Registrar</button></div></div>`
          : gestao ? '<div class="dica">Vincule um convênio na aba Cadastro para registrar autorizações.</div>' : ''}
        <div id="lista-aut"></div>
        <h3 style="margin-top:18px">Agendamentos sem autorização <span class="muted" style="font-weight:400">(particular ou convênio sem senha)</span></h3>
        ${tabAts(semAut, 'Nenhum.')}
        ${avulsas.length ? `<h3 style="margin-top:18px">Guias sem autorização vinculada</h3>${tabGuias(avulsas)}` : ''}
      </div>
      ${verFin ? `<details class="cartao"><summary><strong>Histórico nos retornos das operadoras</strong> <span class="muted">· ${rls.length} itens · ${glosadas.length} glosados (${brl(glosadas.reduce((s, l) => s + Number(l.valor_glosa), 0))})</span></summary>
        ${rls.length ? `<table><thead><tr><th>Data</th><th>Guia</th><th>Procedimento</th><th class="num">Informado</th><th class="num">Glosa</th><th>Motivo</th></tr></thead><tbody>
          ${rls.map((l) => `<tr><td>${data(l.data_realizacao)}</td><td>${esc(l.numero_guia_prestador)}</td><td>${esc(l.codigo_procedimento || 'guia')}</td>
            <td class="num">${brl(l.valor_informado)}</td><td class="num">${Number(l.valor_glosa) ? `<strong>${brl(l.valor_glosa)}</strong>` : '—'}</td>
            <td>${l.codigo_glosa ? `${esc(l.codigo_glosa)} ${esc((desc[l.codigo_glosa] || '').slice(0, 50))}` : ''}</td></tr>`).join('')}</tbody></table>`
          : '<div class="vazio">Nenhum item nos retornos importados para a carteirinha deste paciente.</div>'}</details>` : ''}`;

      $('#f-ord').value = filtro.ordem;
      $('#abrir-todas').onclick = () => { filtro.todasAbertas = !filtro.todasAbertas; desenha(); };
      $('#f-ord').onchange = (ev) => { filtro.ordem = ev.target.value; sessionStorage.setItem('aut_ordem', filtro.ordem); desenha(); };
      $('#f-conv') && ($('#f-conv').onchange = (ev) => { filtro.conv = ev.target.value; desenha(); });
      desenha();
      // botões fora da lista filtrada (agendamentos sem autorização e guias avulsas)
      ligaBotoes($('#cartao-aut'), '#lista-aut');

      // Validade padrão da senha pelo contrato (regras.autorizacao.validade_senha_dias)
      const diasValidade = (plId) => (planos || []).find((pl) => pl.id === plId)?.contratos?.regras?.autorizacao?.validade_senha_dias;
      if ($('#pl')) {
        const caixa = $('#nova-aut'), f0 = $('#f');
        const carregaProcs = async () => {
          const ct = $('#pl').selectedOptions[0].dataset.ct;
          const { data: itens } = await sb.from('contrato_tabela').select('procedimentos(id, codigo, descricao)').eq('contrato_id', ct).is('vigencia_fim', null);
          $('#proc').innerHTML = (itens || []).map((i) => `<option value="${i.procedimentos.id}">${esc(i.procedimentos.codigo)} · ${esc(i.procedimentos.descricao)}</option>`).join('');
        };
        const carregaEnc = () => { $('#enc').innerHTML = '<option value="">— sem encaminhamento —</option>' + opcoesEnc($('#area').value); };
        $('#abrir-aut').onclick = () => (caixa.hidden = !caixa.hidden);
        $('#fechar-aut').onclick = () => (caixa.hidden = true);
        $('#pl').onchange = carregaProcs; carregaProcs();
        $('#area').onchange = carregaEnc; carregaEnc();
        f0.senha.addEventListener('change', () => { const d = diasValidade(f0.paciente_plano_id.value); if (d && f0.senha.value.trim() && !f0.validade.value) f0.validade.value = somaDias(f0.data.value || hojeIso(), d); });
        $('#s').onclick = async () => {
          const f = Object.fromEntries(new FormData(f0)), senha = f.senha.trim();
          if (!f.procedimento_id) return toast('Escolha o procedimento.', true);
          const { data: nova, error: er } = await sb.from('autorizacoes').insert({ clinica_id: cid, paciente_plano_id: f.paciente_plano_id, procedimento_id: f.procedimento_id,
            area: f.area, qtd_autorizada: Number(f.qtd), qtd_solicitada: Number(f.qtd), senha: senha || null, numero_guia_operadora: f.guia.trim() || null,
            status: senha || /particular/i.test(f0.paciente_plano_id.selectedOptions[0].textContent) ? 'autorizada' : 'pendente',
            data_autorizacao: f.data || null, validade: f.validade || null }).select('id').single();
          if (er) return falha(er);
          if (f.encaminhamento_id) {
            const { data: rv, error: e2 } = await sb.rpc('vincular_encaminhamento', { p_autorizacao: nova.id, p_encaminhamento: f.encaminhamento_id });
            if (e2) return falha(e2, 'Autorização salva, mas o vínculo falhou');
            (rv?.avisos || []).forEach((m) => toast(m, true));
          }
          toast(senha ? 'Autorização registrada.' : 'Registrada como senha pendente — lance a senha em Editar quando chegar.'); recarregar();
        };
      }

      function ligaBotoes(raiz, pular) {
        const q = (sel) => $$(sel, raiz).filter((b) => !pular || !b.closest(pular));
        q('[data-pgto]').forEach((b) => (b.onclick = () => { const a = ats.find((k) => k.id === b.dataset.pgto); registrarPagamento({ ...a, paciente_id: id }, recarregar, recDe[a.id] || null, p); }));
        q('[data-nota]').forEach((b) => (b.onclick = () => fazerNota(recDe[b.dataset.nota], p)));
        q('[data-delpg]').forEach((b) => (b.onclick = async () => { if (await excluirPagamento(recDe[b.dataset.delpg])) recarregar(); }));
        q('[data-impg]').forEach((b) => (b.onclick = () => imprimirGuia(b.dataset.impg)));
        q('[data-cancg]').forEach((b) => (b.onclick = async () => {
          if (!(await confirmar('Cancelar esta guia? Ela não será enviada no lote.', 'Cancelar guia'))) return;
          const { error: e } = await sb.rpc('cancelar_guia', { p_guia: b.dataset.cancg });
          if (e) return falha(e); toast('Guia cancelada.'); recarregar();
        }));
        q('[data-guiaop]').forEach((b) => (b.onclick = () => abrirArquivo(b.dataset.guiaop)));
        q('[data-abrir-enc]').forEach((b) => (b.onclick = () => abrirArquivo(b.dataset.abrirEnc)));
        q('[data-anxguia]').forEach((b) => (b.onclick = async () => {
          const f = await escolherArquivo(); if (!f) return;
          const a = auts.find((k) => k.id === b.dataset.anxguia);
          try {
            const up = await enviarArquivo(f, `pacientes/${id}/autorizacoes`);
            const { error: er } = await sb.from('autorizacoes').update({ guia_arquivo: up.arquivo, guia_arquivo_nome: up.arquivo_nome }).eq('id', a.id);
            if (er) throw er;
            if (a.guia_arquivo) await removerArquivo(a.guia_arquivo).catch(() => {});
            toast('Guia anexada.'); recarregar();
          } catch (e) { falha(e, 'Anexar guia'); }
        }));
        q('[data-edaut]').forEach((b) => (b.onclick = () => editarAut(auts.find((k) => k.id === b.dataset.edaut))));
        q('[data-excaut]').forEach((b) => (b.onclick = async () => {
          const lig = atsDe(b.dataset.excaut).filter((k) => k.status !== 'cancelado');
          if (!(await confirmar(`Excluir esta autorização?${lig.length ? ` Os ${lig.length} agendamento(s) ligados continuam na agenda, mas ficam SEM autorização (convênio vai pedir de novo).` : ''}`, 'Excluir'))) return;
          const { error: e1 } = await sb.from('atendimentos').update({ autorizacao_id: null }).eq('autorizacao_id', b.dataset.excaut);
          if (e1) return falha(e1);
          const { error: er } = await sb.from('autorizacoes').delete().eq('id', b.dataset.excaut);
          if (er) return falha(er, er.code === '23503' ? 'Esta autorização já tem guia gerada — cancele a guia antes' : 'Excluir');
          toast('Autorização excluída.'); recarregar();
        }));
        q('[data-vinc]').forEach((b) => (b.onclick = async () => {
          const sel = $(`select[data-encsel="${b.dataset.vinc}"]`, raiz);
          if (!sel.value) return toast('Escolha o encaminhamento.', true);
          const { data: rv, error: er } = await sb.rpc('vincular_encaminhamento', { p_autorizacao: b.dataset.vinc, p_encaminhamento: sel.value });
          if (er) return falha(er, 'Vincular');
          (rv?.avisos || []).forEach((m) => toast(m, true)); if (!(rv?.avisos || []).length) toast('Encaminhamento vinculado.');
          recarregar();
        }));
        q('[data-desvinc]').forEach((b) => (b.onclick = async () => {
          if (!(await confirmar('Desvincular o encaminhamento desta autorização?', 'Desvincular'))) return;
          const { error: er } = await sb.rpc('vincular_encaminhamento', { p_autorizacao: b.dataset.desvinc, p_encaminhamento: null });
          if (er) return falha(er); recarregar();
        }));
      }

      // Editar a autorização inteira (lançar a senha que chegou, corrigir validade ou quantidade)
      function editarAut(a) {
        const dias = diasValidade(a.paciente_plano_id);
        modal(`<h3>Editar autorização</h3><form class="grade-form" id="fa">
          <label>Senha<input name="senha" value="${esc(a.senha)}" placeholder="vazio = pendente"></label>
          <label>Nº guia operadora<input name="guia" value="${esc(a.numero_guia_operadora)}"></label>
          <label>Data da autorização<input type="date" name="data" value="${esc(a.data_autorizacao || hojeIso())}"></label>
          <label>Validade<input type="date" name="validade" value="${esc(a.validade)}"></label>
          <label>Qtd. solicitada<input type="number" min="1" name="qs" value="${esc(a.qtd_solicitada ?? a.qtd_autorizada)}"></label>
          <label>Qtd. autorizada<input type="number" min="1" name="qa" value="${esc(a.qtd_autorizada)}"></label>
          <label>CID<input name="cid" value="${esc(a.cid)}"></label>
          <label>Situação<select name="status">${['pendente', 'autorizada', 'negada', 'cancelada'].map((k) => `<option ${k === a.status ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          <label style="grid-column:1/-1">Encaminhamento (pedido médico)<select name="enc"><option value="">— sem encaminhamento —</option>${opcoesEnc(a.area, a.encaminhamento_id)}</select></label>
          </form>${dias ? `<p class="muted">Este convênio dá ${dias} dias de validade: ao lançar a senha, a validade é sugerida.</p>` : ''}
          <div class="linha-acoes">${atsDe(a.id).some((k) => k.status === 'atendido') ? '' : '<button class="btn escuro" id="exaut" style="margin-right:auto">Excluir autorização</button>'}
            <button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Salvar</button></div>`, (m, fechar) => {
          const fm = $('#fa', m);
          $('#exaut', m)?.addEventListener('click', async () => {
            const lig = atsDe(a.id).filter((k) => k.status !== 'cancelado');
            if (!(await confirmar(`Excluir esta autorização?${lig.length ? ` Os ${lig.length} agendamento(s) ligados continuam na agenda, mas ficam SEM autorização.` : ''}`, 'Excluir'))) return;
            const { error: e1 } = await sb.from('atendimentos').update({ autorizacao_id: null }).eq('autorizacao_id', a.id);
            if (e1) return falha(e1);
            const { error: er } = await sb.from('autorizacoes').delete().eq('id', a.id);
            if (er) return falha(er, er.code === '23503' ? 'Esta autorização já tem guia gerada — cancele a guia antes' : 'Excluir');
            toast('Autorização excluída.'); recarregar();
          });
          fm.senha.addEventListener('change', () => { if (fm.senha.value.trim()) { if (fm.status.value === 'pendente') fm.status.value = 'autorizada'; if (dias && !fm.validade.value) fm.validade.value = somaDias(fm.data.value || hojeIso(), dias); } });
          $('#ok', m).onclick = async () => {
            const f = Object.fromEntries(new FormData(fm)), senha = f.senha.trim() || null;
            if (f.status === 'autorizada' && !senha && !particular(a)) return toast('Autorizada precisa de senha — ou deixe como pendente.', true);
            if (!Number(f.qa)) return toast('Informe a quantidade autorizada.', true);
            const { error: er } = await sb.from('autorizacoes').update({ senha, numero_guia_operadora: f.guia.trim() || null, data_autorizacao: f.data || null,
              validade: f.validade || null, qtd_solicitada: f.qs ? Number(f.qs) : null, qtd_autorizada: Number(f.qa), cid: normCid(f.cid) || null, status: f.status }).eq('id', a.id);
            if (er) return falha(er, 'Salvar');
            if ((f.enc || null) !== (a.encaminhamento_id || null)) {
              const { data: rv, error: e2 } = await sb.rpc('vincular_encaminhamento', { p_autorizacao: a.id, p_encaminhamento: f.enc || null });
              if (e2) return falha(e2, 'Vincular encaminhamento');
              (rv?.avisos || []).forEach((k) => toast(k, true));
            }
            fechar(); toast('Autorização atualizada.'); recarregar();
          };
        });
      }
    },

    prontuario() { return abaProntuario(alvo, p, ats, abaExtra); },
    documentos() { return abaDocumentos(alvo, p, ats); },
  };

  // Cadastro rápido do médico do pedido (vai na guia SP/SADT: conselho, número, UF e CBO)
  function novoSolicitante(selAlvo) {
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
        const sel = selAlvo || $('#sol');
        if (sel && !sel.querySelector(`option[value="${sid}"]`)) sel.insertAdjacentHTML('beforeend', `<option value="${sid}">${esc(f.nome.trim())} · ${esc(f.conselho)} ${esc(f.numero_conselho.trim())}</option>`);
        if (sel) sel.value = sid;
        fechar();
      };
    });
  }

  // Boas-vindas: e-mail (abre o programa de e-mail) ou WhatsApp, com texto padrão da clínica editável — sem serviço pago.
  async function boasVindas() {
    const PADRAO = {
      particular: 'Olá, {nome}! Seja muito bem-vindo(a) à {clinica}.\n\n'
        + 'Ficamos felizes em cuidar de você. Para que a agenda funcione bem para todos, combinamos assim: se precisar desmarcar ou remarcar, '
        + 'avise com pelo menos 24 horas de antecedência. Ausências sem esse aviso são consideradas como sessão realizada.\n\n'
        + 'Qualquer dúvida, é só responder esta mensagem. Até breve!\nEquipe {clinica}',
      convenio: 'Olá, {nome}! Seja muito bem-vindo(a) à {clinica}.\n\n'
        + 'Ficamos felizes em cuidar de você. Para que a agenda funcione bem para todos, combinamos assim: se precisar desmarcar ou remarcar, '
        + 'avise com pelo menos 24 horas de antecedência. Faltas sem esse aviso liberam o horário reservado para outro paciente e podem exigir '
        + 'nova autorização do seu plano para continuar o tratamento.\n\n'
        + 'Qualquer dúvida, é só responder esta mensagem. Até breve!\nEquipe {clinica}',
    };
    const CHAVE = { particular: 'boas_vindas_texto', convenio: 'boas_vindas_convenio' };
    const temConv = (planos || []).some((pl) => !/particular/i.test(pl.contratos?.nome || ''));
    const { data: cl } = await sb.from('clinicas').select('config').eq('id', cid).single();
    const cfg = cl?.config || {};
    const primeiro = ((p.nome_social || p.nome || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/^./, (k) => k.toUpperCase());
    const montar = (txt) => txt.replace(/\{nome\}/g, primeiro).replace(/\{clinica\}/g, estado.clinica.nome || 'clínica');
    const cel = foneDig(p.celular);
    modal(`<h3>Boas-vindas — ${esc(p.nome)}</h3>
      <p class="muted">Use {nome} e {clinica} no texto. O e-mail abre no seu programa de e-mail (Outlook/Gmail) já preenchido; é só enviar.</p>
      <label style="max-width:260px">Texto para<select id="bvtipo"><option value="particular">Particular</option><option value="convenio" ${temConv ? 'selected' : ''}>Convênio</option></select></label>
      <textarea id="bv" rows="10" style="width:100%;margin-top:8px"></textarea>
      <div class="linha-acoes">${podeGerir() ? '<button class="btn" id="bvpadrao">Salvar como texto padrão</button>' : ''}<button class="btn" data-fechar>Fechar</button>
        <button class="btn" id="bvwpp" ${/^55\d{10,11}$/.test(cel) ? '' : 'disabled title="Sem celular com DDD"'}>📲 WhatsApp</button>
        <button class="btn primario" id="bvmail" ${p.email ? '' : 'disabled title="Paciente sem e-mail"'}>✉ Abrir e-mail</button></div>`, (m) => {
      const txt = () => montar($('#bv', m).value);
      const carrega = () => { const k = $('#bvtipo', m).value; $('#bv', m).value = cfg[CHAVE[k]] || PADRAO[k]; };
      $('#bvtipo', m).onchange = carrega; carrega();
      $('#bvmail', m).onclick = () => { location.href = `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent('Boas-vindas à ' + (estado.clinica.nome || 'clínica'))}&body=${encodeURIComponent(txt())}`; };
      $('#bvwpp', m).onclick = () => window.open(`https://wa.me/${cel}?text=${encodeURIComponent(txt())}`, '_blank', 'noopener');
      $('#bvpadrao', m)?.addEventListener('click', async () => {
        const { data: atual } = await sb.from('clinicas').select('config').eq('id', cid).single();
        const novo = { ...(atual?.config || {}), [CHAVE[$('#bvtipo', m).value]]: $('#bv', m).value };
        cfg[CHAVE[$('#bvtipo', m).value]] = $('#bv', m).value;
        const { error: er } = await sb.from('clinicas').update({ config: novo }).eq('id', cid);
        if (er) return falha(er, 'Salvar texto padrão'); toast('Texto padrão salvo.');
      });
    });
  }

  function opcoesEnc(area, sel) {
    return (encs || []).filter((en) => en.id === sel || (en.status === 'ativo' && (!area || en.area === area)))
      .map((en) => `<option value="${en.id}" ${en.id === sel ? 'selected' : ''}>${esc(AREAS[en.area])} · ${data(en.data_pedido)}${en.cid ? ' · ' + esc(en.cid) : ''}${en.validade && en.validade < hojeIso() ? ' (vencido)' : ''}</option>`).join('');
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
