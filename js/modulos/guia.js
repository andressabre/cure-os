// Fechamento do atendimento: escolhe convênio, autorização e procedimentos, confere os bloqueios anti-glosa
// (função SQL guia_atendimento) e gera a guia TISS. Particular/sem convênio só marca "Atendido".
import { sb, estado, $, $$, esc, brl, data, toast, falha, modal } from '../core.js';
import { imprimirGuia } from './guia-impressa.js';

export async function fecharAtendimento(a, aoConcluir) {
  const { data: op, error } = await sb.rpc('opcoes_guia', { p_atendimento: a.id });
  if (error) return falha(error, 'Opções da guia');
  if (op.guias.length) {
    return toast(`Este atendimento já tem guia (nº ${op.guias.map((g) => g.numero).join(', ')}).`);
  }
  const souProf = estado.perfil === 'profissional';
  let plano = op.planos.find((p) => p.id === a.paciente_plano_id) || op.planos.find((p) => p.principal) || op.planos[0] || null;
  let itens = [{ procedimento_id: '', quantidade: 1 }];
  const extra = { solicitante_id: '', cid: '', indicacao_clinica: '', tipo_atendimento: '03' };
  let autAuto = false; // escolhe sozinho a autorização vigente na data do atendimento (uma vez por convênio)

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
        ${plano.sem_tiss ? '' : `
        <label style="grid-column:1/-1">Solicitante (pedido médico)<span style="display:flex;gap:6px"><select id="g-sol" style="flex:1"><option value="">Escolha…</option>
          ${op.solicitantes.map((x) => `<option value="${x.id}" ${x.id === extra.solicitante_id ? 'selected' : ''}>${esc(x.nome)} · ${esc(x.conselho)} ${esc(x.numero)}/${esc(x.uf)}</option>`).join('')}</select>
          ${souProf ? '' : '<button class="btn pequeno" id="g-novosol" type="button">+ novo</button>'}</span></label>
        <div id="g-solform" style="grid-column:1/-1"></div>
        <label>CID<input id="g-cid" value="${esc(extra.cid)}" placeholder="ex.: M54.5" maxlength="6"></label>
        <label>Tipo de atendimento<select id="g-tat">${[['03', 'Outras terapias'], ['04', 'Consulta'], ['05', 'Exame ambulatorial']]
          .map(([k, v]) => `<option value="${k}" ${k === extra.tipo_atendimento ? 'selected' : ''}>${k} · ${v}</option>`).join('')}</select></label>
        <label style="grid-column:1/-1">Indicação clínica<input id="g-ind" value="${esc(extra.indicacao_clinica)}" maxlength="500" placeholder="Como está no pedido médico"></label>`}
        ${plano.regras ? `<p class="aviso" style="grid-column:1/-1">Regras do contrato: ${esc(plano.regras)}</p>` : ''}
      </div>
      <table class="tabela"><thead><tr><th>Procedimento</th><th style="width:80px">Qtd</th><th></th></tr></thead><tbody>
        ${itens.map((it, i) => `<tr><td><select data-i="${i}" class="g-proc"><option value="">Escolha…</option>
          ${procs.map((p) => `<option value="${p.id}" ${p.id === it.procedimento_id ? 'selected' : ''}>${esc(p.codigo)} — ${esc(p.descricao)}</option>`).join('')}</select></td>
          <td><input type="number" min="1" step="1" value="${it.quantidade}" data-i="${i}" class="g-qtd"></td>
          <td>${itens.length > 1 ? `<button class="btn pequeno" data-rm="${i}">×</button>` : ''}</td></tr>`).join('')}
      </tbody></table>
      <button class="btn pequeno" id="g-add">+ procedimento</button>`;
      $('#g-plano', corpo).onchange = (e) => { autAuto = false; plano = op.planos.find((p) => p.id === e.target.value); itens = [{ procedimento_id: '', quantidade: 1 }]; invalida(); desenhar(); };
      $('#g-aut', corpo)?.addEventListener('change', (e) => {
        const au = plano.autorizacoes.find((x) => x.id === e.target.value);
        if (au) {
          if (!itens.some((it) => it.procedimento_id)) itens[0].procedimento_id = au.procedimento_id;
          extra.solicitante_id ||= au.solicitante_id || ''; extra.cid ||= au.cid || ''; extra.indicacao_clinica ||= au.indicacao || '';
          desenhar(); $('#g-aut', corpo).value = au.id;
        }
        invalida();
      });
      $$('.g-proc', corpo).forEach((s) => (s.onchange = () => { itens[s.dataset.i].procedimento_id = s.value; invalida(); }));
      $$('.g-qtd', corpo).forEach((s) => (s.oninput = () => { itens[s.dataset.i].quantidade = Math.max(1, parseInt(s.value) || 1); invalida(); }));
      $$('[data-rm]', corpo).forEach((b) => (b.onclick = () => { lerExtra(); const aut = $('#g-aut', corpo)?.value; itens.splice(b.dataset.rm, 1); invalida(); desenhar(); if (aut) $('#g-aut', corpo).value = aut; }));
      const lerExtra = () => { const v = (id) => $(id, corpo)?.value ?? ''; Object.assign(extra, { solicitante_id: v('#g-sol'), cid: v('#g-cid').trim().toUpperCase(), indicacao_clinica: v('#g-ind').trim(), tipo_atendimento: v('#g-tat') || '03' }); };
      ['#g-sol', '#g-cid', '#g-ind', '#g-tat'].forEach((id) => $(id, corpo)?.addEventListener('change', () => { lerExtra(); invalida(); }));
      $('#g-novosol', corpo)?.addEventListener('click', () => {
        $('#g-solform', corpo).innerHTML = `<div class="grade-form" style="background:var(--cinza-1);padding:8px;border-radius:8px">
          <label style="grid-column:1/-1">Nome do médico<input id="s-nome"></label>
          <label>Conselho<select id="s-cons"><option>CRM</option><option>CRO</option><option>CREFITO</option><option>CRN</option><option>CRP</option></select></label>
          <label>Número<input id="s-num" inputmode="numeric"></label><label>UF<input id="s-uf" value="SC" maxlength="2"></label>
          <label>CBO<input id="s-cbo" value="225125" maxlength="6" title="225125 = médico clínico"></label>
          <div class="linha-acoes" style="grid-column:1/-1;justify-content:flex-start"><button class="btn pequeno primario" id="s-ok" type="button">Salvar solicitante</button></div></div>`;
        $('#s-ok', corpo).onclick = async () => {
          const r = { clinica_id: estado.clinica.id, nome: $('#s-nome', corpo).value.trim(), conselho: $('#s-cons', corpo).value,
            numero_conselho: $('#s-num', corpo).value.replace(/\D/g, ''), uf_conselho: $('#s-uf', corpo).value.trim().toUpperCase(), cbo: $('#s-cbo', corpo).value.replace(/\D/g, '') };
          if (!r.nome || !r.numero_conselho || r.uf_conselho.length !== 2 || r.cbo.length !== 6) return toast('Preencha nome, número, UF (2 letras) e CBO (6 dígitos).', true);
          const { data: n, error: e } = await sb.from('solicitantes').insert(r).select('id, nome, conselho, numero:numero_conselho, uf:uf_conselho').single();
          if (e) return falha(e, e.code === '23505' ? 'Solicitante já cadastrado' : '');
          lerExtra(); op.solicitantes.push(n); extra.solicitante_id = n.id; const aut = $('#g-aut', corpo)?.value; desenhar(); if (aut) $('#g-aut', corpo).value = aut;
        };
      });
      $('#g-add', corpo).onclick = () => { lerExtra(); const aut = $('#g-aut', corpo)?.value; itens.push({ procedimento_id: '', quantidade: 1 }); invalida(); desenhar(); if (aut) $('#g-aut', corpo).value = aut; };
      const selAut = $('#g-aut', corpo);
      if (selAut && !autAuto) {
        autAuto = true;
        const dAt = new Date(a.inicio).toLocaleDateString('sv');
        const melhor = plano.autorizacoes.find((x) => x.id === a.autorizacao_id) || plano.autorizacoes.find((x) => x.data <= dAt && (!x.validade || x.validade >= dAt) && Number(x.usadas) < Number(x.qtd));
        if (melhor) { selAut.value = melhor.id; selAut.dispatchEvent(new Event('change')); }
      }
    }

    const chamar = (gravar) => sb.rpc('guia_atendimento', {
      p_atendimento: a.id, p_plano: plano.id, p_autorizacao: $('#g-aut', corpo)?.value || null,
      p_itens: itens.filter((it) => it.procedimento_id), p_gravar: gravar, p_dados: extra });

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
      toast(r.guias.length ? r.guias.map((g) => g.nova ? `Guia nº ${g.numero} criada` : `Sessão acrescentada à guia nº ${g.numero}`).join('; ') + '. Atendimento marcado como Atendido.' : 'Atendimento registrado (acordo sem guia).');
      aoConcluir?.();
      // Guia nova = folha nova para o paciente assinar (anexo 06)
      const novas = r.guias.filter((g) => g.nova);
      if (novas.length) modal(`<h3>Guia para assinatura</h3><p>Imprimir a guia nº ${novas.map((g) => esc(g.numero)).join(', ')} para o paciente assinar?</p>
        <p class="muted">Depois de assinada, fotografe ou digitalize e anexe no lote (anexo 06).</p>
        <div class="linha-acoes"><button class="btn" data-fechar>Agora não</button>
        ${novas.map((g) => `<button class="btn primario" data-imp="${g.id}">Imprimir nº ${esc(g.numero)}</button>`).join('')}</div>`,
        (m) => m.querySelectorAll('[data-imp]').forEach((b) => (b.onclick = () => imprimirGuia(b.dataset.imp))));
    };
    desenhar();
  });
}

// Tarefas "Autorizar guia" (agenda): autorizações pendentes. Profissional vê só as ligadas a ele, sem valores.
export async function alertaSemSenha(alvo, aoAtualizar) {
  if (!alvo) return;
  const { data: ps, error } = await sb.rpc('autorizacoes_pendentes', { p_clinica: estado.clinica.id });
  if (error || !ps?.length) { alvo.innerHTML = ''; return; }
  const atendidas = ps.reduce((n, x) => n + Number(x.atendidos), 0);
  alvo.innerHTML = `<div class="dica" style="display:flex;align-items:center;gap:12px;border-left-color:var(--vermelho);background:var(--vermelho-claro)">
    <span><strong>Autorizar guia: ${ps.length} pendente${ps.length > 1 ? 's' : ''}</strong>${atendidas ? ` · ${atendidas} sessão(ões) já realizada(s) sem senha` : ''}
    ${ps[0].primeira_data ? ` · próxima/primeira sessão em ${data(ps[0].primeira_data)}` : ''}</span>
    <button class="btn pequeno primario" id="ver-ss" style="margin-left:auto">Ver tarefas</button></div>`;
  $('#ver-ss', alvo).onclick = () => modal(`<h3>Autorizar guia</h3>
    <p class="muted">Data da autorização deve ser igual ou anterior à 1ª sessão (glosa 1814) e a validade cobrir as sessões.</p>
    <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Paciente</th><th>Convênio</th><th>Procedimento</th><th>Sessões</th>
      <th>Senha</th><th>Data aut.</th><th>Validade</th><th>Qtd aut.</th><th></th></tr></thead><tbody>
      ${ps.map((x) => `<tr data-a="${x.autorizacao_id}"><td><strong>${esc(x.paciente)}</strong><br><small>${esc(x.carteirinha)} · ${esc(x.profissionais || '')}</small></td>
        <td>${esc(x.contrato)}</td><td><small>${esc(x.procedimento)}</small></td>
        <td>${x.qtd_solicitada} solic.<br><small>${x.atendidos} feitas · ${x.agendados} agendadas${x.primeira_data ? '<br>1ª ' + data(x.primeira_data) : ''}</small></td>
        <td><input class="ss-senha" style="width:100px"></td><td><input type="date" class="ss-data" value="${x.primeira_data || ''}" ${x.primeira_data ? `max="${x.primeira_data}"` : ''}></td>
        <td><input type="date" class="ss-val"></td><td><input type="number" class="ss-qtd" min="1" style="width:60px" value="${x.qtd_solicitada}"></td>
        <td style="white-space:nowrap"><button class="btn pequeno primario ss-ok">Autorizada</button> <button class="btn pequeno ss-neg">Negada</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button></div>`,
  (m) => {
    const responder = async (tr, status) => {
      const { data: r, error: e } = await sb.rpc('responder_autorizacao', { p_aut: tr.dataset.a, p_status: status,
        p_senha: $('.ss-senha', tr).value, p_data: $('.ss-data', tr).value || null, p_validade: $('.ss-val', tr).value || null,
        p_qtd: parseInt($('.ss-qtd', tr).value) || null });
      if (e) return falha(e);
      tr.remove(); toast(status === 'negada' ? 'Marcada como negada.' : 'Senha registrada.');
      if (r?.avisos?.length) toast(r.avisos.join(' '), true);
      if (!$('tbody tr', m)) $('[data-fechar]', m)?.click();
      alertaSemSenha(alvo, aoAtualizar);
    };
    $$('.ss-ok', m).forEach((b) => (b.onclick = () => responder(b.closest('tr'), 'autorizada')));
    $$('.ss-neg', m).forEach((b) => (b.onclick = () => { if (b.dataset.ok) return responder(b.closest('tr'), 'negada'); b.dataset.ok = 1; b.textContent = 'Confirmar negada'; }));
  });
}
