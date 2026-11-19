// Módulo Autorizar guias (Bloco 1 do robô de autorização, db/064): lista as autorizações aguardando senha, mostra o semáforo da pré-checagem
// (encaminhamento, validade, CID, limites do contrato) e envia as marcadas para a fila do robô. O robô em si roda no computador da clínica (Bloco 2).
// Regras de checagem em autorizar-checagem.js (puras). Nenhum dado de portal é lido nem gravado aqui.
import { sb, estado, $, $$, esc, tela, toast, falha, confirmar, data, faltaBanco } from '../core.js';
import { conferirGuia, resumirFila } from './autorizar-checagem.js';

const SELO_NIVEL = { verde: ['ok', 'Pronta'], amarelo: ['pendente', 'Confira'], vermelho: ['alerta', 'Bloqueada'] };
const STATUS = {
  pendente: ['pendente', 'Na fila'], executando: ['clinica', 'Executando'], aguardando_ok: ['clinica', 'Aguardando seu ok'],
  autorizada: ['ok', 'Autorizada'], erro: ['alerta', 'Erro'], precisa_humano: ['alerta', 'Precisa de você'], cancelada: ['outra', 'Cancelada'],
};
const ATIVOS = ['pendente', 'executando', 'aguardando_ok'];
const CANCELAVEIS = ['pendente', 'aguardando_ok', 'erro', 'precisa_humano'];

const SEL_AUT = `id, procedimento_id, qtd_solicitada, qtd_autorizada, cid, area, solicitada_em, paciente_plano_id,
  encaminhamentos(arquivo, validade, cid), procedimentos(codigo, descricao),
  paciente_planos(carteirinha, validade, paciente_id, pacientes(nome), contratos(nome, aut:regras->autorizacao))`;
const SEL_FILA = 'id, autorizacao_id, modo, status, mensagem, criado_em, concluido_em, autorizacoes(procedimentos(codigo), paciente_planos(pacientes(nome)))';

const diasDesde = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso)) / 864e5));

export async function render() {
  const cid = estado.clinica.id;
  const c = tela('Autorizar guias', '<button class="btn primario" id="au-enviar" disabled>Enviar para o robô</button>');
  const hoje = new Date().toLocaleDateString('sv');
  const [rA, rF] = await Promise.all([
    sb.from('autorizacoes').select(SEL_AUT).eq('clinica_id', cid).eq('status', 'pendente').order('solicitada_em'),
    sb.from('fila_autorizacao_robo').select(SEL_FILA).eq('clinica_id', cid).order('criado_em', { ascending: false }).limit(40)]);
  if (faltaBanco(rF.error, c, 'db/064_fila_autorizacao_robo.sql')) { $('#acoes-tela').innerHTML = ''; return; }
  const erro = rA.error || rF.error; if (erro) return falha(erro, 'Autorizar guias');
  const pend = rA.data || [], fila = rF.data || [];
  const ativas = new Set(fila.filter((f) => ATIVOS.includes(f.status)).map((f) => f.autorizacao_id));

  // Histórico para os limites mensal/anual: autorizações já autorizadas dos mesmos planos
  let hist = [];
  if (pend.length) {
    const rH = await sb.from('autorizacoes').select('paciente_plano_id, procedimento_id, qtd_autorizada, data_autorizacao')
      .eq('clinica_id', cid).eq('status', 'autorizada').in('paciente_plano_id', [...new Set(pend.map((a) => a.paciente_plano_id))]);
    if (rH.error) return falha(rH.error, 'Autorizar guias (histórico)');
    hist = rH.data || [];
  }

  const itens = pend.map((a) => {
    const pl = a.paciente_planos || {}, h = hist.filter((x) => x.paciente_plano_id === a.paciente_plano_id && x.procedimento_id === a.procedimento_id)
      .map((x) => ({ data: x.data_autorizacao, qtd: x.qtd_autorizada }));
    const r = conferirGuia({ qtd: a.qtd_solicitada ?? a.qtd_autorizada, cid: a.cid, codigo: a.procedimentos?.codigo, validadeCarteira: pl.validade,
      enc: a.encaminhamentos, aut: pl.contratos?.aut || null }, hoje, h, ativas.has(a.id));
    return { a, pl, ...r };
  }).sort((x, y) => ({ verde: 0, amarelo: 1, vermelho: 2 }[x.nivel] - { verde: 0, amarelo: 1, vermelho: 2 }[y.nivel]));
  const res = resumirFila(itens);

  c.innerHTML = `
    <div class="cartao au-topo">
      <div class="au-resumo"><span class="selo ok">${res.verde} pronta(s)</span> <span class="selo pendente">${res.amarelo} para conferir</span>
        <span class="selo alerta">${res.vermelho} bloqueada(s)</span></div>
      <div class="au-modo"><label>Modo do robô
        <select id="au-modo"><option value="conferencia">Conferência — preenche o portal e para antes de enviar</option>
          <option value="envio">Envio direto — preenche e envia</option></select></label>
        <button class="btn pequeno" id="au-marcar">Marcar todas as prontas</button></div>
    </div>
    ${itens.length ? `<ul class="au-lista">${itens.map(({ a, pl, nivel, bloqueios, avisos }) => { const s = SELO_NIVEL[nivel], pid = pl.paciente_id;
      return `<li class="cartao au-item au-${nivel}"><label class="au-chk"><input type="checkbox" data-aut="${esc(a.id)}" ${nivel === 'vermelho' ? 'disabled' : ''}></label>
        <div class="au-corpo"><div class="au-linha"><strong>${pid ? `<a href="#paciente-${esc(pid)}-autorizacoes">${esc(pl.pacientes?.nome || 'Paciente')}</a>` : esc(pl.pacientes?.nome || 'Paciente')}</strong>
          <span class="selo ${s[0]}">${s[1]}</span></div>
          <small class="muted">${esc(pl.contratos?.nome || '')} · ${esc(a.procedimentos?.codigo || '')} ${esc(a.procedimentos?.descricao || '')} ·
            ${esc(a.qtd_solicitada ?? a.qtd_autorizada ?? 1)} sessão(ões) · pedida há ${diasDesde(a.solicitada_em)} dia(s)</small>
          ${bloqueios.length ? `<ul class="au-motivos au-bloq">${bloqueios.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
          ${avisos.length ? `<ul class="au-motivos au-aviso">${avisos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</div></li>`; }).join('')}</ul>`
      : '<div class="cartao au-vazio"><div class="au-vazio-ic">✓</div><h3>Nenhuma guia aguardando autorização</h3><p>Quando uma solicitação de senha for criada na agenda ou na ficha, ela aparece aqui.</p></div>'}
    <h3 class="au-titulo">Fila do robô <span class="muted">${fila.length ? `· últimos ${fila.length}` : ''}</span></h3>
    ${fila.length ? `<ul class="au-fila">${fila.map((f) => { const s = STATUS[f.status] || ['outra', f.status], nome = f.autorizacoes?.paciente_planos?.pacientes?.nome || 'Paciente';
      return `<li class="cartao au-fitem"><div class="au-linha"><strong>${esc(nome)}</strong> <small class="muted">${esc(f.autorizacoes?.procedimentos?.codigo || '')} · ${f.modo === 'envio' ? 'envio direto' : 'conferência'} · ${esc(data(String(f.criado_em).slice(0, 10)))}</small>
        <span class="selo ${s[0]}">${s[1]}</span>${CANCELAVEIS.includes(f.status) ? `<button class="btn pequeno" data-cancelar="${esc(f.id)}">Cancelar</button>` : ''}</div>
        ${f.mensagem ? `<small class="au-msg">${esc(f.mensagem)}</small>` : ''}</li>`; }).join('')}</ul>`
      : '<p class="muted">Nada na fila ainda.</p>'}`;

  const marcadas = () => $$('input[data-aut]:checked', c).map((i) => i.dataset.aut);
  const atualizarBotao = () => { const n = marcadas().length, b = $('#au-enviar'); b.disabled = !n; b.textContent = n ? `Enviar ${n} para o robô` : 'Enviar para o robô'; };
  $$('input[data-aut]', c).forEach((i) => (i.onchange = atualizarBotao));
  $('#au-marcar').onclick = () => { $$('input[data-aut]:not(:disabled)', c).forEach((i) => (i.checked = true)); atualizarBotao(); };

  $('#au-enviar').onclick = async () => {
    const ids = marcadas(), modo = $('#au-modo').value; if (!ids.length) return;
    if (modo === 'envio' && !(await confirmar(`Enviar ${ids.length} guia(s) direto, sem parar para conferência?`, 'Enviar direto'))) return;
    const { error } = await sb.from('fila_autorizacao_robo').insert(ids.map((autorizacao_id) => ({ clinica_id: cid, autorizacao_id, modo })));
    if (error) { if (error.code === '23505') toast('Alguma guia já estava na fila — atualizei a tela', true); else return falha(error, 'Enviar para o robô'); }
    else toast(`${ids.length} guia(s) na fila do robô`);
    render();
  };
  $$('[data-cancelar]', c).forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('Cancelar este pedido da fila?', 'Cancelar pedido'))) return;
    const { error } = await sb.from('fila_autorizacao_robo').update({ status: 'cancelada', concluido_em: new Date().toISOString() }).eq('id', b.dataset.cancelar);
    if (error) return falha(error, 'Cancelar pedido'); toast('Pedido cancelado'); render();
  }));
}
