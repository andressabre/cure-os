// Módulo Pacientes: lista, busca, cadastro e importação do sistema antigo.
import { sb, estado, $, $$, esc, data, tela, toast, falha, modal, foneFmt, foneDig, foneValido, mascaraFone } from '../core.js';
import { lerArquivo, sugerirMapa, sugerirTabela, dicionario, converter, ROTULOS, formatos } from './importador.js';

const ORIGEM = 'motivar_2012';

export async function render() {
  const gestor = estado.perfil === 'gestor';
  const c = tela('Pacientes', `${gestor ? '<button class="btn" id="imp">Importar do sistema antigo</button>' : ''}
    <button class="btn primario" id="novo">+ Paciente</button>`);
  c.innerHTML = `<div class="cartao"><div class="grade-form">
      <label>Buscar (nome, CPF ou telefone)<input id="busca" placeholder="Digite ao menos 2 letras"></label>
      <label>Situação<select id="sit"><option value="1">Ativos</option><option value="0">Inativos</option><option value="">Todos</option></select></label>
    </div></div><div class="cartao tabela-rolagem" id="lista"></div>`;
  let t;
  const buscar = async () => {
    const q = $('#busca').value.trim(), sit = $('#sit').value;
    let consulta = sb.from('pacientes').select('id, nome, cpf, data_nascimento, telefone, celular, ativo, campos_extras', { count: 'exact' })
      .eq('clinica_id', estado.clinica.id).order('nome').limit(100);
    if (sit !== '') consulta = consulta.eq('ativo', sit === '1');
    if (q.length >= 2) {
      const dig = q.replace(/\D/g, '');
      consulta = dig.length >= 4 ? consulta.or(`cpf.ilike.%${dig}%,telefone.ilike.%${dig}%,celular.ilike.%${dig}%`) : consulta.ilike('nome', `%${q}%`);
    }
    const { data: ps, count, error } = await consulta;
    if (error) return falha(error);
    $('#lista').innerHTML = `<p class="muted">${count ?? 0} pacientes${count > 100 ? ' (mostrando 100; refine a busca)' : ''}</p>
      <table><thead><tr><th>Nome</th><th>CPF</th><th>Nascimento</th><th>Telefone</th><th>Convênio (origem)</th><th></th></tr></thead><tbody>
      ${ps.map((p) => `<tr class="clicavel" data-id="${p.id}"><td><strong>${esc(p.nome)}</strong>${p.ativo ? '' : ' <span class="selo outra">inativo</span>'}</td>
        <td>${esc(p.cpf ? p.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—')}</td><td>${data(p.data_nascimento)}</td>
        <td>${esc(p.celular || p.telefone ? foneFmt(p.celular || p.telefone) : '—')}</td><td>${esc(p.campos_extras?.convenio_origem || '—')}</td><td>›</td></tr>`).join('')
        || '<tr><td colspan="6" class="vazio">Nenhum paciente encontrado.</td></tr>'}</tbody></table>`;
    $$('tr[data-id]', $('#lista')).forEach((tr) => (tr.onclick = () => (location.hash = 'paciente-' + tr.dataset.id)));
  };
  $('#busca').oninput = () => { clearTimeout(t); t = setTimeout(buscar, 300); };
  $('#sit').onchange = buscar;
  $('#novo').onclick = () => ficha(null);
  $('#imp')?.addEventListener('click', importar);
  buscar();

  async function ficha(id) {
    let p = { ativo: true, endereco: {}, campos_extras: {} };
    if (id) { const r = await sb.from('pacientes').select('*').eq('id', id).single(); if (r.error) return falha(r.error); p = r.data; }
    const e = p.endereco || {}, x = p.campos_extras || {};
    modal(`<h3>${id ? 'Ficha do paciente' : 'Novo paciente'}</h3><form class="grade-form" id="f">
      <label>Nome<input name="nome" required value="${esc(p.nome)}"></label>
      <label>Nome social<input name="nome_social" value="${esc(p.nome_social)}"></label>
      <label>CPF<input name="cpf" value="${esc(p.cpf)}"></label>
      <label>Nascimento<input type="date" name="data_nascimento" value="${esc(p.data_nascimento)}"></label>
      <label>Sexo<select name="sexo"><option value=""></option><option ${p.sexo === 'F' ? 'selected' : ''}>F</option><option ${p.sexo === 'M' ? 'selected' : ''}>M</option></select></label>
      <label>Nome da mãe<input name="nome_mae" value="${esc(p.nome_mae)}"></label>
      <label>CNS<input name="cns" value="${esc(p.cns)}"></label>
      <label>Celular (WhatsApp)<input name="celular" value="${esc(p.celular)}"></label>
      <label>Telefone fixo<input name="telefone" value="${esc(p.telefone)}"></label>
      <label>E-mail<input name="email" value="${esc(p.email)}"></label>
      <label>Rua<input name="rua" value="${esc(e.rua)}"></label>
      <label>CEP<input name="cep" value="${esc(e.cep)}"></label>
      <label>Cidade<input name="cidade" value="${esc(e.cidade)}"></label>
      <label>UF<input name="uf" maxlength="2" value="${esc(e.uf)}"></label>
      <label><span><input type="checkbox" name="consentimento_comunicacao" ${p.consentimento_comunicacao ? 'checked' : ''}> Aceita lembretes</span></label>
      <label><span><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativo</span></label>
    </form>
    ${Object.keys(x).length ? `<p class="muted" style="margin-top:12px"><strong>Do sistema antigo:</strong> ${Object.entries(x).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: ${esc(v)}`).join(' · ')}</p>` : ''}
    <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button><button class="btn primario" id="s">Salvar</button></div>`,
    (m, fechar) => { mascaraFone($('#f', m).celular); mascaraFone($('#f', m).telefone); $('#s', m).onclick = async () => {
      const fd = new FormData($('#f', m)), f = Object.fromEntries(fd);
      if (!f.nome.trim()) return toast('Informe o nome.', true);
      for (const [k, cel] of [['celular', true], ['telefone', false]])
        if (f[k].trim() && foneDig(f[k]) !== foneDig(p[k]) && !foneValido(f[k], cel)) return toast(cel ? 'Celular: informe DDD + 9 dígitos.' : 'Telefone: informe DDD + número.', true);
      const reg = { nome: f.nome.trim(), nome_social: f.nome_social || null, cpf: f.cpf.replace(/\D/g, '') || null,
        data_nascimento: f.data_nascimento || null, sexo: f.sexo || null, nome_mae: f.nome_mae || null, cns: f.cns || null,
        celular: f.celular.trim() ? (foneValido(f.celular, true) ? foneDig(f.celular) : p.celular) : null,
        telefone: f.telefone.trim() ? (foneValido(f.telefone) ? foneDig(f.telefone) : p.telefone) : null, email: f.email || null, consentimento_comunicacao: fd.has('consentimento_comunicacao'),
        ativo: fd.has('ativo'), endereco: { ...e, rua: f.rua, cep: f.cep, cidade: f.cidade, uf: f.uf.toUpperCase() } };
      const q = id ? sb.from('pacientes').update(reg).eq('id', id) : sb.from('pacientes').insert({ ...reg, clinica_id: estado.clinica.id });
      const { error } = await q; if (error) return falha(error, error.code === '23505' ? 'CPF já cadastrado' : 'Salvar'); fechar(); toast('Salvo.'); buscar();
    }; });
  }

  function importar() {
    modal(`<h3>Importar pacientes</h3>
      <div class="dica">Aceita o arquivo do <strong>Backup</strong> do sistema antigo (.sql), planilha (.csv, .xlsx). O arquivo é lido aqui no seu
        navegador; só os pacientes que você confirmar são gravados. Reimportar o mesmo arquivo atualiza, não duplica.</div>
      <div class="solta" id="solta">Arraste o arquivo aqui ou clique<input type="file" id="arq" accept=".sql,.csv,.txt,.xlsx,.xls" hidden></div>
      <div id="etapa"></div>`, (m, fechar) => {
      const solta = $('#solta', m), arq = $('#arq', m);
      solta.onclick = () => arq.click();
      solta.ondragover = (ev) => { ev.preventDefault(); solta.classList.add('sobre'); };
      solta.ondragleave = () => solta.classList.remove('sobre');
      solta.ondrop = (ev) => { ev.preventDefault(); solta.classList.remove('sobre'); abrir(ev.dataTransfer.files[0]); };
      arq.onchange = () => abrir(arq.files[0]);

      async function abrir(f) {
        if (!f) return;
        $('#etapa', m).innerHTML = '<div class="vazio">Lendo arquivo…</div>';
        let res; try { res = await lerArquivo(f); } catch (e) { return falha(e, 'Leitura'); }
        const nomes = Object.keys(res.tabelas);
        if (!nomes.length) return ($('#etapa', m).innerHTML = '<div class="dica">Não encontrei dados neste arquivo.</div>');
        const dics = { convenios: dicionario(res.tabelas, /conv/i), estados: dicionario(res.tabelas, /estado|uf/i) };
        montar(res.tabelas, sugerirTabela(res.tabelas), dics);
      }

      function montar(tabelas, nomeTab, dics) {
        const tab = tabelas[nomeTab], mapa = sugerirMapa(tab.colunas);
        const opc = (sel) => `<option value="">— ignorar —</option>${tab.colunas.map((c, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
        $('#etapa', m).innerHTML = `
          <label style="margin-top:12px">Tabela com os pacientes<select id="tab">${Object.keys(tabelas).map((t) =>
            `<option ${t === nomeTab ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <p class="muted">${tab.linhas.length} registros · confira de qual coluna vem cada campo:</p>
          <div class="grade-form" id="mapa">${Object.entries(ROTULOS).map(([k, r]) => `<label>${r}<select data-c="${k}">${opc(mapa[k])}</select></label>`).join('')}</div>
          <div id="resumo"></div>
          <div class="linha-acoes"><button class="btn" data-fechar>Cancelar</button><button class="btn" id="prev">Ver prévia</button>
          <button class="btn primario" id="ir" disabled>Importar</button></div>`;
        $$('[data-fechar]', m).forEach((b) => (b.onclick = fechar));
        $('#tab', m).onchange = (ev) => montar(tabelas, ev.target.value, dics);
        let prontos = [];
        $('#prev', m).onclick = () => {
          const mp = {}; $$('[data-c]', m).forEach((s) => s.value !== '' && (mp[s.dataset.c] = Number(s.value)));
          if (mp.nome == null) return toast('Indique a coluna do nome.', true);
          const todos = tab.linhas.map((l) => converter(l, mp, dics)).filter((p) => p.nome);
          const vistosCpf = new Map(), vistosId = new Set(); let dupCpf = 0, dupId = 0;
          prontos = [];
          for (const p of todos) {
            if (p.origem_id && vistosId.has(p.origem_id)) { dupId++; continue; }
            if (p.origem_id) vistosId.add(p.origem_id);
            if (p.cpf && vistosCpf.has(p.cpf)) { dupCpf++; p.campos_extras.cpf_duplicado_de = vistosCpf.get(p.cpf); p.campos_extras.cpf_original = p.cpf; p.cpf = null; }
            else if (p.cpf) vistosCpf.set(p.cpf, p.nome);
            prontos.push({ ...p, clinica_id: estado.clinica.id, origem: ORIGEM });
          }
          const sem = (k) => prontos.filter((p) => !p[k]).length;
          const amostra = prontos.slice(0, 3);
          $('#resumo', m).innerHTML = `<div class="kpis" style="margin-top:12px">
            <div class="kpi"><div class="rotulo">Pacientes a importar</div><div class="valor">${prontos.length}</div><div class="sub">${prontos.filter((p) => !p.ativo).length} inativos</div></div>
            <div class="kpi"><div class="rotulo">Sem CPF válido</div><div class="valor">${sem('cpf')}</div><div class="sub">${dupCpf} CPFs repetidos (mantidos, marcados)</div></div>
            <div class="kpi"><div class="rotulo">Sem nascimento</div><div class="valor">${sem('data_nascimento')}</div></div>
            <div class="kpi"><div class="rotulo">Sem telefone</div><div class="valor">${sem('telefone')}</div></div></div>
            <p class="muted"><strong>Formato no arquivo</strong> (sem dados): CPF → ${esc(formatos(tab.linhas, mp.cpf))} · Nascimento → ${esc(formatos(tab.linhas, mp.data_nascimento))}</p>
            <p class="muted">Conferência (3 primeiros): ${amostra.map((p) => `${esc(p.nome)} · ${p.sexo || '?'} · ${data(p.data_nascimento)} · ${esc(p.campos_extras.convenio_origem || '—')}`).join(' | ')}</p>`;
          $('#ir', m).disabled = !prontos.length;
        };
        $('#ir', m).onclick = async (ev) => {
          ev.target.disabled = true; $('#prev', m).disabled = true;
          let ok = 0;
          const comId = prontos.filter((p) => p.origem_id), semId = prontos.filter((p) => !p.origem_id);
          try {
            for (let i = 0; i < comId.length; i += 300) {
              const { error } = await sb.from('pacientes').upsert(comId.slice(i, i + 300), { onConflict: 'clinica_id,origem,origem_id' });
              if (error) throw error; ok += Math.min(300, comId.length - i);
              ev.target.textContent = `Importando… ${ok}/${prontos.length}`;
            }
            for (let i = 0; i < semId.length; i += 300) {
              const { error } = await sb.from('pacientes').insert(semId.slice(i, i + 300)); if (error) throw error; ok += Math.min(300, semId.length - i);
            }
            fechar(); toast(`${ok} pacientes importados.`); buscar();
          } catch (e) { falha(e, `Importação parou em ${ok}`); ev.target.disabled = false; $('#prev', m).disabled = false; }
        };
      }
    });
  }
}
