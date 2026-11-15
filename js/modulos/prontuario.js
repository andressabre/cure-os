// Módulo Prontuário (db/023). Sigilo: cada profissional lê e escreve SÓ os próprios registros (RLS por autor).
// Modelos por área + campo livre; modelos com ⚡ têm avaliação por cliques (avaliacao-cliques.js, item 15). Sem etapa de assinatura (db/039): salvar grava o registro como final e ele pode ser editado depois
// (versão anterior guardada em prontuario_versoes pelo gatilho); adendos e anexos (bucket "prontuario") ficam dentro do registro expandido.
// Duas entradas: aba "Prontuário" da ficha do paciente (abaProntuario) e rota #prontuarios (meus pacientes + importação dos .txt antigos).
import { sb, estado, $, $$, esc, data, tela, toast, falha, modal, confirmar, descricaoCid } from '../core.js';
import { enviarArquivo, abrirArquivo, escolherArquivo } from './documentos.js';
import { montarPainel, temRoteiro, ROTEIROS } from './avaliacao-cliques.js';
import { montarSapo, laudoPostural } from './avaliacao-postural.js';
import { montarDina, laudoDina, idade } from './avaliacao-dinamometria.js';

const OBS = ['obs', 'Observações (campo livre)'];
export const MODELOS = {
  soapn: { nome: 'Evolução SOAPN', area: 'nutricao', medidas: true, campos: [
    ['s', 'S – Subjetivo', 'Queixa, evolução, sintomas, adesão, rotina, hábito intestinal, hidratação. Última linha: AF: modalidade (frequência, horário) + …'],
    ['o', 'O – Objetivo', 'Exame físico, bioimpedância, exames (mais recente primeiro, 1 linha por coleta + Avaliação:). Medicamentos: nome dose (objetivo) | … Suplementos: nome dose (período) | …'],
    ['a', 'A – Avaliação', 'Correlação dos achados com hipóteses, deficiências, fatores de risco e resposta ao tratamento'],
    ['p', 'P – Plano', 'Objetivos, condutas, prescrição dietética, suplementação com dose e período, exames, retorno'],
    ['n', 'N – Necessidades', 'Ajustes alimentares, adesão, educação nutricional, correção de deficiências, reavaliação'], OBS] },
  fisio_avaliacao: { nome: 'Avaliação fisioterapêutica', area: 'fisioterapia', campos: [
    ['queixa', 'Queixa principal'], ['hda', 'História da doença atual'],
    ['historico', 'Antecedentes, medicamentos, exames de imagem'], ['eva', 'Dor (EVA 0–10)', '', 'num'],
    ['exame', 'Exame físico', 'Inspeção, palpação, ADM, força, testes especiais, marcha/pisada'],
    ['escanometria', 'Escanometria (resultado)'], ['diagnostico', 'Diagnóstico e prognóstico fisioterapêutico', 'Cinético-funcional'],
    ['objetivos', 'Objetivos terapêuticos'], ['plano', 'Plano terapêutico', 'Condutas, frequência, nº de sessões previsto'], OBS] },
  fisio_esportiva: { nome: 'Avaliação de fisioterapia esportiva', area: 'fisioterapia', campos: [
    ['esporte', 'Modalidade e carga de treino'], ['queixa', 'Queixa principal'], ['hda', 'História da doença atual'],
    ['historico', 'Antecedentes, medicamentos, exames de imagem'], ['eva', 'Dor (EVA 0–10)', '', 'num'],
    ['exame', 'Exame físico e testes funcionais', 'Inspeção, palpação, ADM, força, testes especiais, agachamento unipodal, hop test'],
    ['escanometria', 'Escanometria (resultado)'], ['diagnostico', 'Diagnóstico e prognóstico fisioterapêutico', 'Cinético-funcional'],
    ['objetivos', 'Objetivos terapêuticos'], ['plano', 'Plano terapêutico e retorno ao esporte', 'Condutas, frequência, nº de sessões, critérios de retorno'], OBS] },
  fisio_podo: { nome: 'Avaliação podoposturológica (baropodometria/palmilha)', area: 'fisioterapia', campos: [
    ['queixa', 'Motivo e queixa'], ['historico', 'Contexto: condições, atividade, calçado, antropometria'],
    ['estatica', 'Baropodometria estática'], ['dinamica', 'Análise dinâmica (marcha e pisada)'], ['postural', 'Postura e mobilidade'],
    ['fpi', 'Índice Postural do Pé (FPI-6)'], ['escanometria', 'Escanometria (resultado)'], ['conclusao', 'Correlação clínica e conclusão'], ['plano', 'Conduta e reavaliação'], OBS] },
  fisio_postural: { nome: 'Avaliação postural por foto (SAPO)', area: 'fisioterapia', campos: [
    ['queixa', 'Motivo e queixa'], ['anterior', 'Vista anterior'], ['posterior', 'Vista posterior'], ['lateral', 'Vistas laterais'],
    ['conclusao', 'Conclusão (mini laudo)'], ['plano', 'Conduta e reavaliação'], OBS] },
  dinamometria: { nome: 'Avaliação por dinamometria (preensão palmar + segmentar)', area: null, medidas: ['peso', 'altura'], campos: [
    ['queixa', 'Motivo da avaliação e contexto'], ['preensao', 'Força de preensão palmar'], ['segmentar', 'Dinamometria segmentar e assimetria'],
    ['conclusao', 'Conclusão'], ['plano', 'Conduta e reavaliação'], OBS] },
  fisio_evolucao: { nome: 'Evolução de sessão (fisioterapia)', area: 'fisioterapia', campos: [
    ['diag', 'Diagnóstico / CID', 'Vem do encaminhamento ou da avaliação'],
    ['sessao', 'Sessão nº', '', 'num'], ['eva_pre', 'EVA antes', '', 'num'], ['eva_pos', 'EVA depois', '', 'num'],
    ['estado', 'Como o paciente chegou'], ['condutas', 'Condutas realizadas'], ['resposta', 'Resposta do paciente / intercorrências'], ['proxima', 'Ajuste para a próxima sessão'], OBS] },
  psico_registro: { nome: 'Registro documental (psicologia)', area: 'psicologia', campos: [
    ['demanda', 'Avaliação de demanda'], ['objetivos', 'Objetivos do trabalho'], ['evolucao', 'Registro da evolução'],
    ['procedimentos', 'Procedimentos técnico-científicos adotados'], ['encaminhamento', 'Encaminhamento ou encerramento'], OBS] },
  medica_consulta: { nome: 'Consulta médica', area: 'medicina', campos: [
    ['queixa', 'Queixa principal e HDA'], ['antecedentes', 'Antecedentes pessoais e familiares'], ['medicamentos', 'Medicamentos em uso'],
    ['exame', 'Exame físico (sinais vitais e sistemas)'], ['hipotese', 'Hipóteses diagnósticas'], ['conduta', 'Conduta e plano'], OBS] },
  livre: { nome: 'Registro livre', area: null, campos: [['texto', 'Texto']] },
};
const AREA_NOME = { nutricao: 'Nutrição', fisioterapia: 'Fisioterapia', psicologia: 'Psicologia', medicina: 'Medicina', outra: 'Outra' };
const areaDoConselho = (c) => ({ CRN: 'nutricao', CREFITO: 'fisioterapia', CRP: 'psicologia', CRM: 'medicina' }[String(c || '').toUpperCase()] || 'outra');
const hojeIso = () => new Date().toISOString().slice(0, 10);
const dh = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const imc = (m) => (m?.peso && m?.altura ? (m.peso / (m.altura / 100) ** 2).toFixed(1) : null);
const medidasDo = (m) => (Array.isArray(m.medidas) ? m.medidas : ['peso', 'altura', 'cc', 'gordura']);
// Dinamometria anterior do mesmo paciente (só do autor, pela RLS) — comparação e MDC no painel e no laudo
const dinaAnterior = (regs, r) => {
  const a = (regs || []).filter((x) => x.modelo === 'dinamometria' && x.id !== r.id && x.conteudo?.dina && (!r.data_registro || String(x.data_registro) <= String(r.data_registro)))
    .sort((x, y) => String(y.data_registro).localeCompare(String(x.data_registro)) || String(y.criado_em).localeCompare(String(x.criado_em)))[0];
  return a ? { dina: a.conteudo.dina, data: data(a.data_registro) } : null;
};

let _eu;   // cadastro do profissional logado (nome, conselho)
let _regsPac = [];   // registros do paciente aberto (contexto da evolução rápida)
async function eu() {
  if (_eu?.id === estado.profissionalId) return _eu;
  const { data: p } = await sb.from('profissionais').select('id, nome, conselho, numero_conselho, uf_conselho').eq('id', estado.profissionalId).single();
  return (_eu = p);
}

const SEM_ACESSO = `<div class="cartao vazio">🔒 O prontuário é sigiloso: cada profissional vê só o que ele mesmo registrou.
  Seu acesso não está ligado a um cadastro de profissional, então nenhum conteúdo clínico aparece aqui.</div>`;

// ---------------------------------------------------------------- aba da ficha
const LIDOS = new Set();
const ABERTOS = new Set();   // registros expandidos (sobrevive ao recarregar a aba)

// Aba "Avaliações" da ficha (15/11/2026): avaliações com instrumento/laudo próprio saem do prontuário para não poluir a linha do tempo.
// Os registros continuam na mesma tabela (prontuario_registros, mesma RLS por autor); só a tela separa.
export const AVALIACOES = new Set(['dinamometria', 'fisio_postural', 'fisio_podo']);
export const abaAvaliacoes = (alvo, p, ats) => abaProntuario(alvo, p, ats, null, 'avaliacoes');

export async function abaProntuario(alvo, p, ats, extra, grupo = 'prontuario') {
  if (!estado.profissionalId) { alvo.innerHTML = SEM_ACESSO; return; }
  const cid = estado.clinica.id, me = await eu();
  const minhaArea = areaDoConselho(me?.conselho);
  const [{ data: todos, error }, { data: ads }, { data: anx }] = await Promise.all([
    sb.from('prontuario_registros').select('*').eq('paciente_id', p.id).order('data_registro', { ascending: false }).order('criado_em', { ascending: false }),
    sb.from('prontuario_adendos').select('*').eq('clinica_id', cid).order('criado_em'),
    sb.from('prontuario_anexos').select('*').eq('clinica_id', cid).order('criado_em'),
  ]);
  if (error) return falha(error, 'Prontuário');
  const aval = grupo === 'avaliacoes', doGrupo = (k) => AVALIACOES.has(k) === aval;
  const regs = (todos || []).filter((r) => doGrupo(r.modelo));
  regs.filter((r) => !LIDOS.has(r.id)).forEach((r) => { LIDOS.add(r.id); sb.rpc('registrar_leitura_prontuario', { p_registro: r.id }); }); // auditoria de leitura (1x por sessão)
  const meusAts = (ats || []).filter((a) => a.profissional_id === estado.profissionalId && ['atendido', 'presente'].includes(a.status));
  const semRegistro = aval ? [] : meusAts.filter((a) => !(todos || []).some((r) => r.atendimento_id === a.id));
  _regsPac = todos || [];
  const recarregar = () => abaProntuario(alvo, p, ats, null, grupo);
  const modelosArea = Object.entries(MODELOS).filter(([k, m]) => doGrupo(k) && (!m.area || m.area === minhaArea || minhaArea === 'outra'));

  alvo.innerHTML = `
    <div class="cartao"><div class="linha-acoes" style="justify-content:space-between;margin:0">
      <span class="muted">🔒 Só você vê · ${esc(me?.nome)} ${esc(me?.conselho || '')} ${esc(me?.numero_conselho || '')} · ${regs.length} ${aval ? 'avaliação(ões)' : 'registro(s)'}</span>
      <span>${modelosArea.length > 1 ? `<select id="mod" title="Modelo do novo registro">${modelosArea.map(([k, m]) => `<option value="${k}">${esc(m.nome)}${temRoteiro(k) ? ' ⚡' : ''}</option>`).join('')}</select>` : ''}
        <button class="btn primario" id="novo">+ ${aval ? 'Nova avaliação' : 'Novo registro'}</button>
        ${regs.length ? `<button class="btn" id="imp">Imprimir ${aval ? 'avaliações' : 'prontuário'}</button>` : ''}</span></div>
      ${semRegistro.length ? `<div class="dica" style="margin:10px 0 0">⚠️ ${semRegistro.length} atendimento(s) seu(s) sem evolução:
        ${semRegistro.slice(0, 6).map((a) => `<a href="#" data-evol="${a.id}">${dh(a.inicio)}</a>`).join(' · ')}</div>` : ''}
    </div>
    ${(regs || []).length ? `<div class="cartao pr-lista">${regs.map((r) => linhaRegistro(r, ads, anx, ats, me)).join('')}</div>`
      : `<div class="cartao vazio">${aval ? 'Nenhuma avaliação sua para este paciente. Dinamometria, avaliação postural (SAPO) e podoposturológica ficam aqui.' : 'Nenhum registro seu para este paciente.'}</div>`}`;

  const modeloEscolhido = () => $('#mod', alvo)?.value || modelosArea[0]?.[0] || 'livre';
  $('#novo', alvo).onclick = () => editor(p, { modelo: modeloEscolhido() }, meusAts, recarregar);
  $$('[data-evol]', alvo).forEach((b) => (b.onclick = (e) => {
    e.preventDefault();
    const at = meusAts.find((a) => a.id === b.dataset.evol);
    editor(p, { modelo: modeloSessao(minhaArea, regs), atendimento_id: at.id, data_registro: at.inicio.slice(0, 10) }, meusAts, recarregar);
  }));
  $('#imp', alvo)?.addEventListener('click', () => imprimir(p, regs, ads, me));
  $$('[data-tog]', alvo).forEach((b) => (b.onclick = () => {
    const linha = b.closest('.pr-linha'), id = b.dataset.tog, aberto = linha.classList.toggle('aberto');
    aberto ? ABERTOS.add(id) : ABERTOS.delete(id);
    b.setAttribute('aria-expanded', aberto);
  }));
  $$('[data-edit]', alvo).forEach((b) => (b.onclick = () => editor(p, regs.find((r) => r.id === b.dataset.edit), meusAts, recarregar)));
  $$('[data-apagar]', alvo).forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('Apagar este rascunho?', 'Apagar'))) return;
    const { error: e } = await sb.from('prontuario_registros').delete().eq('id', b.dataset.apagar);
    if (e) return falha(e); toast('Rascunho apagado.'); recarregar();
  }));
  $$('[data-adendo]', alvo).forEach((b) => (b.onclick = () => adendo(b.dataset.adendo, recarregar)));
  $$('[data-anexar]', alvo).forEach((b) => (b.onclick = async () => {
    const f = await escolherArquivo(); if (!f) return;
    try {
      const up = await enviarArquivo(f, `${estado.profissionalId}/${p.id}`, 'prontuario');
      const { error: e } = await sb.from('prontuario_anexos').insert({ registro_id: b.dataset.anexar, clinica_id: cid,
        profissional_id: estado.profissionalId, arquivo: up.arquivo, nome: up.arquivo_nome });
      if (e) throw e; toast('Anexo salvo.'); recarregar();
    } catch (e) { falha(e, 'Anexar'); }
  }));
  $$('[data-abrir]', alvo).forEach((b) => (b.onclick = () => abrirArquivo(b.dataset.abrir, 'prontuario')));
  $$('[data-imp1]', alvo).forEach((b) => (b.onclick = () => imprimir(p, regs.filter((r) => r.id === b.dataset.imp1), ads, me)));
  $$('[data-laudo]', alvo).forEach((b) => (b.onclick = () => { const r = regs.find((x) => x.id === b.dataset.laudo);
    if (r.modelo === 'dinamometria') laudoDina(p, r, me, dinaAnterior(regs, r)); else laudoPostural(p, r, me); }));

  // Vindo da agenda (#paciente-<id>-prontuario:<atendimento>): abre a evolução já ligada ao atendimento
  if (extra && !aval) {
    const ja = (todos || []).find((r) => r.atendimento_id === extra);
    const at = meusAts.find((a) => a.id === extra);
    if (ja) editor(p, ja, meusAts, recarregar);
    else if (at) editor(p, { modelo: modeloSessao(minhaArea, regs), atendimento_id: at.id, data_registro: at.inicio.slice(0, 10) }, meusAts, recarregar);
  }
}

// Fisio: 1º registro = avaliação, depois evolução. Nutri = SOAPN. Psico = registro documental.
function modeloSessao(area, regs) {
  if (area === 'fisioterapia') return (regs || []).some((r) => ['fisio_avaliacao', 'fisio_esportiva'].includes(r.modelo)) ? 'fisio_evolucao' : 'fisio_avaliacao';
  return { nutricao: 'soapn', psicologia: 'psico_registro', medicina: 'medica_consulta' }[area] || 'livre';
}

// Prévia de uma linha: primeiros campos de texto preenchidos, em ordem do modelo
function previa(r, max = 120) {
  const m = MODELOS[r.modelo] || MODELOS.livre, c = r.conteudo || {};
  const t = m.campos.filter(([, , , tipo]) => tipo !== 'num').map(([k]) => String(c[k] ?? '').trim()).filter(Boolean).join(' · ').replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max).trimEnd() + '…' : t;
}

function corpoRegistro(r) {
  const m = MODELOS[r.modelo] || MODELOS.livre, c = r.conteudo || {};
  const med = m.medidas && c.medidas ? Object.entries({ Peso: c.medidas.peso && c.medidas.peso + ' kg', Altura: c.medidas.altura && c.medidas.altura + ' cm',
    IMC: imc(c.medidas) && imc(c.medidas) + ' kg/m²', CC: c.medidas.cc && c.medidas.cc + ' cm', '% gordura': c.medidas.gordura && c.medidas.gordura + '%' })
    .filter(([, v]) => v).map(([k, v]) => `<strong>${k}:</strong> ${esc(v)}`).join(' · ') : '';
  return (med ? `<p>${med}</p>` : '') + m.campos.filter(([k]) => c[k] !== undefined && String(c[k]).trim() !== '')
    .map(([k, rot]) => `<div class="pr-campo"><div class="pr-rot">${esc(rot)}</div><div class="pr-txt">${esc(c[k])}</div></div>`).join('');
}

function linhaRegistro(r, ads, anx, ats, me) {
  const m = MODELOS[r.modelo] || MODELOS.livre, at = (ats || []).find((a) => a.id === r.atendimento_id);
  const meusAds = (ads || []).filter((a) => a.registro_id === r.id), meusAnx = (anx || []).filter((a) => a.registro_id === r.id);
  const aberto = ABERTOS.has(r.id);
  const selos = (r.origem === 'sistema_antigo' ? ' <span class="selo outra">sistema antigo</span>' : '')
    + (r.status === 'rascunho' ? ' <span class="selo pendente">rascunho</span>' : '');
  const ed = r.editado_em ? ` <span class="muted pr-ed" title="A versão anterior fica guardada">editado em ${new Date(r.editado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>` : '';
  return `<div class="pr-linha${aberto ? ' aberto' : ''}">
    <button type="button" class="pr-cab" data-tog="${r.id}" aria-expanded="${aberto}">
      <span class="pr-data">${data(r.data_registro)}</span>
      <span class="pr-mod">${esc(m.nome)}</span>
      <span class="pr-prof muted">${esc(me?.nome || '')}</span>
      <span class="pr-previa muted">${esc(previa(r))}</span>${selos}${ed}
    </button>
    <div class="pr-corpo">
      ${at ? `<p class="muted">Atendimento ${dh(at.inicio)}${r.origem_arquivo ? ' · ' + esc(r.origem_arquivo) : ''}</p>` : r.origem_arquivo ? `<p class="muted">${esc(r.origem_arquivo)}</p>` : ''}
      ${corpoRegistro(r)}
      ${meusAnx.length ? `<p class="muted">📎 ${meusAnx.map((a) => `<a href="#" data-abrir="${esc(a.arquivo)}" onclick="return false">${esc(a.nome || 'anexo')}</a>`).join(' · ')}</p>` : ''}
      ${meusAds.map((a) => `<div class="dica" style="margin:8px 0 0"><strong>Adendo ${dh(a.criado_em)}:</strong> ${esc(a.texto)}</div>`).join('')}
      <div class="linha-acoes pr-acoes">
        <button class="btn pequeno primario" data-edit="${r.id}">Editar</button>
        ${r.status === 'rascunho' ? `<button class="btn pequeno" data-apagar="${r.id}">Apagar</button>` : `<button class="btn pequeno" data-adendo="${r.id}">Adendo</button>`}
        <button class="btn pequeno" data-anexar="${r.id}">Anexar</button>
        <button class="btn pequeno" data-imp1="${r.id}">Imprimir</button>
        ${r.modelo === 'fisio_postural' ? `<button class="btn pequeno" data-laudo="${r.id}">🖨 Laudo com fotos</button>` : ''}
        ${r.modelo === 'dinamometria' && r.conteudo?.dina ? `<button class="btn pequeno" data-laudo="${r.id}">🖨 Laudo premium</button>` : ''}</div>
    </div></div>`;
}

function editor(p, r, meusAts, aoSalvar) {
  const m = MODELOS[r.modelo] || MODELOS.livre, c = r.conteudo || {}, med = c.medidas || {};
  const area = m.area || r.area || areaDoConselho(_eu?.conselho);
  modal(`<h3>${esc(m.nome)} — ${esc(p.nome_social || p.nome)}</h3>
    <form id="fr" class="pr-form">
      <div class="grade-form">
        <label>Data<input type="date" name="data_registro" value="${esc(r.data_registro || hojeIso())}" required></label>
        <label>Atendimento<select name="atendimento_id"><option value="">— sem vínculo —</option>
          ${meusAts.map((a) => `<option value="${a.id}" ${a.id === r.atendimento_id ? 'selected' : ''}>${dh(a.inicio)} · ${esc(a.servico || '')}</option>`).join('')}</select></label>
        ${m.medidas ? `<label>Peso (kg)<input name="m_peso" type="number" step="0.1" value="${esc(med.peso)}"></label>
          <label>Altura (cm)<input name="m_altura" type="number" step="0.1" value="${esc(med.altura)}"></label>
          <label>IMC<input id="imc" disabled value="${esc(imc(med) || '')}"></label>
          ${medidasDo(m).includes('cc') ? `<label>CC (cm)<input name="m_cc" type="number" step="0.1" value="${esc(med.cc)}"></label>` : ''}
          ${medidasDo(m).includes('gordura') ? `<label>% gordura<input name="m_gordura" type="number" step="0.1" value="${esc(med.gordura)}"></label>` : ''}` : ''}
        ${m.campos.filter((x) => x[3] === 'num').map(([k, rot]) => `<label>${esc(rot)}<input name="c_${k}" type="number" step="1" value="${esc(c[k])}"></label>`).join('')}
      </div>
      ${temRoteiro(r.modelo) ? `<details class="ck-painel" ${r.id ? '' : 'open'}><summary>⚡ ${esc(ROTEIROS[r.modelo].rotulo || 'Avaliação por cliques')} <span class="muted">— cada clique escreve o texto nos campos abaixo; o que você digitar não é apagado</span></summary><div id="ck"></div></details>` : ''}
      ${r.modelo === 'dinamometria' ? `<details class="ck-painel" open><summary>💪 Dinamometria <span class="muted">— os valores calculam assimetria, classificação e escrevem o texto abaixo</span></summary><div id="dina"></div></details>` : ''}
      ${r.modelo === 'fisio_postural' ? `<details class="ck-painel" open><summary>📷 Fotos e pontos (protocolo SAPO) <span class="muted">— as medidas escrevem o texto abaixo; a foto fica só no seu prontuário</span></summary><div id="sapo"></div></details>` : ''}
      ${m.campos.filter((x) => x[3] !== 'num').map(([k, rot, dica]) => `<label class="pr-area">${esc(rot)}
        <textarea name="c_${k}" rows="${k === 'obs' ? 2 : 4}" placeholder="${esc(dica || '')}">${esc(c[k] || '')}</textarea></label>`).join('')}
    </form>
    <p class="muted">${r.id ? 'Ao salvar, a alteração substitui o texto; a versão anterior fica guardada.' : 'Você poderá editar este registro depois.'}</p>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="salvar">Salvar</button></div>`,
  (box, fechar) => {
    box.classList.add('largo');
    const f = $('#fr', box);
    const ctx = contextoEvolucao(r);
    const painel = $('#ck', box) ? montarPainel($('#ck', box), r.modelo, f, structuredClone(c.cliques || {}), ctx) : null;
    if (r.modelo === 'fisio_evolucao' && !r.id) prepararEvolucao(p, r, f, ctx, meusAts);
    let sapo = null;
    if ($('#sapo', box)) {
      const ant = _regsPac.filter((x) => x.modelo === 'fisio_postural' && x.id !== r.id && x.conteudo?.sapo?.med)
        .sort((a, b) => String(b.data_registro).localeCompare(String(a.data_registro)))[0];
      sapo = montarSapo($('#sapo', box), f, structuredClone(c.sapo || {}), { pacienteId: p.id,
        anterior: ant ? { med: ant.conteudo.sapo.med, data: data(ant.data_registro) } : null,
        aoLaudo: () => { const fd = Object.fromEntries(new FormData(f)), cc = {}; m.campos.forEach(([k]) => { if (fd['c_' + k]) cc[k] = fd['c_' + k]; });
          laudoPostural(p, { data_registro: fd.data_registro, conteudo: { ...cc, sapo: sapo.estado() || { vistas: {} } } }, _eu); } });
    }
    let dina = null;
    if ($('#dina', box)) {
      const anterior = dinaAnterior(_regsPac, { id: r.id, data_registro: r.data_registro || hojeIso() });
      const ctxD = { area, sexo: p.sexo, idade: idade(p.data_nascimento, r.data_registro || hojeIso()), anterior };
      dina = montarDina($('#dina', box), f, structuredClone(c.dina || {}), { ...ctxD,
        aoLaudo: () => { const fd = Object.fromEntries(new FormData(f)), cc = {}; m.campos.forEach(([k]) => { if (fd['c_' + k]) cc[k] = fd['c_' + k]; });
          laudoDina(p, { data_registro: fd.data_registro, conteudo: { ...cc, medidas: { peso: fd.m_peso, altura: fd.m_altura }, dina: dina.estado() || {} } }, _eu, anterior); } });
    }
    const recalc = () => { const v = imc({ peso: +f.m_peso?.value, altura: +f.m_altura?.value }); if ($('#imc', box)) $('#imc', box).value = v || ''; };
    f.m_peso?.addEventListener('input', recalc); f.m_altura?.addEventListener('input', recalc);
    const salvar = async () => {
      const fd = Object.fromEntries(new FormData(f)), conteudo = {};
      m.campos.forEach(([k, , , t]) => { const v = fd['c_' + k]; if (v !== '' && v != null) conteudo[k] = t === 'num' ? Number(v) : v; });
      if (m.medidas) {
        const mm = {}; medidasDo(m).forEach((k) => { if (fd['m_' + k]) mm[k] = Number(fd['m_' + k]); });
        if (Object.keys(mm).length) conteudo.medidas = mm;
      }
      const sp = sapo?.estado(); if (sp) conteudo.sapo = sp;
      const dn = dina?.estado(); if (dn) conteudo.dina = dn;
      if (!Object.keys(conteudo).length) return toast('O registro está vazio.', true);
      const ck = painel?.estado(); if (ck) conteudo.cliques = ck; else if (c.cliques && painel) delete conteudo.cliques;
      const linha = { data_registro: fd.data_registro, atendimento_id: fd.atendimento_id || null, conteudo, status: 'assinado' };   // 'assinado' = status final (db/039); sem etapa de assinatura na tela
      const q = r.id ? sb.from('prontuario_registros').update(linha).eq('id', r.id)
        : sb.from('prontuario_registros').insert({ ...linha, clinica_id: estado.clinica.id, paciente_id: p.id, profissional_id: estado.profissionalId, area, modelo: r.modelo });
      const { error } = await q;
      if (error) return falha(error, 'Salvar registro');
      toast(r.id ? 'Alteração salva.' : 'Registro salvo.'); fechar(); aoSalvar();
    };
    $('#salvar', box).onclick = salvar;
  });
}

// Evolução rápida: última evolução e avaliação do mesmo paciente (só registros do próprio autor, pela RLS)
function contextoEvolucao(r) {
  const outros = _regsPac.filter((x) => x.id !== r.id);
  const ultEvol = outros.filter((x) => x.modelo === (r.modelo === 'fisio_podo' ? 'fisio_podo' : 'fisio_evolucao')).sort((a, b) => String(b.data_registro).localeCompare(String(a.data_registro)) || String(b.criado_em).localeCompare(String(a.criado_em)))[0];
  const aval = outros.filter((x) => ['fisio_avaliacao', 'fisio_esportiva'].includes(x.modelo)).sort((a, b) => String(b.data_registro).localeCompare(String(a.data_registro)))[0];
  return { ultima: ultEvol?.conteudo?.cliques || null, ultimaData: ultEvol ? data(ultEvol.data_registro) : '', avaliacao: aval?.conteudo?.cliques || null, ultEvol, aval, nEvol: outros.filter((x) => x.modelo === 'fisio_evolucao').length };
}
// Nº da sessão e diagnóstico/CID preenchidos sozinhos (encaminhamento ativo de fisioterapia > diagnóstico da avaliação > última evolução)
async function prepararEvolucao(p, r, f, ctx, meusAts) {
  if (f.elements.c_sessao && !f.elements.c_sessao.value) f.elements.c_sessao.value = (Number(ctx.ultEvol?.conteudo?.sessao) || ctx.nEvol) + 1;
  const campo = f.elements.c_diag; if (!campo || campo.value) return;
  let txt = '';
  const { data: encs } = await sb.from('encaminhamentos').select('cid, indicacao_clinica, data_pedido, validade').eq('paciente_id', p.id)
    .eq('area', 'fisioterapia').eq('status', 'ativo').order('data_pedido', { ascending: false }).limit(1);
  const en = encs?.[0];
  if (en?.cid || en?.indicacao_clinica) {
    const desc = en.indicacao_clinica || (en.cid ? await descricaoCid(en.cid).catch(() => '') : '');
    txt = `${en.cid ? 'CID ' + en.cid : ''}${en.cid && desc ? ' — ' : ''}${desc || ''} (encaminhamento de ${data(en.data_pedido)})`;
  }
  const dAval = ctx.aval?.conteudo?.diagnostico;
  if (dAval) txt = [txt, `Fisioterapêutico (avaliação de ${data(ctx.aval.data_registro)}): ${dAval}`].filter(Boolean).join('\n');
  if (!txt) txt = ctx.ultEvol?.conteudo?.diag || '';
  if (txt && !campo.value) campo.value = txt;
}

function adendo(registroId, aoSalvar) {
  modal(`<h3>Adendo</h3><p class="muted">O adendo fica datado e anexado ao registro.</p>
    <textarea id="txt" rows="5" style="width:100%"></textarea>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Salvar adendo</button></div>`, (box, fechar) => {
    $('#ok', box).onclick = async () => {
      const texto = $('#txt', box).value.trim(); if (!texto) return toast('Escreva o adendo.', true);
      const { error } = await sb.from('prontuario_adendos').insert({ registro_id: registroId, clinica_id: estado.clinica.id, profissional_id: estado.profissionalId, texto });
      if (error) return falha(error, 'Adendo'); toast('Adendo salvo.'); fechar(); aoSalvar();
    };
  });
}

// Impressão / exportação para o paciente
function imprimir(p, regs, ads, me) {
  const j = window.open('', '_blank'); if (!j) return falha('Permita pop-ups deste site para imprimir.');
  const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  j.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prontuário — ${esc(p.nome)}</title><style>
    @page{size:A4;margin:16mm} body{font:11pt/1.45 Arial,sans-serif;color:#222;margin:0}
    header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #F8781D;padding-bottom:8px;margin-bottom:14px}
    header img{height:42px} h1{font-size:14pt;margin:0} .reg{border-top:1px solid #ccc;padding:10px 0;page-break-inside:avoid}
    .rot{font-weight:bold;margin-top:6px} .txt{white-space:pre-wrap} .ad{background:#f4f4f4;padding:6px;margin-top:6px}
    footer{margin-top:18px;font-size:9pt;color:#666;border-top:1px solid #ccc;padding-top:6px} .bt{position:fixed;top:8px;right:8px} @media print{.bt{display:none}}
  </style></head><body><button class="bt" onclick="print()">Imprimir / salvar PDF</button>
  <header><img src="${base}logo.png" alt="Cure"><div style="text-align:right"><h1>Prontuário — ${esc(AREA_NOME[areaDoConselho(me?.conselho)] || '')}</h1>
    ${esc(me?.nome)} · ${esc(me?.conselho || '')} ${esc(me?.numero_conselho || '')}${me?.uf_conselho ? '/' + esc(me.uf_conselho) : ''}</div></header>
  <p><strong>Paciente:</strong> ${esc(p.nome_social || p.nome)}${p.data_nascimento ? ` · <strong>Nascimento:</strong> ${data(p.data_nascimento)}` : ''}${p.cpf ? ` · <strong>CPF:</strong> ${esc(p.cpf)}` : ''}</p>
  ${regs.map((r) => `<div class="reg"><strong>${data(r.data_registro)} — ${esc((MODELOS[r.modelo] || MODELOS.livre).nome)}</strong>
    ${corpoRegistro(r).replace(/class="pr-rot"/g, 'class="rot"').replace(/class="pr-txt"/g, 'class="txt"')}
    ${(ads || []).filter((a) => a.registro_id === r.id).map((a) => `<div class="ad"><strong>Adendo ${dh(a.criado_em)}:</strong> ${esc(a.texto)}</div>`).join('')}
    <div style="font-size:9pt;color:#666;margin-top:4px">${r.origem === 'sistema_antigo' ? 'Importado do sistema anterior' : `Registrado em ${dh(r.assinado_em || r.criado_em)}${r.editado_em ? ` · editado em ${dh(r.editado_em)}` : ''} · verificação ${esc((r.hash_assinatura || '').slice(0, 16))}`}</div></div>`).join('')}
  <footer>Clínica Cure — Saúde e Desempenho · Documento gerado pelo Cure OS em ${dh(new Date())}. Informação sigilosa.</footer></body></html>`);
  j.document.close();
}

// ---------------------------------------------------------------- rota #prontuarios
export async function render() {
  const c = tela('Meus prontuários', estado.profissionalId ? '<button class="btn" id="btn-imp">Importar prontuários antigos</button>' : '');
  if (!estado.profissionalId) { c.innerHTML = SEM_ACESSO; return; }
  const { data: lista, error } = await sb.rpc('meus_pacientes_prontuario', { p_clinica: estado.clinica.id });
  if (error) return falha(error);
  lista.sort((a, b) => (b.rascunhos - a.rascunhos) || String(b.ultimo_atendimento || b.ultimo_registro || '').localeCompare(String(a.ultimo_atendimento || a.ultimo_registro || '')));
  const linhas = (filtro) => lista.filter((x) => !filtro || x.nome.toLowerCase().includes(filtro)).slice(0, 300).map((x) => `<tr>
    <td><a href="#paciente-${x.paciente_id}-prontuario">${esc(x.nome)}</a></td><td>${x.ultimo_atendimento ? dh(x.ultimo_atendimento) : '—'}</td>
    <td>${x.ultimo_registro ? data(x.ultimo_registro) : '—'}</td><td class="num">${x.registros}</td>
    <td>${x.rascunhos ? `<span class="selo pendente">${x.rascunhos} rascunho(s)</span>` : ''}</td></tr>`).join('');
  c.innerHTML = `<div class="cartao"><input id="busca" placeholder="Buscar paciente" style="max-width:320px">
    <span class="muted" style="margin-left:10px">${lista.length} pacientes atendidos por você ou com prontuário seu · 🔒 só você vê</span></div>
    <div class="cartao"><table><thead><tr><th>Paciente</th><th>Último atendimento</th><th>Último registro</th><th class="num">Registros</th><th></th></tr></thead>
    <tbody id="tb">${linhas('')}</tbody></table></div>`;
  $('#busca').oninput = (e) => ($('#tb').innerHTML = linhas(e.target.value.trim().toLowerCase()));
  $('#btn-imp').onclick = importar;
}

// Importação dos .txt do sistema antigo: nome = profissional.paciente.serviço.txt (paciente = ID antigo).
// Autoria = quem está logado; por isso cada profissional importa os SEUS arquivos.
const areaDoServico = (s) => (/nutri/i.test(s) ? 'nutricao' : /psic/i.test(s) ? 'psicologia' : /fisio|rpg|pilates|palmilha|baropod/i.test(s) ? 'fisioterapia' : 'outra');
function decodificar(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
function ultimaData(txt) {
  const ds = [...txt.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(([, d, m, a]) => `${a}-${m}-${d}`)
    .filter((x) => x >= '1990-01-01' && x <= hojeIso() && !isNaN(new Date(x)));
  return ds.sort().pop() || null;
}

function importar() {
  modal(`<h3>Importar prontuários antigos</h3>
    <p class="muted">Escolha a pasta (ou os arquivos .txt) do sistema antigo. Os arquivos têm o nome <code>profissional.paciente.serviço.txt</code>.
      Marque <strong>só os seus</strong>: o registro será gravado como seu e marcado "sistema antigo". Reimportar não duplica.</p>
    <div class="linha-acoes" style="justify-content:flex-start"><label class="btn">Escolher pasta<input type="file" id="fpasta" webkitdirectory hidden></label>
      <label class="btn">Escolher arquivos<input type="file" id="farq" multiple accept=".txt" hidden></label></div>
    <div id="prev"></div>
    <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button><button class="btn primario" id="go" disabled>Importar</button></div>`, (box) => {
    let arquivos = [];
    const carregar = (lista) => {
      arquivos = [...lista].filter((f) => /\.txt$/i.test(f.name)).map((f) => {
        const partes = f.name.replace(/\.txt$/i, '').split('.');
        return { f, prof: partes[0], pac: partes[1], serv: partes.slice(2).join('.') };
      }).filter((a) => a.prof && a.pac);
      const grupos = Object.entries(arquivos.reduce((g, a) => ((g[a.prof] = (g[a.prof] || 0) + 1), g), {})).sort((a, b) => b[1] - a[1]);
      $('#prev', box).innerHTML = arquivos.length ? `<p><strong>${arquivos.length}</strong> arquivos. Quais prefixos de profissional são seus?</p>
        ${grupos.map(([k, n]) => `<label style="display:block"><input type="checkbox" data-prof="${esc(k)}"> <strong>${esc(k)}</strong> — ${n} arquivo(s)</label>`).join('')}
        <pre id="amostra" class="muted" style="white-space:pre-wrap;max-height:160px;overflow:auto"></pre>`
        : '<div class="vazio">Nenhum .txt no formato esperado.</div>';
      $$('[data-prof]', box).forEach((cb) => (cb.onchange = async () => {
        const sel = $$('[data-prof]:checked', box).map((x) => x.dataset.prof);
        $('#go', box).disabled = !sel.length;
        const ex = arquivos.find((a) => a.prof === cb.dataset.prof);
        if (cb.checked && ex) $('#amostra', box).textContent = `Amostra (${ex.f.name}):\n` + decodificar(await ex.f.arrayBuffer()).slice(0, 400);
      }));
    };
    $('#fpasta', box).onchange = (e) => carregar(e.target.files);
    $('#farq', box).onchange = (e) => carregar(e.target.files);
    $('#go', box).onclick = async () => {
      const sel = new Set($$('[data-prof]:checked', box).map((x) => x.dataset.prof));
      const fila = arquivos.filter((a) => sel.has(a.prof));
      if (!(await confirmar(`Importar ${fila.length} arquivo(s) como registros SEUS? Confira se os prefixos marcados são realmente seus.`, 'Importar'))) return;
      const cont = { importado: 0, ja_importado: 0, paciente_nao_encontrado: 0, erro: 0 }, falhas = [];
      $('#go', box).disabled = true;
      let i = 0;
      const trabalhador = async () => {
        while (i < fila.length) {
          const a = fila[i++];
          try {
            const texto = decodificar(await a.f.arrayBuffer());
            const dataReg = ultimaData(texto) || new Date(a.f.lastModified).toISOString().slice(0, 10);
            const { data: r, error } = await sb.rpc('importar_prontuario_antigo', { p_clinica: estado.clinica.id, p_origem_id: a.pac,
              p_arquivo: a.f.name, p_texto: texto, p_data: dataReg, p_area: areaDoServico(a.serv) });
            if (error) throw error;
            cont[r] = (cont[r] || 0) + 1; if (r === 'paciente_nao_encontrado') falhas.push(a.f.name);
          } catch (e) { cont.erro++; falhas.push(`${a.f.name}: ${e.message}`); }
          $('#prev', box).innerHTML = `<p>Importando… ${i}/${fila.length}</p>`;
        }
      };
      await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
      $('#prev', box).innerHTML = `<p>✅ Importados: <strong>${cont.importado}</strong> · já existiam: ${cont.ja_importado} ·
        paciente não encontrado: ${cont.paciente_nao_encontrado} · erros: ${cont.erro}</p>
        ${falhas.length ? `<details><summary>Ver ${falhas.length} arquivo(s) não importados</summary><pre style="white-space:pre-wrap">${esc(falhas.join('\n'))}</pre></details>` : ''}`;
    };
  });
}
