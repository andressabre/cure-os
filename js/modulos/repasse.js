// Módulo Tabela de repasse: quanto a clínica paga a cada profissional, por contrato e procedimento.
import { sb, estado, $, $$, esc, brl, tela, toast, falha, modal, confirmar } from '../core.js';

export async function render() {
  const c = tela('Tabela de repasse', '<button class="btn primario" id="nova">+ Regra</button>');
  const cid = estado.clinica.id;
  const [{ data: regras, error }, { data: profs }, { data: cts }] = await Promise.all([
    sb.from('regras_repasse').select('*, profissionais(nome), contratos(nome), procedimentos(codigo, descricao)').eq('clinica_id', cid),
    sb.from('profissionais').select('id, nome').eq('clinica_id', cid).eq('ativo', true).order('nome'),
    sb.from('contratos').select('id, nome').eq('clinica_id', cid).order('nome'),
  ]);
  if (error) return falha(error);
  regras.sort((a, b) => (a.profissionais?.nome || '').localeCompare(b.profissionais?.nome || ''));

  c.innerHTML = `
    <div class="dica"><strong>Como a glosa afeta o repasse:</strong> o desconto é proporcional ao que a clínica paga ao profissional.
      Ex.: recebe R$ 80, paga R$ 60. Glosa de R$ 80 → profissional deixa de receber R$ 60; glosa de R$ 40 → R$ 30.
      A gestora pode ajustar manualmente em cada glosa. A regra mais específica vale primeiro (procedimento > contrato > geral).</div>
    <div class="cartao tabela-rolagem"><table>
      <thead><tr><th>Profissional</th><th>Contrato</th><th>Procedimento</th><th>Regra</th><th>Vigência</th><th></th></tr></thead><tbody>
      ${regras.map((r) => `<tr><td><strong>${esc(r.profissionais?.nome)}</strong></td><td>${esc(r.contratos?.nome || 'Todos')}</td>
        <td>${r.procedimentos ? `${esc(r.procedimentos.codigo)} · ${esc(r.procedimentos.descricao)}` : 'Todos'}</td>
        <td><strong>${r.tipo === 'fixo' ? brl(r.valor) : r.valor + '% do recebido'}</strong></td>
        <td>${esc(r.vigencia_inicio)}${r.vigencia_fim ? ' a ' + esc(r.vigencia_fim) : ' em diante'}</td>
        <td><button class="btn pequeno" data-del="${r.id}">Remover</button></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma regra cadastrada.</td></tr>'}
      </tbody></table></div>`;

  $('#nova').onclick = () => {
    if (!profs.length) return toast('Cadastre um profissional primeiro.', true);
    modal(`<h3>Nova regra de repasse</h3><form class="grade-form" id="f">
      <label>Profissional<select name="profissional_id">${profs.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></label>
      <label>Contrato<select name="contrato_id"><option value="">Todos os contratos</option>${cts.map((k) => `<option value="${k.id}">${esc(k.nome)}</option>`).join('')}</select></label>
      <label>Código TUSS (vazio = todos)<input name="codigo" placeholder="ex.: 50000470"></label>
      <label>Descrição do procedimento<input name="descricao"></label>
      <label>Tipo<select name="tipo"><option value="fixo">Valor fixo (R$)</option><option value="percentual">% do valor recebido</option></select></label>
      <label>Valor<input name="valor" type="number" step="0.01" min="0" required></label>
      <label>Vigente a partir de<input name="vigencia_inicio" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
    </form><div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s">Salvar</button></div>`,
    (m, fechar) => ($('#s', m).onclick = async () => {
      const f = Object.fromEntries(new FormData($('#f', m)));
      if (f.valor === '') return toast('Informe o valor.', true);
      let procedimento_id = null;
      if (f.codigo.trim()) {
        const cod = f.codigo.trim();
        let { data: pr } = await sb.from('procedimentos').select('id').eq('codigo', cod).maybeSingle();
        if (!pr) {
          if (!f.descricao.trim()) return toast('Procedimento novo: informe a descrição.', true);
          const r = await sb.from('procedimentos').insert({ codigo: cod, descricao: f.descricao.trim() }).select('id').single();
          if (r.error) return falha(r.error); pr = r.data;
        }
        procedimento_id = pr.id;
      }
      const { error: e } = await sb.from('regras_repasse').insert({ clinica_id: cid, profissional_id: f.profissional_id,
        contrato_id: f.contrato_id || null, procedimento_id, tipo: f.tipo, valor: Number(f.valor), vigencia_inicio: f.vigencia_inicio });
      if (e) return falha(e); fechar(); toast('Regra salva.'); render();
    }));
  };
  $$('[data-del]', c).forEach((b) => (b.onclick = async () => {
    if (!(await confirmar('Remover esta regra de repasse?', 'Remover'))) return;
    const { error: e } = await sb.from('regras_repasse').delete().eq('id', b.dataset.del);
    if (e) return falha(e); render();
  }));
}
