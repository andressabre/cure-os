// Relacionamento (db/030): aniversariantes e reavaliações vencendo, com WhatsApp pronto (wa.me, sem custo).
// Opt-out: toda mensagem termina com o rodapé "responda SAIR"; "Pediu para sair" grava comunicacao_optout_em e o paciente sai da lista.
import { sb, estado, $, $$, esc, toast, falha, modal, confirmar } from '../core.js';
import { foneWhats } from './agenda.js';

const dm = (d) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
function tempoDesde(d) {
  const meses = Math.round((Date.now() - new Date(d + 'T12:00')) / (30.44 * 864e5));
  return meses >= 12 ? `${Math.floor(meses / 12)} ano${meses >= 24 ? 's' : ''}${meses % 12 ? ` e ${meses % 12} ${meses % 12 > 1 ? 'meses' : 'mês'}` : ''}` : `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}
const primeiro = (n) => ((n || '').trim().split(/\s+/)[0] || '').toLowerCase().replace(/^./, (c) => c.toUpperCase());

function texto(cfg, it) {
  const base = it.tipo === 'aniversario' ? cfg.texto_aniversario : cfg.texto_reavaliacao;
  return `${(base || '').replace(/\{nome\}/g, primeiro(it.nome)).replace(/\{item\}/g, (it.item || '').toLowerCase())
    .replace(/\{tempo\}/g, it.ultima ? tempoDesde(it.ultima) : '')}\n\n${cfg.rodape_sair || 'Se não quiser mais receber, responda SAIR.'}`;
}

export function abrir() {
  let dias = 7;
  modal(`<h3>💬 Relacionamento</h3>
    <div class="linha-acoes" style="justify-content:flex-start"><label>Próximos <select id="rd"><option>7</option><option>15</option><option>30</option></select> dias</label></div>
    <p class="muted">Aniversários e reavaliações (prazos em Configurações da clínica). Só aparece quem não pediu para sair. Cada mensagem já leva "responda SAIR";
      quando o paciente pedir, clique em <strong>Pediu para sair</strong>. Reavaliação some da lista quando há agendamento futuro.</p>
    <div id="rl" class="vazio">Carregando…</div>
    <div class="linha-acoes"><button class="btn" data-fechar>Fechar</button></div>`, (m) => {
    m.classList.add('largo');
    async function carregar() {
      const { data, error } = await sb.rpc('relacionamento', { p_clinica: estado.clinica.id, p_dias: dias });
      if (error) return falha(error, 'Relacionamento');
      const cfg = data.config || {}, itens = data.itens || [];
      const enviados = JSON.parse(sessionStorage.getItem('rel-enviados') || '{}');
      const linha = (it) => { const f = foneWhats(it.telefone), chave = `${it.tipo}|${it.paciente_id}|${it.quando}`;
        return `<tr><td>${it.tipo === 'aniversario' ? `🎂 ${dm(it.quando)}${it.idade ? ` · ${it.idade} anos` : ''}` : `🔁 ${esc(it.item)}<br><small class="muted">última ${dm(it.ultima)} · vence ${dm(it.quando)}</small>`}</td>
          <td><a href="#paciente-${it.paciente_id}" data-fechar>${esc(it.nome)}</a><br><small class="muted">${esc(it.telefone || 'sem telefone')}</small></td>
          <td style="white-space:nowrap">${f ? `<a class="btn pequeno ${enviados[chave] ? '' : 'primario'}" target="_blank" rel="noopener" data-env="${esc(chave)}"
              href="https://wa.me/${f}?text=${encodeURIComponent(texto(cfg, it))}">${enviados[chave] ? '✓ enviado' : 'WhatsApp'}</a>` : '<span class="muted">sem celular</span>'}
            <button class="btn pequeno" data-sair="${it.paciente_id}">Pediu para sair</button></td></tr>`; };
      const aniv = itens.filter((i) => i.tipo === 'aniversario'), reav = itens.filter((i) => i.tipo === 'reavaliacao');
      const tab = (lista) => `<table><tbody>${lista.map(linha).join('')}</tbody></table>`;
      $('#rl', m).className = '';
      $('#rl', m).innerHTML = `<h4>Aniversários (${aniv.length})</h4>${aniv.length ? tab(aniv) : '<p class="muted">Nenhum — lembre que só aparece quem tem data de nascimento no cadastro.</p>'}
        <h4>Reavaliações (${reav.length})</h4>${reav.length ? tab(reav) : '<p class="muted">Nenhuma vencendo.</p>'}`;
      $$('[data-env]', m).forEach((a) => a.addEventListener('click', () => {
        enviados[a.dataset.env] = 1; sessionStorage.setItem('rel-enviados', JSON.stringify(enviados)); setTimeout(carregar, 600); }));
      $$('[data-sair]', m).forEach((b) => (b.onclick = async () => {
        if (!(await confirmar('Registrar que este paciente pediu para não receber mais mensagens de relacionamento? (Lembrete de consulta agendada continua.)', 'Registrar'))) return abrir();
        const { error: e } = await sb.from('pacientes').update({ consentimento_comunicacao: false, comunicacao_optout_em: new Date().toISOString() }).eq('id', b.dataset.sair);
        if (e) return falha(e); toast('Registrado: não recebe mais.'); abrir();
      }));
    }
    $('#rd', m).onchange = (e) => { dias = Number(e.target.value); carregar(); };
    carregar();
  });
}
