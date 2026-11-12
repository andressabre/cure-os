// Emissão de documentos timbrados (db/024): atestado, declaração de comparecimento/acompanhante,
// orientação de alta, relatório ao médico, orientações e livre. Modelos padrão aqui + modelos próprios (documento_modelos).
// Sigilo: documento clínico só o autor vê; declarações sem dado clínico também recepção/gestão.
// Documento emitido pode ser editado (mesmo código de verificação), excluído, salvo sem imprimir ou reimpresso (db/039).
import { sb, estado, $, $$, esc, toast, falha, modal, confirmar } from '../core.js';

const REGIAO = { SC: { CRN: '10', CREFITO: '10', CRP: '12' } };
export const conselhoFmt = (p) => {
  if (!p?.conselho) return '';
  const r = REGIAO[p.uf_conselho]?.[p.conselho];
  return `${p.conselho}${r ? '-' + r : p.uf_conselho ? '/' + p.uf_conselho : ''} ${p.numero_conselho || ''}`.trim();
};
const AREA_CONS = { CRN: 'Nutrição', CREFITO: 'Fisioterapia', CRP: 'Psicologia', CRM: 'Medicina' };
const PROF_TITULO = { CRN: 'Nutricionista', CREFITO: 'Fisioterapeuta', CRP: 'Psicóloga(o)', CRM: 'Médica(o)' };
const EXT = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze'];
const dBr = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00' : iso).toLocaleDateString('pt-BR') : '____/____/______');
const hBr = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const extenso = (d = new Date()) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

export const TIPOS = {
  atestado: { nome: 'Atestado', titulo: 'Atestado', clinico: true,
    corpo: 'Atesto, para os devidos fins, que {paciente}{cpf_frase} esteve sob meus cuidados profissionais em {data}{horario_frase}, necessitando de afastamento de suas atividades por {dias} ({dias_extenso}) dia(s), a partir desta data.{cid_frase}' },
  comparecimento: { nome: 'Declaração de comparecimento', titulo: 'Declaração de comparecimento',
    corpo: 'Declaro, para os devidos fins, que {paciente}{cpf_frase} compareceu à Clínica Cure em {data}{horario_frase}, para atendimento de {area}.' },
  acompanhante: { nome: 'Declaração de acompanhante', titulo: 'Declaração de acompanhante',
    corpo: 'Declaro, para os devidos fins, que {acompanhante} esteve na Clínica Cure em {data}{horario_frase}, acompanhando {paciente} em atendimento de {area}.' },
  alta: { nome: 'Orientação de alta', titulo: 'Orientações de alta', clinico: true,
    corpo: `{paciente} concluiu o tratamento de {area} na Clínica Cure, com {sessoes} atendimentos realizados entre {primeira} e {ultima}.

Motivo do tratamento:
Evolução:
Condição na alta:

Orientações para casa:
• Manter os exercícios orientados, ____ vezes por semana.
• Aumentar carga e intensidade das atividades de forma gradual, sem dor.
• Em caso de dor após esforço, aplicar gelo por 15 a 20 minutos.

Procure novamente a clínica ou o seu médico se houver:
• dor que piora ou não melhora com repouso;
• inchaço, perda de força, formigamento ou dificuldade de movimento;
• retorno dos sintomas que motivaram o tratamento.` },
  relatorio: { nome: 'Relatório ao médico', titulo: 'Relatório', clinico: true,
    corpo: `Prezado(a) Dr(a). ____________________,

Informo que {paciente}{cpf_frase} está em acompanhamento de {area} na Clínica Cure desde {primeira}, com {sessoes} atendimentos realizados até {hoje}.

Quadro inicial:
Conduta:
Evolução:
Conclusão / solicitação:

Coloco-me à disposição para esclarecimentos.` },
  orientacoes: { nome: 'Orientações ao paciente', titulo: 'Orientações', clinico: true, corpo: 'Orientações para {paciente}:\n\n• \n• \n• ' },
  livre: { nome: 'Documento livre', titulo: 'Declaração', clinico: true, corpo: '' },
};
const SO_RECEPCAO = ['comparecimento', 'acompanhante'];

function preencher(modelo, v) {
  return modelo.replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
}

let _clin;
async function timbrado() {
  if (_clin) return _clin;
  const { data } = await sb.from('clinicas').select('config').eq('id', estado.clinica.id).single();
  return (_clin = data?.config?.timbrado || {});
}

// ---------------------------------------------------------------- aba "Documentos" da ficha
export async function abaDocumentos(alvo, p, ats) {
  const cid = estado.clinica.id, souProf = !!estado.profissionalId;
  const ehRecepcao = ['gestor', 'recepcao', 'financeiro'].includes(estado.perfil);
  const [{ data: eu }, { data: emitidos, error }, { data: modelos }] = await Promise.all([
    souProf ? sb.from('profissionais').select('id, nome, conselho, numero_conselho, uf_conselho, especialidade').eq('id', estado.profissionalId).single() : Promise.resolve({ data: null }),
    sb.from('documentos_emitidos').select('*, profissionais(nome)').eq('paciente_id', p.id).order('emitido_em', { ascending: false }),
    sb.from('documento_modelos').select('*').eq('clinica_id', cid).order('titulo'),
  ]);
  if (error) return falha(error, 'Documentos');
  const tiposOk = Object.entries(TIPOS).filter(([k]) => souProf || (ehRecepcao && SO_RECEPCAO.includes(k)));
  const recarregar = () => abaDocumentos(alvo, p, ats);
  const meusModelos = souProf ? (modelos || []).filter((m) => m.profissional_id === estado.profissionalId) : [];
  const podeMexer = (d) => (d.profissional_id ? d.profissional_id === estado.profissionalId : ehRecepcao && SO_RECEPCAO.includes(d.tipo));
  alvo.innerHTML = `<div class="cartao"><div class="linha-acoes" style="justify-content:space-between;margin:0">
      <span class="muted">${souProf ? 'Documentos com conteúdo clínico ficam visíveis só para você.' : 'A recepção emite declarações de comparecimento e de acompanhante.'}</span>
      <span>${tiposOk.map(([k, t]) => `<button class="btn" data-novo="${k}">${esc(t.nome)}</button>`).join(' ')}
        ${meusModelos.map((m) => `<button class="btn" data-mod="${m.id}">★ ${esc(m.titulo)}</button>`).join(' ')}</span></div></div>
    <div class="cartao"><h3>Emitidos</h3>${(emitidos || []).length ? `<table><thead><tr><th>Data</th><th>Documento</th><th>Profissional</th><th>Código</th><th></th></tr></thead><tbody>
      ${emitidos.map((d) => `<tr><td>${new Date(d.emitido_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(d.titulo)}</td>
        <td>${esc(d.profissionais?.nome || 'Recepção')}</td><td><code>${esc(d.codigo)}</code></td>
        <td class="doc-acoes"><button class="btn pequeno" data-reimp="${d.id}">Imprimir</button>
          ${podeMexer(d) ? `<button class="btn pequeno" data-edit="${d.id}">Editar</button><button class="btn pequeno" data-del="${d.id}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio">Nenhum documento emitido.</div>'}</div>
    ${souProf ? `<div class="cartao"><h3>Meus modelos</h3>
      <p class="muted">Modelos salvos (botão "Salvar texto como meu modelo" ao preparar um documento) aparecem aqui e como botões ★ no topo desta aba. Só você os vê.</p>
      ${meusModelos.length ? `<table><thead><tr><th>Modelo</th><th>Tipo</th><th></th></tr></thead><tbody>
        ${meusModelos.map((m) => `<tr><td>★ ${esc(m.titulo)}</td><td>${esc(TIPOS[m.tipo]?.nome || m.tipo)}</td>
          <td class="doc-acoes"><button class="btn pequeno" data-usar="${m.id}">Usar</button><button class="btn pequeno" data-ren="${m.id}">Renomear</button>
            <button class="btn pequeno" data-delmod="${m.id}">Excluir</button></td></tr>`).join('')}</tbody></table>`
        : '<div class="vazio">Nenhum modelo salvo ainda.</div>'}</div>` : ''}`;

  $$('[data-novo]', alvo).forEach((b) => (b.onclick = () => editor(p, ats, eu, b.dataset.novo, null, recarregar)));
  $$('[data-mod],[data-usar]', alvo).forEach((b) => (b.onclick = () => {
    const m = modelos.find((x) => x.id === (b.dataset.mod || b.dataset.usar)); editor(p, ats, eu, m.tipo, m, recarregar);
  }));
  $$('[data-edit]', alvo).forEach((b) => (b.onclick = () => {
    const d = emitidos.find((x) => x.id === b.dataset.edit); editor(p, ats, eu, d.tipo, null, recarregar, d);
  }));
  $$('[data-del]', alvo).forEach((b) => (b.onclick = async () => {
    const d = emitidos.find((x) => x.id === b.dataset.del);
    if (!(await confirmar(`Excluir "${d.titulo}" (código ${d.codigo})? O código deixará de ser válido na verificação pública.`, 'Excluir'))) return;
    const { error: e } = await sb.from('documentos_emitidos').delete().eq('id', d.id);
    if (e) return falha(e, 'Excluir documento'); toast('Documento excluído.'); recarregar();
  }));
  $$('[data-reimp]', alvo).forEach((b) => (b.onclick = async () => {
    const d = emitidos.find((x) => x.id === b.dataset.reimp);
    imprimirDoc(d, await profDoc(d, eu), await timbrado());
  }));
  $$('[data-ren]', alvo).forEach((b) => (b.onclick = () => {
    const m = modelos.find((x) => x.id === b.dataset.ren);
    modal(`<h3>Renomear modelo</h3><input id="nm" value="${esc(m.titulo)}" style="width:100%">
      <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ok">Salvar</button></div>`, (box, fechar) => {
      $('#ok', box).onclick = async () => {
        const titulo = $('#nm', box).value.trim(); if (!titulo) return toast('Informe o nome.', true);
        const { error: e } = await sb.from('documento_modelos').update({ titulo }).eq('id', m.id);
        if (e) return falha(e, 'Renomear modelo'); toast('Modelo renomeado.'); fechar(); recarregar();
      };
    });
  }));
  $$('[data-delmod]', alvo).forEach((b) => (b.onclick = async () => {
    const m = modelos.find((x) => x.id === b.dataset.delmod);
    if (!(await confirmar(`Excluir o modelo "${m.titulo}"? Os documentos já emitidos não mudam.`, 'Excluir'))) return;
    const { error: e } = await sb.from('documento_modelos').delete().eq('id', m.id);
    if (e) return falha(e, 'Excluir modelo'); toast('Modelo excluído.'); recarregar();
  }));
}

async function profDoc(d, eu) {
  if (!d.profissional_id) return null;
  if (d.profissional_id === eu?.id) return eu;
  return (await sb.from('profissionais').select('nome, conselho, numero_conselho, uf_conselho, especialidade').eq('id', d.profissional_id).single()).data;
}

function editor(p, ats, eu, tipo, modeloProprio, aoEmitir, existente) {
  const T = TIPOS[tipo], cpf = p.cpf ? `, CPF ${p.cpf}` : '';
  const meus = (ats || []).filter((a) => ['atendido', 'presente'].includes(a.status) && (!eu || a.profissional_id === eu.id))
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
  const atendidos = [...meus].reverse();
  const area = eu ? (AREA_CONS[eu.conselho] || eu.especialidade || 'saúde') : null;
  modal(`<h3>${existente ? 'Editar' : ''} ${esc(existente?.titulo || modeloProprio?.titulo || T.nome)} — ${esc(p.nome_social || p.nome)}</h3>
    <form id="fd" class="grade-form">
      <label>Atendimento<select name="at"><option value="">— data de hoje —</option>
        ${meus.map((a) => `<option value="${a.id}">${new Date(a.inicio).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(a.profissionais?.nome || a.servico || '')}</option>`).join('')}</select></label>
      <label><span><input type="checkbox" name="hora" checked> Incluir horário</span></label>
      ${tipo === 'atestado' ? `<label>Dias de afastamento<input type="number" name="dias" value="1" min="1" max="30"></label>
        <label>CID<input name="cid" placeholder="Só com autorização do paciente"></label>
        <label><span><input type="checkbox" name="cid_ok"> Paciente autorizou constar o CID</span></label>` : ''}
      ${tipo === 'acompanhante' ? '<label style="grid-column:1/-1">Nome do acompanhante<input name="acomp" required></label>' : ''}
      <label style="grid-column:1/-1">Título<input name="titulo" value="${esc(existente?.titulo || modeloProprio?.titulo || T.titulo)}"></label>
    </form>
    <label class="pr-area" style="display:grid;gap:4px;margin-top:12px">Texto (pode editar antes de emitir)
      <textarea id="corpo" rows="14" style="width:100%;resize:vertical"></textarea></label>
    <p class="muted">${existente ? `O código <code>${esc(existente.codigo)}</code> é mantido e passa a validar o texto novo (o anterior deixa de existir).`
      : 'Ao salvar, o documento recebe um código de verificação e fica registrado. Você pode editá-lo ou excluí-lo depois pela lista.'}</p>
    <div class="linha-acoes">${eu ? '<button class="btn" id="salvamod">Salvar texto como meu modelo</button>' : ''}<button class="btn" data-fechar>Cancelar</button>
      <button class="btn" id="salvar">Salvar</button><button class="btn primario" id="emitir">Salvar e imprimir</button></div>`, (box, fechar) => {
    box.classList.add('largo');
    const f = $('#fd', box), corpo = $('#corpo', box);
    let editado = !!existente; corpo.oninput = () => (editado = true);
    if (existente) {   // edição: só título e texto; os campos automáticos não se aplicam
      $$('label', f).filter((l) => !l.querySelector('[name=titulo]')).forEach((l) => (l.style.display = 'none'));
      corpo.value = existente.corpo;
    }
    const valores = () => {
      const at = meus.find((a) => a.id === f.at.value);
      const dias = Number(f.dias?.value || 1);
      const areaAt = area || (at?.servico) || 'saúde';
      return { paciente: p.nome_social || p.nome, cpf_frase: cpf, data: at ? dBr(at.inicio) : dBr(new Date().toISOString()),
        horario_frase: f.hora.checked && at ? `, das ${hBr(at.inicio)} às ${hBr(at.fim || new Date(new Date(at.inicio).getTime() + 45 * 60000).toISOString())}` : '',
        dias, dias_extenso: EXT[dias] || String(dias), area: areaAt.toLowerCase(), acompanhante: f.acomp?.value || '____________________',
        cid_frase: f.cid?.value && f.cid_ok?.checked ? ` CID: ${f.cid.value.toUpperCase()}.` : '',
        sessoes: atendidos.length, primeira: atendidos[0] ? dBr(atendidos[0].inicio) : '____', ultima: atendidos.at(-1) ? dBr(atendidos.at(-1).inicio) : '____',
        hoje: dBr(new Date().toISOString()) };
    };
    const gerar = () => { if (existente) return; if (!editado) corpo.value = preencher(modeloProprio?.corpo ?? T.corpo, valores()); };
    f.oninput = gerar; f.onchange = gerar; gerar();
    if (f.cid) f.cid.oninput = () => { if (f.cid.value) f.cid_ok.closest('label').style.color = f.cid_ok.checked ? '' : 'var(--vermelho)'; gerar(); };
    $('#salvamod', box)?.addEventListener('click', async () => {
      // Guarda o texto com os campos automáticos de volta como {marcadores}, para reaproveitar com outros pacientes
      const v = valores(); let txt = corpo.value;
      for (const k of ['paciente', 'acompanhante']) if (v[k] && v[k].length > 3) txt = txt.split(v[k]).join(`{${k}}`);
      if (v.cpf_frase) txt = txt.split(v.cpf_frase).join('{cpf_frase}');
      if (v.horario_frase) txt = txt.split(v.horario_frase).join('{horario_frase}');
      txt = txt.split(v.data).join('{data}');
      const { error } = await sb.from('documento_modelos').insert({ clinica_id: estado.clinica.id, profissional_id: eu.id, tipo,
        titulo: f.titulo.value || T.titulo, corpo: txt });
      if (error) return falha(error, 'Salvar modelo'); toast('Modelo salvo em "Meus modelos" (aba Documentos).'); aoEmitir();
    });
    const gravar = async (imprimir) => {
      if (!corpo.value.trim()) return toast('O documento está vazio.', true);
      if (!existente && tipo === 'acompanhante' && !f.acomp.value.trim()) return toast('Informe o nome do acompanhante.', true);
      if (!existente && f.cid?.value && !f.cid_ok.checked) return toast('Marque a autorização do paciente ou apague o CID.', true);
      const titulo = f.titulo.value || T.titulo, texto = corpo.value;
      const janela = imprimir ? window.open('', '_blank') : null;   // abre já no clique (bloqueador de pop-up)
      const q = existente
        ? sb.from('documentos_emitidos').update({ titulo, corpo: texto }).eq('id', existente.id).select('*').single()
        : sb.from('documentos_emitidos').insert({ clinica_id: estado.clinica.id, paciente_id: p.id, profissional_id: eu?.id || null,
            atendimento_id: f.at.value || null, tipo, titulo, corpo: texto }).select('*').single();
      const { data: d, error } = await q;
      if (error) { janela?.close(); return falha(error, existente ? 'Salvar alterações' : 'Salvar documento'); }
      if (imprimir) imprimirDoc(d, await profDoc(d, eu), await timbrado(), janela);
      toast(existente ? 'Documento atualizado.' : 'Documento salvo.');
      fechar(); aoEmitir();
    };
    $('#salvar', box).onclick = () => gravar(false);
    $('#emitir', box).onclick = () => gravar(true);
  });
}

// ---------------------------------------------------------------- impressão timbrada (A4)
export function imprimirDoc(d, prof, t, janela) {
  const j = janela || window.open('', '_blank'); if (!j) return falha('Permita pop-ups deste site para imprimir.');
  const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  const verif = `${base}verificar.html?c=${d.codigo}`;
  const para = esc(d.corpo).split(/\n{2,}/).map((b) => `<p>${b.replace(/\n/g, '<br>')}</p>`).join('');
  const contato = [t.endereco, t.telefone, t.email, t.site, t.instagram].filter(Boolean).map(esc).join('  ·  ');
  j.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(d.titulo)} — ${esc(d.codigo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:ital,wght@1,700&display=swap" rel="stylesheet">
<style>
  @page{size:A4;margin:0}
  *{box-sizing:border-box} html,body{margin:0;background:#e9e9e9}
  .folha{width:210mm;min-height:297mm;margin:0 auto;background:#fff;position:relative;padding:0 22mm 34mm;font:11.5pt/1.7 "Barlow",Arial,sans-serif;color:#23272A;display:flex;flex-direction:column}
  .topo{display:flex;justify-content:space-between;align-items:center;padding:16mm 0 6mm;border-bottom:1px solid #D9DDD8}
  .topo img{height:16mm} .topo .id{text-align:right;font-size:8.5pt;line-height:1.4;color:#5E666B}
  .faixa{position:absolute;top:0;left:0;right:0;height:5mm;background:#23272A}
  .faixa::after{content:"";position:absolute;right:30mm;top:0;width:46mm;height:5mm;background:#F8781D;transform:skewX(-18deg)}
  h1{font-family:"Barlow Semi Condensed",Arial,sans-serif;font-style:italic;font-weight:700;font-size:21pt;text-align:center;margin:16mm 0 10mm;letter-spacing:.01em}
  h1::after{content:"";display:block;width:22mm;height:2.2mm;background:#F8781D;transform:skewX(-18deg);margin:4mm auto 0}
  .marca{position:absolute;left:50%;top:52%;width:150mm;transform:translate(-45%,-50%);pointer-events:none;z-index:0}
  .topo,h1,.corpo,.local,.ass,.rodape{position:relative;z-index:1}
  .corpo{text-align:justify;flex:1} .corpo p{margin:0 0 4mm}
  .local{text-align:right;margin:10mm 0 22mm}
  .ass{text-align:center;margin:0 auto 6mm;width:95mm;border-top:1px solid #23272A;padding-top:2mm;line-height:1.35}
  .ass strong{display:block;font-weight:600} .ass span{font-size:9.5pt;color:#5E666B}
  .rodape{position:absolute !important;left:22mm;right:22mm;bottom:10mm;font-size:8pt;color:#5E666B;text-align:center;border-top:1px solid #D9DDD8;padding-top:3mm;line-height:1.5}
  .rodape .ver{margin-top:1.5mm;font-size:7.5pt} .rodape code{color:#23272A;font-weight:600}
  .bt{position:fixed;top:10px;right:10px;padding:8px 14px;background:#F8781D;color:#fff;border:0;border-radius:6px;font:600 13px Barlow,Arial;cursor:pointer}
  @media print{html,body{background:#fff}.bt{display:none}.folha{margin:0}}
</style></head><body><button class="bt" onclick="print()">Imprimir / salvar PDF</button>
<div class="folha"><div class="faixa"></div><img class="marca" src="${base}marca-dagua.png" alt="">
  <div class="topo"><img src="${base}logo.png" alt="Clínica Cure"><div class="id">${esc(t.razao_social || 'Clínica Cure')}<br>CNPJ ${esc(t.cnpj || '')}</div></div>
  <h1>${esc(d.titulo)}</h1>
  <div class="corpo">${para}</div>
  <div class="local">Joinville, ${extenso(new Date(d.emitido_em))}.</div>
  <div class="ass">${prof ? `<strong>${esc(prof.nome)}</strong><span>${esc(PROF_TITULO[prof.conselho] || prof.especialidade || '')} · ${esc(conselhoFmt(prof))}</span>`
    : '<strong>Clínica Cure</strong><span>Recepção</span>'}</div>
  <div class="rodape">${contato}
    <div class="ver">Documento emitido eletronicamente em ${new Date(d.emitido_em).toLocaleString('pt-BR')} · código <code>${esc(d.codigo)}</code> · confira a autenticidade em ${esc(verif.replace(/^https?:\/\//, ''))}</div></div>
</div></body></html>`);
  j.document.close();
}
