// Backup mensal (decisão da gestora 09/11/2026: Supabase Free + cópia no OneDrive).
// Gera um ZIP no navegador com TODAS as tabelas da clínica (JSON) + os documentos do período,
// para salvar na pasta sincronizada do OneDrive. Só a gestora (RLS: algumas tabelas são só do gestor).
import { sb, estado, $, esc, toast, falha } from '../core.js';

// convites fica de fora (tokens de acesso)
const TABELAS = ['clinicas', 'usuarios_clinica', 'cnpjs_faturamento', 'operadoras', 'contratos', 'contrato_tabela', 'procedimentos',
  'regras_repasse', 'profissionais', 'solicitantes', 'pacientes', 'paciente_planos', 'encaminhamentos', 'autorizacoes', 'atendimentos',
  'guias', 'guia_itens', 'guia_anexos', 'lotes', 'retornos', 'retorno_linhas', 'glosas', 'motivos_glosa', 'glosas_operadora',
  'notificacoes', 'contas_financeiras', 'categorias_financeiras', 'lancamentos', 'auditoria',
  'prontuario_registros', 'prontuario_adendos', 'prontuario_anexos', 'prontuario_versoes', 'documento_modelos', 'documentos_emitidos'];
const DIAS_AVISO = 35;

async function lerTabela(t) {
  const linhas = [], pag = 1000;
  for (let ini = 0; ; ini += pag) {
    let q = sb.from(t).select('*').range(ini, ini + pag - 1);
    if (t !== 'glosas_operadora' && t !== 'motivos_glosa') q = q.order('id');
    let { data, error } = await q;
    if (error && /id/.test(error.message)) ({ data, error } = await sb.from(t).select('*').range(ini, ini + pag - 1));
    if (error) throw new Error(`${t}: ${error.message}`);
    linhas.push(...data);
    if (data.length < pag) return linhas;
  }
}

const mesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

export async function cartaoBackup(alvo) {
  if (estado.perfil !== 'gestor' || !alvo) return;
  const { data: cl } = await sb.from('clinicas').select('config').eq('id', estado.clinica.id).single();
  const ult = cl?.config?.ultimo_backup, dias = ult ? Math.floor((Date.now() - new Date(ult)) / 864e5) : null;
  const auto = cl?.config?.ultimo_backup_tipo === 'automatico';
  const atrasado = dias == null || dias > (auto ? 9 : DIAS_AVISO); // automático é semanal: vermelho se passar de 9 dias
  alvo.innerHTML = `<div class="cartao" ${atrasado ? 'style="border-left:4px solid #c0392b"' : ''}>
    <div class="linha-acoes" style="justify-content:space-between;flex-wrap:wrap">
      <div><h3 style="margin:0">Backup</h3><span class="muted">${ult ? `Último: ${new Date(ult).toLocaleDateString('pt-BR')} (${dias} dias)${auto ? ' · automático semanal (OneDrive)' : ''}` : 'Nenhum backup feito ainda'}
        · o plano gratuito do Supabase não guarda cópias</span></div>
      <span style="display:flex;gap:8px;align-items:center">
        <label class="muted">Documentos de <input type="month" id="bk-mes" value="${mesAnterior()}"></label>
        <label class="muted"><input type="checkbox" id="bk-todos"> todos</label>
        <button class="btn primario" id="bk-ir">Gerar backup</button></span></div>
    <div id="bk-prog" class="muted"></div></div>`;
  $('#bk-ir', alvo).onclick = () => gerar(alvo);
}

async function gerar(alvo) {
  const bt = $('#bk-ir', alvo), prog = $('#bk-prog', alvo), mes = $('#bk-mes', alvo).value, todos = $('#bk-todos', alvo).checked;
  const passo = (t) => (prog.textContent = t);
  bt.disabled = true;
  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip(), resumo = [];
    for (const [i, t] of TABELAS.entries()) {
      passo(`Lendo dados (${i + 1}/${TABELAS.length}): ${t}…`);
      const linhas = await lerTabela(t);
      zip.file(`dados/${t}.json`, JSON.stringify(linhas));
      resumo.push(`${t}: ${linhas.length}`);
    }
    // documentos: caminhos guardados nos encaminhamentos e anexos das guias
    const ini = `${mes}-01`, fim = new Date(new Date(ini + 'T12:00').setMonth(new Date(ini + 'T12:00').getMonth() + 1)).toISOString().slice(0, 10);
    const filtra = (q) => (todos ? q : q.gte('criado_em', ini).lt('criado_em', fim));
    const [{ data: en }, { data: an }] = await Promise.all([
      filtra(sb.from('encaminhamentos').select('arquivo').not('arquivo', 'is', null)),
      filtra(sb.from('guia_anexos').select('arquivo')),
    ]);
    const caminhos = [...new Set([...(en || []), ...(an || [])].map((x) => x.arquivo))];
    let falhas = 0;
    for (const [i, c] of caminhos.entries()) {
      passo(`Baixando documentos (${i + 1}/${caminhos.length})…`);
      const { data: blob, error } = await sb.storage.from('documentos').download(c);
      if (error) { falhas++; continue; }
      zip.file('documentos/' + c.split('/').slice(1).join('/'), blob);
    }
    const hoje = new Date().toISOString().slice(0, 10);
    zip.file('LEIA-ME.txt', [`Backup do Cure OS — ${estado.clinica.nome} — gerado em ${new Date().toLocaleString('pt-BR')}`, '',
      'dados/: todas as tabelas da clínica em JSON (uma linha de tabela = um objeto). Serve para restaurar ou consultar.',
      `documentos/: pedidos médicos e anexos das guias ${todos ? '(todos)' : `criados em ${mes}`}. Caminho = pacientes/<id do paciente>/… ou guias/<id da guia>/…`, '',
      'Contém dados de saúde (LGPD): guarde só na pasta da clínica no OneDrive, sem compartilhar o link.', '',
      'Registros por tabela:', ...resumo, '', `Documentos: ${caminhos.length - falhas} de ${caminhos.length}`].join('\r\n'));

    passo('Compactando…');
    const arquivo = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const nome = `cure-os-backup-${hoje}${todos ? '-completo' : '-docs-' + mes}.zip`;
    await salvar(arquivo, nome);

    const { data: cl } = await sb.from('clinicas').select('config').eq('id', estado.clinica.id).single();
    await sb.from('clinicas').update({ config: { ...(cl?.config || {}), ultimo_backup: new Date().toISOString() } }).eq('id', estado.clinica.id);
    toast(`Backup salvo (${(arquivo.size / 1048576).toFixed(1)} MB)${falhas ? ` — ${falhas} documento(s) não baixaram, gere de novo` : ''}.`, !!falhas);
    cartaoBackup(alvo);
  } catch (e) {
    if (e?.name === 'AbortError') { passo(''); bt.disabled = false; return; }
    falha(e, 'Backup'); bt.disabled = false; passo('');
  }
}

// Chrome/Edge: escolhe a pasta (ex.: OneDrive › Cure › Backups). Outros navegadores: download comum.
async function salvar(blob, nome) {
  if (window.showSaveFilePicker) {
    const h = await window.showSaveFilePicker({ suggestedName: nome, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] });
    const w = await h.createWritable(); await w.write(blob); await w.close(); return;
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nome });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
