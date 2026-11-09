// Guia SP/SADT impressa (modelo de campos da ANS) para o paciente assinar — anexo ANS 06.
// Datas já realizadas vêm preenchidas; linhas em branco para as próximas sessões da mesma senha.
import { sb, esc, falha } from '../core.js';

const d = (v) => (v ? new Date(v + 'T12:00').toLocaleDateString('pt-BR') : '');
const n2 = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const CARATER = { 1: '1 - Eletivo', 2: '2 - Urgência/Emergência' };
const TIPO_AT = { '03': '03 - Outras terapias', '04': '04 - Consulta' };
const REGIME = { '01': '01 - Ambulatorial' };

function campo(num, rot, valor, flex = 1) {
  return `<div class="c" style="flex:${flex}"><span class="r">${num} - ${rot}</span><span class="v">${esc(valor ?? '') || '&nbsp;'}</span></div>`;
}

export async function imprimirGuia(guiaId) {
  const janela = window.open('', '_blank');           // abre no clique (bloqueador de pop-up)
  const { data: g, error } = await sb.rpc('dados_guia_impressa', { p_guia: guiaId });
  if (error) { janela?.close(); return falha(error, 'Imprimir guia'); }
  if (!janela) return falha('Permita pop-ups deste site para imprimir a guia.');

  const s = g.solicitante || {}, so = g.solicitado || {}, itens = g.itens || [];
  const execs = [...new Map(itens.map((i) => [i.profissional?.nome, i.profissional])).values()].filter(Boolean);
  const linhas = Math.min(Math.max(g.series || 1, itens.length, 1), 20);
  const datas = [...new Set(itens.map((i) => i.data))];
  const total = itens.reduce((t, i) => t + Number(i.valor || 0), 0);

  janela.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Guia SP/SADT ${esc(g.numero)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; } body { font: 9px/1.25 Arial, sans-serif; color: #000; margin: 0; }
  .topo { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 4px; }
  .topo h1 { font-size: 12px; margin: 0; } .nguia { font-size: 11px; font-weight: bold; }
  .sec { background: #ddd; font-weight: bold; padding: 2px 4px; margin-top: 4px; border: 1px solid #000; border-bottom: 0; }
  .l { display: flex; } .c { border: 1px solid #000; margin: -1px 0 0 -1px; padding: 1px 3px; min-height: 22px; }
  .r { display: block; font-size: 7px; color: #333; } .v { display: block; font-size: 10px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #000; padding: 2px 3px; text-align: left; }
  th { font-size: 7px; font-weight: normal; background: #f2f2f2; } td { font-size: 9px; height: 16px; } .num { text-align: right; }
  .ass td { height: 24px; } .rodape { display: flex; gap: 8px; margin-top: 10px; }
  .rodape div { flex: 1; border-top: 1px solid #000; padding-top: 2px; text-align: center; font-size: 8px; margin-top: 22px; }
  .aviso { font-size: 7px; color: #444; margin-top: 4px; }
  @media screen { body { max-width: 1100px; margin: 12px auto; } .bt { display: block; margin: 0 0 8px; padding: 6px 14px; font-size: 13px; } }
  @media print { .bt { display: none; } }
</style></head><body>
<button class="bt" onclick="print()">Imprimir</button>
<div class="topo"><h1>GUIA DE SERVIÇO PROFISSIONAL / SERVIÇO AUXILIAR DE DIAGNÓSTICO E TERAPIA — SP/SADT</h1>
  <span class="nguia">2 - Nº Guia no Prestador: ${esc(g.numero)}</span></div>
<div class="l">${campo(1, 'Registro ANS', g.registro_ans)}${campo(3, 'Nº Guia Principal', '')}${campo(4, 'Data da Autorização', d(g.data_autorizacao))}
  ${campo(5, 'Senha', g.senha, 2)}${campo(6, 'Validade da Senha', d(g.validade_senha))}${campo(7, 'Nº Guia Atribuído pela Operadora', g.numero_operadora, 2)}</div>
<div class="sec">Dados do Beneficiário</div>
<div class="l">${campo(8, 'Número da Carteira', g.carteirinha, 2)}${campo(9, 'Validade da Carteira', d(g.validade_carteira))}
  ${campo(10, 'Nome', g.paciente, 4)}${campo(11, 'Cartão Nacional de Saúde', g.cns, 2)}${campo(12, 'Atendimento a RN', 'N')}</div>
<div class="sec">Dados do Solicitante</div>
<div class="l">${campo(13, 'Código na Operadora', g.codigo_prestador, 2)}${campo(14, 'Nome do Contratado', g.contratado, 4)}</div>
<div class="l">${campo(15, 'Nome do Profissional Solicitante', s.nome, 4)}${campo(16, 'Conselho', s.conselho)}${campo(17, 'Número no Conselho', s.numero)}
  ${campo(18, 'UF', s.uf)}${campo(19, 'Código CBO', s.cbo)}${campo(20, 'Assinatura do Solicitante', '', 2)}</div>
<div class="sec">Dados da Solicitação / Procedimentos Solicitados</div>
<div class="l">${campo(21, 'Caráter do Atendimento', CARATER[g.carater] || g.carater)}${campo(22, 'Data da Solicitação', d(g.data_solicitacao))}
  ${campo(23, 'Indicação Clínica', [g.cid, g.indicacao_clinica].filter(Boolean).join(' — '), 5)}</div>
<table><tr><th>24 - Tabela</th><th>25 - Código</th><th>26 - Descrição</th><th class="num">27 - Qtde. Solic.</th><th class="num">28 - Qtde. Aut.</th></tr>
  <tr><td>${esc(so.tabela)}</td><td>${esc(so.codigo)}</td><td>${esc(so.descricao)}</td><td class="num">${esc(so.qtd_solicitada)}</td><td class="num">${esc(so.qtd_autorizada)}</td></tr></table>
<div class="sec">Dados do Contratado Executante</div>
<div class="l">${campo(29, 'Código na Operadora', g.codigo_prestador, 2)}${campo(30, 'Nome do Contratado', g.contratado, 4)}${campo(31, 'Código CNES', g.cnes)}</div>
<div class="sec">Dados do Atendimento</div>
<div class="l">${campo(32, 'Tipo de Atendimento', TIPO_AT[g.tipo_atendimento] || g.tipo_atendimento, 2)}${campo(33, 'Indicação de Acidente', '9 - Não acidente', 2)}
  ${campo(34, 'Tipo de Consulta', '')}${campo(35, 'Motivo de Encerramento', '')}${campo('', 'Regime de Atendimento', REGIME[g.regime] || g.regime, 2)}</div>
<div class="sec">Dados da Execução / Procedimentos Realizados</div>
<table><tr><th>36 - Data</th><th>37 - Hora Ini.</th><th>38 - Hora Fim</th><th>39 - Tab.</th><th>40 - Código</th><th>41 - Descrição</th>
  <th class="num">42 - Qtde.</th><th>45 - Red./Acr.</th><th class="num">46 - Valor Unit. (R$)</th><th class="num">47 - Valor Total (R$)</th></tr>
  ${itens.map((i) => `<tr><td>${d(i.data)}</td><td>${esc(i.hora_inicio)}</td><td>${esc(i.hora_fim)}</td><td>${esc(i.tabela)}</td><td>${esc(i.codigo)}</td>
    <td>${esc(i.descricao)}</td><td class="num">${esc(i.quantidade)}</td><td>1,00</td><td class="num">${n2(i.valor_unitario)}</td><td class="num">${n2(i.valor)}</td></tr>`).join('')}
  ${'<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'.repeat(Math.max(0, Math.min(linhas - itens.length, 6)))}</table>
<div class="sec">Identificação do(s) Profissional(is) Executante(s)</div>
<table><tr><th>50 - CPF</th><th>51 - Nome do Profissional</th><th>52 - Conselho</th><th>53 - Número</th><th>54 - UF</th><th>55 - CBO</th></tr>
  ${(execs.length ? execs : [{}]).map((p) => `<tr><td>${esc(p.cpf)}</td><td>${esc(p.nome)}</td><td>${esc(p.conselho)}</td><td>${esc(p.numero)}</td><td>${esc(p.uf)}</td><td>${esc(p.cbo)}</td></tr>`).join('')}</table>
<div class="sec">56 - Data de Realização de Procedimentos em Série · 57 - Assinatura do Beneficiário ou Responsável</div>
<table class="ass"><tr>${[0, 1].map(() => '<th style="width:4%">Nº</th><th style="width:12%">Data</th><th>Assinatura</th>').join('')}</tr>
  ${Array.from({ length: Math.ceil(linhas / 2) }, (_, k) => `<tr>${[k, k + Math.ceil(linhas / 2)].map((ix) => ix < linhas
    ? `<td>${ix + 1}</td><td>${d(datas[ix])}</td><td></td>` : '<td></td><td></td><td></td>').join('')}</tr>`).join('')}</table>
<div class="l" style="margin-top:4px">${campo(58, 'Observação / Justificativa', '', 6)}
  ${g.mostra_valor ? campo(59, 'Total de Procedimentos (R$)', n2(total)) + campo(65, 'Total Geral (R$)', n2(total)) : ''}</div>
<div class="rodape"><div>66 - Assinatura do Responsável pela Autorização</div><div>67 - Assinatura do Beneficiário ou Responsável</div>
  <div>68 - Assinatura do Contratado</div></div>
<p class="aviso">Gerada pelo Cure OS a partir da guia ${esc(g.numero)} · ${esc(g.operadora)}. Depois de assinada, anexe a imagem/PDF na guia (anexo 06 – comprovante de comparecimento).</p>
</body></html>`);
  janela.document.close();
}
