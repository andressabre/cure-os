// Fechamento do atendimento: escolhe convênio, autorização e procedimentos, confere os bloqueios anti-glosa
// (função SQL guia_atendimento) e gera a guia TISS. Particular/sem convênio só marca "Atendido".
import { sb, estado, $, $$, esc, brl, data, toast, falha, modal } from '../core.js';

export async function fecharAtendimento(a, aoConcluir) {
  const { data: op, error } = await sb.rpc('opcoes_guia', { p_atendimento: a.id });
  if (error) return falha(error, 'Opções da guia');
  if (op.guias.length) {
    return toast(`Este atendimento já tem guia (nº ${op.guias.map((g) => g.numero).join(', ')}).`);
  }
  const souProf = estado.perfil === 'profissional';
  let plano = op.planos.find((p) => p.principal) || op.planos[0] || null;
  let itens = [{ procedimento_id: '', quantidade: 1 }];

  const marcarSemGuia = async (fechar) => {
    const { error: e } = await sb.from('atendimentos').update({ status: 'atendido', atualizado_em: new Date().toISOString() }).eq('id', a.id);
    if (e) return falha(e); fechar(); toast('Atendimento marcado como Atendido (sem guia).'); aoConcluir?.();
  };

  modal(`<h3>Fechar atendimento</h3>
    <p class="muted">${esc(a.pacientes?.nome || '')} · ${data(new Date(a.inicio).toLocaleDateString('sv'))}</p>
    <div id="g-corpo"></div>
    <div id="g-result"></div>
    <div class="linha-acoes">
      <button class="btn" data-fechar>Voltar</button>
      <button class="btn" id="g-sem">Particular / sem guia</button>
      <button class="btn" id="g-ver">Conferir</button>
      <button class="btn primario" id="g-ok" disabled>Gerar guia e marcar Atendido</button>
    </div>`,
  (m, fechar) => {
    const corpo = $('#g-corpo', m), res = $('#g-result', m), ok = $('#g-ok', m);
    const invalida = () => { ok.disabled = true; res.innerHTML = ''; };

    function desenhar() {
      if (!plano) {
        corpo.innerHTML = `<p>Paciente sem convênio vinculado.</p>
          ${souProf ? '<p class="muted">Peça à recepção para vincular o convênio, ou marque como particular.</p>' : `
          <form class="grade-form" id="g-vinc">
            <label style="grid-column:1/-1">Contrato<select name="contrato_id" required><option value="">Escolha…</option>
              ${op.contratos.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
            <label>Carteirinha<input name="carteirinha" required></label>
            <label>Validade<input type="date" name="validade"></label>
            <label style="grid-column:1/-1">Plano (opcional)<input name="plano_nome"></label>
          </form><div class="linha-acoes" style="justify-content:flex-start"><button class="btn" id="g-vsalvar">Vincular convênio</button></div>`}`;
        $('#g-vsalvar', corpo)?.addEventListener('click', async () => {
          const f = Object.fromEntries(new FormData($('#g-vinc', corpo)));
          if (!f.contrato_id || !f.carteirinha.trim()) return toast('Escolha o contrato e informe a carteirinha.', true);
          const { error: e } = await sb.from('paciente_planos').insert({ clinica_id: estado.clinica.id, paciente_id: a.paciente_id,
            contrato_id: f.contrato_id, carteirinha: f.carteirinha.trim(), validade: f.validade || null, plano_nome: f.plano_nome || null, principal: true });
          if (e) return falha(e);
          const { data: n, error: e2 } = await sb.rpc('opcoes_guia', { p_atendimento: a.id });
          if (e2) return falha(e2);
          op.planos = n.planos; plano = op.planos[0]; desenhar();
        });
        return;
      }
      const procs = [...plano.procedimentos].sort((x, y) => x.codigo.localeCompare(y.codigo));
      corpo.innerHTML = `<div class="grade-form">
        <label style="grid-column:1/-1">Convênio<select id="g-plano">${op.planos.map((p) => `<option value="${p.id}" ${p.id === plano.id ? 'selected' : ''}>
          ${esc(p.contrato)} · cart. ${esc(p.carteirinha)}${p.validade ? ' · val. ' + data(p.validade) : ''}</option>`).join('')}</select></label>
        ${plano.sem_tiss ? '<p class="muted" style="grid-column:1/-1">Acordo sem guia TISS: só registra o atendimento.</p>' : `
        <label style="grid-column:1/-1">Autorização<select id="g-aut"><option value="">Sem autorização</option>
          ${plano.autorizacoes.map((x) => `<option value="${x.id}">${esc(x.codigo)} · senha ${esc(x.senha || '—')} · ${x.usadas}/${x.qtd} usadas${x.validade ? ' · val. ' + data(x.validade) : ''}</option>`).join('')}</select></label>`}
        ${plano.regras ? `<p class="aviso" style="grid-column:1/-1">Regras do contrato: ${esc(plano.regras)}</p>` : ''}
      </div>
      <table class="tabela"><thead><tr><th>Procedimento</th><th style="width:80px">Qtd</th><th></th></tr></thead><tbody>
        ${itens.map((it, i) => `<tr><td><select data-i="${i}" class="g-proc"><option value="">Escolha…</option>
          ${procs.map((p) => `<option value="${p.id}" ${p.id === it.procedimento_id ? 'selected' : ''}>${esc(p.codigo)} — ${esc(p.descricao)}</option>`).join('')}</select></td>
          <td><input type="number" min="1" step="1" value="${it.quantidade}" data-i="${i}" class="g-qtd"></td>
          <td>${itens.length > 1 ? `<button class="btn pequeno" data-rm="${i}">×</button>` : ''}</td></tr>`).join('')}
      </tbody></table>
      <button class="btn pequeno" id="g-add">+ procedimento</button>`;
      $('#g-plano', corpo).onchange = (e) => { plano = op.planos.find((p) => p.id === e.target.value); itens = [{ procedimento_id: '', quantidade: 1 }]; invalida(); desenhar(); };
      $('#g-aut', corpo)?.addEventListener('change', (e) => {
        const au = plano.autorizacoes.find((x) => x.id === e.target.value);
        if (au && !itens.some((it) => it.procedimento_id)) { itens[0].procedimento_id = au.procedimento_id; desenhar(); $('#g-aut', corpo).value = au.id; }
        invalida();
      });
      $$('.g-proc', corpo).forEach((s) => (s.onchange = () => { itens[s.dataset.i].procedimento_id = s.value; invalida(); }));
      $$('.g-qtd', corpo).forEach((s) => (s.oninput = () => { itens[s.dataset.i].quantidade = Math.max(1, parseInt(s.value) || 1); invalida(); }));
      $$('[data-rm]', corpo).forEach((b) => (b.onclick = () => { const aut = $('#g-aut', corpo)?.value; itens.splice(b.dataset.rm, 1); invalida(); desenhar(); if (aut) $('#g-aut', corpo).value = aut; }));
      $('#g-add', corpo).onclick = () => { const aut = $('#g-aut', corpo)?.value; itens.push({ procedimento_id: '', quantidade: 1 }); invalida(); desenhar(); if (aut) $('#g-aut', corpo).value = aut; };
    }

    const chamar = (gravar) => sb.rpc('guia_atendimento', {
      p_atendimento: a.id, p_plano: plano.id, p_autorizacao: $('#g-aut', corpo)?.value || null,
      p_itens: itens.filter((it) => it.procedimento_id), p_gravar: gravar });

    function mostrar(r) {
      const lista = (arr, cls) => arr.length ? `<ul class="${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
      res.innerHTML = `${r.bloqueios.length ? '<h4>Bloqueios — corrija antes de gerar</h4>' : ''}${lista(r.bloqueios, 'lista-bloqueio')}
        ${r.avisos.length ? '<h4>Avisos</h4>' : ''}${lista(r.avisos, 'lista-aviso')}
        ${r.itens.length ? `<table class="tabela"><thead><tr><th>Código</th><th>Qtd</th><th>Guia</th>${souProf ? '' : '<th>Valor</th>'}<th>Repasse</th></tr></thead><tbody>
          ${r.itens.map((i) => `<tr><td>${esc(i.codigo)}</td><td>${i.quantidade}</td><td>${esc(i.tipo_guia)}</td>${souProf ? '' : `<td>${brl(i.valor)}</td>`}<td>${brl(i.repasse)}</td></tr>`).join('')}
        </tbody></table>` : ''}
        ${!r.bloqueios.length ? '<p class="ok">Tudo certo para gerar.</p>' : ''}`;
      ok.disabled = r.bloqueios.length > 0;
    }

    $('#g-sem', m).onclick = () => marcarSemGuia(fechar);
    $('#g-ver', m).onclick = async () => {
      if (!plano) return toast('Vincule um convênio ou marque como particular.', true);
      const { data: r, error: e } = await chamar(false);
      if (e) return falha(e); mostrar(r);
    };
    ok.onclick = async () => {
      ok.disabled = true;
      const { data: r, error: e } = await chamar(true);
      if (e) { ok.disabled = false; return falha(e); }
      if (!r.gravado) return mostrar(r);
      fechar();
      toast(r.guias.length ? `Guia nº ${r.guias.map((g) => g.numero).join(', ')} gerada. Atendimento marcado como Atendido.` : 'Atendimento registrado (acordo sem guia).');
      aoConcluir?.();
    };
    desenhar();
  });
}
