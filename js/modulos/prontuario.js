// Módulo Prontuário (db/023). Sigilo: cada profissional lê e escreve SÓ os próprios registros (RLS por autor).
// Modelos por área + campo livre; assinado continua editável (db/024 guarda a versão anterior em prontuario_versoes); anexos no bucket "prontuario".
// Duas entradas: aba "Prontuário" da ficha do paciente (abaProntuario) e rota #prontuarios (meus pacientes + importação dos .txt antigos).
import { sb, estado, $, $$, esc, data, tela, toast, falha, modal, confirmar } from '../core.js';
import { enviarArquivo, abrirArquivo, escolherArquivo } from './documentos.js';

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
    ['diagnostico', 'Diagnóstico e prognóstico fisioterapêutico', 'Cinético-funcional'],
    ['objetivos', 'Objetivos terapêuticos'], ['plano', 'Plano terapêutico', 'Condutas, frequência, nº de sessões previsto'], OBS] },
  fisio_evolucao: { nome: 'Evolução de sessão (fisioterapia)', area: 'fisioterapia', campos: [
    ['sessao', 'Sessão nº', '', 'num'], ['eva_pre', 'EVA antes', '', 'num'], ['eva_pos', 'EVA depois', '', 'num'],
    ['condutas', 'Condutas realizadas'], ['resposta', 'Resposta do paciente / intercorrências'], ['proxima', 'Ajuste para a próxima sessão'], OBS] },
  psico_registro: { nome: 'Registro documental (psicologia)', area: 'psicologia', campos: [
    ['demanda', 'Avaliação de demanda'], ['objetivos', 'Objetivos do trabalho'], ['evolucao', 'Registro da evolução'],
    ['procedimentos', 'Procedimentos técnico-científicos adotados'], ['encaminhamento', 'Encaminhamento ou encerramento'], OBS] },
  livre: { nome: 'Registro livre', area: null, campos: [['texto', 'Texto']] },
};
const AREA_NOME = { nutricao: 'Nutrição', fisioterapia: 'Fisioterapia', psicologia: 'Psicologia', outra: 'Outra' };
const areaDoConselho = (c) => ({ CRN: 'nutricao', CREFITO: 'fisioterapia', CRP: 'psicologia' }[String(c || '').toUpperCase()] || 'outra');
const hojeIso = () => new Date().toISOString().slice(0, 10);
const dh = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const imc = (m) => (m?.peso && m?.altura ? (m.peso / (m.altura / 100) ** 2).toFixed(1) : null);

let _eu;   // cadastro do profissional logado (nome, conselho)
async function eu() {
  if (_eu?.id === estado.profissionalId) return _eu;
  const { data: p } = await sb.from('profissionais').select('id, nome, conselho, numero_conselho, uf_conselho').eq('id', estado.profissionalId).single();
  return (_eu = p);
}

const SEM_ACESSO = `<div class="cartao vazio">🔒 O prontuário é sigiloso: cada profissional vê só o que ele mesmo registrou.
  Seu acesso não está ligado a um cadastro de profissional, então nenhum conteúdo clínico aparece aqui.</div>`;

// ---------------------------------------------------------------- aba da ficha
export async function abaProntuario(alvo, p, ats, extra) {
  if (!estado.profissionalId) { alvo.innerHTML = SEM_ACESSO; return; }
  const cid = estado.clinica.id, me = await eu();
  const minhaArea = areaDoConselho(me?.conselho);
  const [{ data: regs, error }, { data: ads }, { data: anx }] = await Promise.all([
    sb.from('prontuario_registros').select('*').eq('paciente_id', p.id).order('data_registro', { ascending: false }).order('criado_em', { ascending: false }),
    sb.from('prontuario_adendos').select('*').eq('clinica_id', cid).order('criado_em'),
    sb.from('prontuario_anexos').select('*').eq('clinica_id', cid).order('criado_em'),
  ]);
  if (error) return falha(error, 'Prontuário');
  const meusAts = (ats || []).filter((a) => a.profissional_id === estado.profissionalId && ['atendido', 'presente'].includes(a.status));
  const semRegistro = meusAts.filter((a) => !(regs || []).some((r) => r.atendimento_id === a.id));
  const recarregar = () => abaProntuario(alvo, p, ats);
  const modelosArea = Object.entries(MODELOS).filter(([, m]) => !m.area || m.area === minhaArea || minhaArea === 'outra');

  alvo.innerHTML = `
    <div class="cartao"><div class="linha-acoes" style="justify-content:space-between;margin:0">
      <span class="muted">🔒 Só você vê estes registros · ${esc(me?.nome)} ${esc(me?.conselho || '')} ${esc(me?.numero_conselho || '')}</span>
      <span><select id="mod">${modelosArea.map(([k, m]) => `<option value="${k}">${esc(m.nome)}</option>`).join('')}</select>
        <button class="btn primario" id="novo">Novo registro</button>
        ${(regs || []).some((r) => r.status === 'assinado') ? '<button class="btn" id="imp">Imprimir prontuário</button>' : ''}</span></div>
      ${semRegistro.length ? `<div class="dica" style="margin:10px 0 0">⚠️ ${semRegistro.length} atendimento(s) seu(s) sem evolução registrada:
        ${semRegistro.slice(0, 6).map((a) => `<a href="#" data-evol="${a.id}">${dh(a.inicio)}</a>`).join(' · ')}</div>` : ''}
    </div>
    ${(regs || []).length ? regs.map((r) => cartaoRegistro(r, ads, anx, ats)).join('') : '<div class="cartao vazio">Nenhum registro seu para este paciente.</div>'}`;

  $('#novo', alvo).onclick = () => editor(p, { modelo: $('#mod', alvo).value }, meusAts, recarregar);
  $$('[data-evol]', alvo).forEach((b) => (b.onclick = (e) => {
    e.preventDefault();
    const at = meusAts.find((a) => a.id === b.dataset.evol);
    editor(p, { modelo: modeloSessao(minhaArea, regs), atendimento_id: at.id, data_registro: at.inicio.slice(0, 10) }, meusAts, recarregar);
  }));
  $('#imp', alvo)?.addEventListener('click', () => imprimir(p, regs.filter((r) => r.status === 'assinado'), ads, me));
  $$('[data-edit]', alvo).forEach((b) => (b.onclick = () => editor(p, regs.find((r) => r.id === b.dataset.edit), meusAts, recarregar)));
  $$('[data-apagar]', alvo).forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('Apagar este rascunho? Ele ainda não foi assinado.', 'Apagar'))) return;
    const { error: e } = await sb.from('prontuario_registros').delete().eq('id', b.dataset.apagar);
    if (e) return falha(e); toast('Rascunho apagado.'); recarregar();
  }));
  $$('[data-assinar]', alvo).forEach((b) => (b.onclick = async () => {
    if (await assinar(b.dataset.assinar)) recarregar();
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

  // Vindo da agenda (#paciente-<id>-prontuario:<atendimento>): abre a evolução já ligada ao atendimento
  if (extra) {
    const ja = (regs || []).find((r) => r.atendimento_id === extra);
    const at = meusAts.find((a) => a.id === extra);
    if (ja?.status === 'rascunho') editor(p, ja, meusAts, recarregar);
    else if (!ja && at) editor(p, { modelo: modeloSessao(minhaArea, regs), atendimento_id: at.id, data_registro: at.inicio.slice(0, 10) }, meusAts, recarregar);
  }
}

// Fisio: 1º registro = avaliação, depois evolução. Nutri = SOAPN. Psico = registro documental.
function modeloSessao(area, regs) {
  if (area === 'fisioterapia') return (regs || []).some((r) => r.modelo === 'fisio_avaliacao') ? 'fisio_evolucao' : 'fisio_avaliacao';
  return { nutricao: 'soapn', psicologia: 'psico_registro' }[area] || 'livre';
}

function corpoRegistro(r) {
  const m = MODELOS[r.modelo] || MODELOS.livre, c = r.conteudo || {};
  const med = m.medidas && c.medidas ? Object.entries({ Peso: c.medidas.peso && c.medidas.peso + ' kg', Altura: c.medidas.altura && c.medidas.altura + ' cm',
    IMC: imc(c.medidas) && imc(c.medidas) + ' kg/m²', CC: c.medidas.cc && c.medidas.cc + ' cm', '% gordura': c.medidas.gordura && c.medidas.gordura + '%' })
    .filter(([, v]) => v).map(([k, v]) => `<strong>${k}:</strong> ${esc(v)}`).join(' · ') : '';
  return (med ? `<p>${med}</p>` : '') + m.campos.filter(([k]) => c[k] !== undefined && String(c[k]).trim() !== '')
    .map(([k, rot]) => `<div class="pr-campo"><div class="pr-rot">${esc(rot)}</div><div class="pr-txt">${esc(c[k])}</div></div>`).join('');
}

function cartaoRegistro(r, ads, anx, ats) {
  const m = MODELOS[r.modelo] || MODELOS.livre, at = (ats || []).find((a) => a.id === r.atendimento_id);
  const meusAds = (ads || []).filter((a) => a.registro_id === r.id), meusAnx = (anx || []).filter((a) => a.registro_id === r.id);
  const selo = r.origem === 'sistema_antigo' ? '<span class="selo outra">sistema antigo</span>'
    : r.status === 'assinado' ? `<span class="selo ok" title="Hash ${esc(r.hash_assinatura)}">✓ assinado ${dh(r.assinado_em)}</span>` : '<span class="selo pendente">rascunho</span>';
  const ed = r.editado_em ? ` <span class="selo outra" title="A versão anterior fica guardada">editado ${dh(r.editado_em)}</span>` : '';
  return `<div class="cartao pr-registro">
    <div class="linha-acoes" style="justify-content:space-between;margin:0 0 8px">
      <span><strong>${data(r.data_registro)}</strong> · ${esc(m.nome)}${r.origem_arquivo ? ` · <span class="muted">${esc(r.origem_arquivo)}</span>` : ''}
        ${at ? ` · <span class="muted">atendimento ${dh(at.inicio)}</span>` : ''} ${selo}${ed}</span>
      <span>${r.status === 'rascunho' ? `<button class="btn pequeno" data-edit="${r.id}">Editar</button>
          <button class="btn pequeno primario" data-assinar="${r.id}">Assinar</button>
          <button class="btn pequeno" data-apagar="${r.id}">Apagar</button>`
        : `<button class="btn pequeno" data-edit="${r.id}">Editar</button> <button class="btn pequeno" data-adendo="${r.id}">Adendo</button> <button class="btn pequeno" data-imp1="${r.id}">Imprimir</button>`}
        <button class="btn pequeno" data-anexar="${r.id}">Anexar</button></span></div>
    ${corpoRegistro(r)}
    ${meusAnx.length ? `<p class="muted">📎 ${meusAnx.map((a) => `<a href="#" data-abrir="${esc(a.arquivo)}" onclick="return false">${esc(a.nome || 'anexo')}</a>`).join(' · ')}</p>` : ''}
    ${meusAds.map((a) => `<div class="dica" style="margin:8px 0 0"><strong>Adendo ${dh(a.criado_em)}:</strong> ${esc(a.texto)}</div>`).join('')}
  </div>`;
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
          <label>CC (cm)<input name="m_cc" type="number" step="0.1" value="${esc(med.cc)}"></label>
          <label>% gordura<input name="m_gordura" type="number" step="0.1" value="${esc(med.gordura)}"></label>` : ''}
        ${m.campos.filter((x) => x[3] === 'num').map(([k, rot]) => `<label>${esc(rot)}<input name="c_${k}" type="number" step="1" value="${esc(c[k])}"></label>`).join('')}
      </div>
      ${m.campos.filter((x) => x[3] !== 'num').map(([k, rot, dica]) => `<label class="pr-area">${esc(rot)}
        <textarea name="c_${k}" rows="${k === 'obs' ? 2 : 4}" placeholder="${esc(dica || '')}">${esc(c[k] || '')}</textarea></label>`).join('')}
    </form>
    <p class="muted">${r.status === 'assinado' ? 'Registro já assinado: a alteração fica com a data de edição e a versão anterior é guardada.' : 'Rascunho pode ser editado à vontade. Assinado também pode ser corrigido; a versão anterior fica guardada.'}</p>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button>
      ${r.status === 'assinado' ? '<button class="btn primario" id="rasc">Salvar alteração</button>'
        : '<button class="btn" id="rasc">Salvar rascunho</button><button class="btn primario" id="ass">Salvar e assinar</button>'}</div>`,
  (box, fechar) => {
    box.classList.add('largo');
    const f = $('#fr', box);
    const recalc = () => { const v = imc({ peso: +f.m_peso?.value, altura: +f.m_altura?.value }); if ($('#imc', box)) $('#imc', box).value = v || ''; };
    f.m_peso?.addEventListener('input', recalc); f.m_altura?.addEventListener('input', recalc);
    const salvar = async (assinarJa) => {
      const fd = Object.fromEntries(new FormData(f)), conteudo = {};
      m.campos.forEach(([k, , , t]) => { const v = fd['c_' + k]; if (v !== '' && v != null) conteudo[k] = t === 'num' ? Number(v) : v; });
      if (m.medidas) {
        const mm = {}; ['peso', 'altura', 'cc', 'gordura'].forEach((k) => { if (fd['m_' + k]) mm[k] = Number(fd['m_' + k]); });
        if (Object.keys(mm).length) conteudo.medidas = mm;
      }
      if (!Object.keys(conteudo).length) return toast('O registro está vazio.', true);
      const linha = { data_registro: fd.data_registro, atendimento_id: fd.atendimento_id || null, conteudo, ...(assinarJa ? { status: 'assinado' } : {}) };
      const q = r.id ? sb.from('prontuario_registros').update(linha).eq('id', r.id)
        : sb.from('prontuario_registros').insert({ ...linha, clinica_id: estado.clinica.id, paciente_id: p.id, profissional_id: estado.profissionalId, area, modelo: r.modelo });
      const { error } = await q;
      if (error) return falha(error, 'Salvar registro');
      toast(assinarJa ? 'Registro assinado.' : r.status === 'assinado' ? 'Alteração salva.' : 'Rascunho salvo.'); fechar(); aoSalvar();
    };
    $('#rasc', box).onclick = () => salvar(false);
    // Confirmação no próprio botão (o confirmar() trocaria o conteúdo do modal e perderia o texto)
    const bAss = $('#ass', box);
    if (bAss) bAss.onclick = () => {
      if (bAss.dataset.armado) return salvar(true);
      bAss.dataset.armado = '1'; bAss.textContent = 'Confirmar: assinar e bloquear';
      setTimeout(() => { delete bAss.dataset.armado; bAss.textContent = 'Salvar e assinar'; }, 5000);
    };
  });
}

async function assinar(id) {
  if (!(await confirmar('Assinar este registro? Depois de assinado ele não pode mais ser alterado.', 'Assinar'))) return false;
  const { error } = await sb.from('prontuario_registros').update({ status: 'assinado' }).eq('id', id);
  if (error) { falha(error, 'Assinar'); return false; }
  toast('Registro assinado.'); return true;
}

function adendo(registroId, aoSalvar) {
  modal(`<h3>Adendo</h3><p class="muted">O registro original não muda. O adendo fica datado e também não pode ser alterado.</p>
    <textarea id="txt" rows="5" style="width:100%"></textarea>
    <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Salvar adendo</button></div>`, (box, fechar) => {
    $('#ok', box).onclick = async () => {
      const texto = $('#txt', box).value.trim(); if (!texto) return toast('Escreva o adendo.', true);
      const { error } = await sb.from('prontuario_adendos').insert({ registro_id: registroId, clinica_id: estado.clinica.id, profissional_id: estado.profissionalId, texto });
      if (error) return falha(error, 'Adendo'); toast('Adendo salvo.'); fechar(); aoSalvar();
    };
  });
}

// Impressão / exportação para o paciente (só registros assinados)
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
    <div style="font-size:9pt;color:#666;margin-top:4px">${r.origem === 'sistema_antigo' ? 'Importado do sistema anterior' : `Assinado eletronicamente em ${dh(r.assinado_em)} · verificação ${esc((r.hash_assinatura || '').slice(0, 16))}`}</div></div>`).join('')}
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
      Marque <strong>só os seus</strong>: o registro será gravado como seu, assinado e marcado "sistema antigo". Reimportar não duplica.</p>
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
