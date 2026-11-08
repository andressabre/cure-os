// Leitor do Demonstrativo de Análise de Conta (XML TISS da ANS).
// Independente da tela: recebe o arquivo, devolve cabeçalho + linhas padronizadas.

const filhos = (el, nome) => [...el.children].filter((c) => c.localName === nome);
const filho = (el, nome) => filhos(el, nome)[0];
const txt = (el, caminho) => {
  let atual = el;
  for (const p of caminho.split('/')) { atual = atual && filho(atual, p); }
  return atual?.textContent?.trim() || null;
};
const num = (v) => (v == null || v === '' ? 0 : Number(v));
const todos = (el, nome) => [...el.getElementsByTagNameNS('*', nome)];

export async function lerArquivoXml(arquivo) {
  const buf = await arquivo.arrayBuffer();
  const cabeca = new TextDecoder('ascii').decode(buf.slice(0, 200));
  const enc = /encoding="([^"]+)"/i.exec(cabeca)?.[1] || 'utf-8';
  const texto = new TextDecoder(enc.toLowerCase()).decode(buf);
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('O arquivo não é um XML válido.');
  return interpretar(doc);
}

export function interpretar(doc) {
  const tipo = todos(doc, 'tipoTransacao')[0]?.textContent;
  if (tipo !== 'DEMONSTRATIVO_ANALISE_CONTA')
    throw new Error(`Este XML é do tipo "${tipo || 'desconhecido'}". Envie o Demonstrativo de Análise de Conta.`);

  const linhas = [];
  let registroAns = null, codigoPrestador = null, dataEmissao = null, nomeOperadora = null;
  const totais = { informado: 0, liberado: 0, glosa: 0 };

  for (const d of todos(doc, 'demonstrativoAnaliseConta')) {
    const cab = filho(d, 'cabecalhoDemonstrativo');
    registroAns ??= txt(cab, 'registroANS');
    nomeOperadora ??= txt(cab, 'nomeOperadora');
    dataEmissao ??= txt(cab, 'dataEmissao');
    codigoPrestador ??= txt(d, 'dadosPrestador/dadosContratado/codigoPrestadorNaOperadora');
    for (const k of ['informado', 'liberado', 'glosa']) {
      const nome = { informado: 'valorInformadoGeral', liberado: 'valorLiberadoGeral', glosa: 'valorGlosaGeral' }[k];
      totais[k] += todos(d, nome).reduce((s, e) => s + num(e.textContent), 0);
    }

    for (const p of todos(d, 'dadosProtocolo')) {
      const lote = txt(p, 'numeroLotePrestador'), protocolo = txt(p, 'numeroProtocolo');
      for (const g of filhos(p, 'relacaoGuias')) {
        const base = {
          numero_lote: lote, protocolo,
          numero_guia_prestador: txt(g, 'numeroGuiaPrestador'),
          numero_guia_operadora: txt(g, 'numeroGuiaOperadora'),
          carteirinha: txt(g, 'numeroCarteira'),
        };
        const motivoGuia = txt(g, 'motivoGlosaGuia/codigoGlosa');
        const itens = filhos(g, 'detalhesGuia');
        if (!itens.length) {
          linhas.push({ ...base, data_realizacao: txt(g, 'dataInicioFat'), codigo_procedimento: null, sequencial_item: null,
            valor_informado: num(txt(g, 'valorInformadoGuia')), valor_liberado: num(txt(g, 'valorLiberadoGuia')),
            valor_glosa: num(txt(g, 'valorGlosaGuia')), codigo_glosa: motivoGuia });
          continue;
        }
        // O XML detalha só os itens glosados: o restante da guia vira uma linha de "saldo".
        const vi = itens.reduce((s, it) => s + num(txt(it, 'valorInformado')), 0);
        const vl = itens.reduce((s, it) => s + num(txt(it, 'valorLiberado')), 0);
        const ri = num(txt(g, 'valorInformadoGuia')) - vi, rl = num(txt(g, 'valorLiberadoGuia')) - vl;
        if (Math.abs(ri) > 0.004 || Math.abs(rl) > 0.004)
          linhas.push({ ...base, data_realizacao: txt(g, 'dataInicioFat'), codigo_procedimento: null, sequencial_item: null,
            valor_informado: +ri.toFixed(2), valor_liberado: +rl.toFixed(2), valor_glosa: 0, codigo_glosa: null });
        for (const it of itens) {
          const rg = filho(it, 'relacaoGlosa');
          linhas.push({ ...base, data_realizacao: txt(it, 'dataRealizacao'),
            codigo_procedimento: txt(it, 'procedimento/codigoProcedimento'),
            sequencial_item: Number(txt(it, 'sequencialItem')) || null,
            valor_informado: num(txt(it, 'valorInformado')), valor_liberado: num(txt(it, 'valorLiberado')),
            valor_glosa: num(rg && txt(rg, 'valorGlosa')), codigo_glosa: (rg && txt(rg, 'tipoGlosa')) || motivoGuia });
        }
      }
    }
  }

  const somaGlosa = linhas.reduce((s, l) => s + l.valor_glosa, 0);
  const somaInf = linhas.reduce((s, l) => s + l.valor_informado, 0);
  return {
    registroAns, nomeOperadora, codigoPrestador, dataEmissao,
    totais: { informado: +totais.informado.toFixed(2), liberado: +totais.liberado.toFixed(2), glosa: +totais.glosa.toFixed(2) },
    somaConfere: Math.abs(somaGlosa - totais.glosa) < 0.01 && Math.abs(somaInf - totais.informado) < 0.01,
    linhas,
  };
}

// Resumo por lote, para a gestora indicar quais são da clínica
export function resumoPorLote(linhas) {
  const m = new Map();
  for (const l of linhas) {
    const r = m.get(l.numero_lote) || { lote: l.numero_lote, protocolo: l.protocolo, guias: new Set(), informado: 0, glosa: 0 };
    r.guias.add(l.numero_guia_prestador); r.informado += l.valor_informado; r.glosa += l.valor_glosa;
    m.set(l.numero_lote, r);
  }
  return [...m.values()].map((r) => ({ ...r, guias: r.guias.size }));
}
