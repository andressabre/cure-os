// Avaliação por cliques → texto (item 15 do backlog, 15/11/2026; padrão TocoGO).
// Cada modelo do prontuário pode ter um roteiro de perguntas em chips; a cada clique o texto dos campos do registro é regenerado.
// Texto digitado à mão não é apagado: se o campo já tinha conteúdo próprio, o texto gerado entra no fim e passa a ser atualizado ali.
// As escolhas ficam em conteudo.cliques (reabrir o registro restaura os chips). Nenhum dado sai do navegador além do próprio registro.
import { $, $$, esc } from '../core.js';

// ---------- utilitários de texto ----------
const lista = (a) => { a = (a || []).filter(Boolean); return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' e ' + a.at(-1); };
const min1 = (s) => String(s || '').replace(/^./, (c) => c.toLowerCase());
const frase = (s) => { s = String(s || '').trim(); return s ? s.replace(/^./, (c) => c.toUpperCase()).replace(/([^.!?])$/, '$1.') : ''; };
const junta = (...p) => p.map(frase).filter(Boolean).join(' ');
const tem = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');
const num = (v) => (tem(v) && !isNaN(v) ? Number(v) : null);

// ---------- blocos de perguntas ----------
// tipos: um (escolha única) · varios (múltipla) · eva (0–10) · num · texto · testes (− / + por teste, conforme a região)
const NENHUMA_BV = 'Nenhuma bandeira vermelha';
const TESTES = {
  'Pé': ['Windlass', 'Compressão do calcâneo'],
  'Tornozelo': ['Gaveta anterior do tornozelo', 'Inclinação talar', 'Squeeze test', 'Rotação externa (Kleiger)', 'Thompson'],
  'Perna': ['Hop test com dor', 'Thompson'],
  'Joelho': ['Lachman', 'Gaveta anterior', 'Gaveta posterior', 'Estresse em valgo', 'Estresse em varo', 'McMurray', 'Thessaly', 'Agachamento unipodal com dor'],
  'Coxa anterior': ['Thomas', 'Ely'],
  'Coxa posterior': ['Contração resistida dos isquiotibiais com dor', 'Alongamento ativo dos isquiotibiais com dor', 'Slump'],
  'Quadril/virilha': ['FADIR', 'FABER', 'Thomas', 'Squeeze dos adutores', 'Trendelenburg'],
  'Lombar': ['Elevação da perna estendida (Lasègue)', 'Slump', 'Instabilidade em prono', 'Extensão-rotação (Kemp)'],
  'Torácica': [],
  'Cervical': ['Spurling', 'Distração cervical', 'Tensão neural do membro superior (ULTT)'],
  'Ombro': ['Neer', 'Hawkins-Kennedy', 'Jobe (lata vazia)', 'Rotação externa resistida', 'Arco doloroso', 'Apreensão', 'Speed', "O'Brien"],
  'Cotovelo': ['Cozen', 'Mill', 'Epicondilite medial (golfista)'],
  'Punho/mão': ['Finkelstein', 'Phalen', 'Tinel'],
};

const blocoEsporte = { titulo: 'Modalidade e carga de treino', perguntas: [
  { k: 'modalidade', rot: 'Modalidade', tipo: 'varios', ops: ['Corrida de rua', 'Trail/ultramaratona', 'Futebol', 'Futsal', 'Vôlei', 'Beach tennis/tênis', 'Basquete', 'Handebol', 'Ciclismo', 'Natação', 'Triathlon', 'Musculação', 'CrossFit/funcional', 'Lutas', 'Dança'] },
  { k: 'mod_outra', rot: 'Outra modalidade', tipo: 'texto' },
  { k: 'nivel', rot: 'Nível', tipo: 'um', ops: ['Recreacional', 'Amador competitivo', 'Profissional/elite'] },
  { k: 'posicao', rot: 'Posição ou função', tipo: 'texto' },
  { k: 'freq', rot: 'Treinos por semana', tipo: 'num', min: 0, max: 14 },
  { k: 'volume', rot: 'Volume semanal (ex.: 40 km, 6 h)', tipo: 'texto' },
  { k: 'fase', rot: 'Fase da temporada', tipo: 'um', ops: ['Pré-temporada', 'Competitiva', 'Transição/off-season', 'Retorno ao esporte'] },
  { k: 'carga', rot: 'Mudanças recentes de carga', tipo: 'varios', ops: ['Aumento recente de volume', 'Aumento de intensidade/velocidade', 'Troca de calçado', 'Mudança de terreno/superfície', 'Retorno após pausa', 'Pouca recuperação/sono', 'Prova/competição próxima'] },
  { k: 'prova', rot: 'Próxima prova ou objetivo', tipo: 'texto' },
] };
const blocoQueixa = (esporte) => ({ titulo: 'Queixa e história', perguntas: [
  { k: 'regiao', rot: 'Região', tipo: 'varios', ops: Object.keys(TESTES) },
  { k: 'lado', rot: 'Lado', tipo: 'um', ops: ['Direito', 'Esquerdo', 'Bilateral'] },
  { k: 'queixa_txt', rot: 'Queixa nas palavras do paciente', tipo: 'texto' },
  { k: 'inicio', rot: 'Início', tipo: 'um', ops: ['Súbito (evento definido)', 'Gradual/insidioso'] },
  { k: 'tempo', rot: 'Tempo de evolução', tipo: 'um', ops: ['< 6 semanas (agudo)', '6 semanas a 3 meses (subagudo)', '> 3 meses (crônico)'] },
  { k: 'mecanismo', rot: 'Mecanismo', tipo: 'varios', ops: ['Entorse', 'Trauma direto', 'Sprint/aceleração', 'Salto/aterrissagem', 'Mudança de direção', 'Sobrecarga repetitiva', 'Sem mecanismo claro'] },
  { k: 'eva_rep', rot: 'Dor em repouso (EVA)', tipo: 'eva' },
  { k: 'eva_esf', rot: esporte ? 'Dor no esporte/esforço (EVA)' : 'Dor ao esforço (EVA)', tipo: 'eva' },
  { k: 'tipo_dor', rot: 'Característica', tipo: 'varios', ops: ['Pontada', 'Queimação', 'Peso/cansaço', 'Choque/formigamento', 'Rigidez'] },
  { k: 'comport', rot: 'Comportamento da dor', tipo: 'varios', ops: ['Piora no início e melhora com aquecimento', 'Piora durante a atividade', 'Piora após a atividade', 'Rigidez matinal', 'Piora ao subir/descer escadas', 'Piora ao ficar sentado', 'Dor noturna', 'Dor em repouso'] },
  { k: 'impacto', rot: esporte ? 'Impacto no treino' : 'Impacto nas atividades', tipo: 'um', ops: esporte
    ? ['Treina sem limitação', 'Treina com dor', 'Reduziu volume/intensidade', 'Parou de treinar']
    : ['Sem limitação nas atividades diárias', 'Limitação leve', 'Limitação moderada', 'Limitação importante'] },
  { k: 'hist', rot: 'Antecedentes', tipo: 'varios', ops: ['Lesão prévia na mesma região', 'Cirurgia prévia na região', 'Fisioterapia prévia', 'Infiltração recente', 'Uso de anti-inflamatório', 'Exame de imagem realizado'] },
  { k: 'hist_txt', rot: 'Medicamentos, exames e cirurgias (detalhar)', tipo: 'texto' },
] });
const blocoBandeiras = { titulo: 'Bandeiras vermelhas (triagem)', perguntas: [
  { k: 'bv', rot: 'Marque o que estiver presente', tipo: 'varios', ops: [NENHUMA_BV, 'Dor noturna que não muda com a posição', 'Perda de peso inexplicada', 'Febre/mal-estar geral', 'Déficit neurológico progressivo',
    'Alteração urinária/intestinal ou anestesia em sela', 'Trauma de alta energia/suspeita de fratura', 'História de câncer'] },
] };
const blocoExame = (esporte) => ({ titulo: 'Exame físico', perguntas: [
  { k: 'inspecao', rot: 'Inspeção', tipo: 'varios', ops: ['Sem alterações', 'Edema', 'Equimose', 'Deformidade', 'Hipotrofia', 'Alteração postural'] },
  { k: 'palpacao', rot: 'Palpação dolorosa em', tipo: 'texto' },
  { k: 'adm', rot: 'Amplitude de movimento', tipo: 'um', ops: ['Preservada', 'Reduzida por dor', 'Reduzida por rigidez'] },
  { k: 'adm_txt', rot: 'ADM (detalhar graus)', tipo: 'texto' },
  { k: 'forca', rot: 'Força (escala MRC)', tipo: 'um', ops: ['Grau 5 (normal)', 'Grau 4 (vence resistência moderada)', 'Grau 3 (vence só a gravidade)', 'Grau 2 ou menos'] },
  { k: 'forca_txt', rot: 'Força (grupos musculares)', tipo: 'texto' },
  { k: 'neuro', rot: 'Neurológico', tipo: 'um', ops: ['Sem alterações', 'Alteração de sensibilidade', 'Alteração de reflexos', 'Não avaliado'] },
  { k: 'testes', rot: 'Testes especiais — 1 clique = positivo, 2 = negativo, 3 = limpa', tipo: 'testes' },
  ...(esporte ? [
    { k: 'agach', rot: 'Agachamento unipodal', tipo: 'varios', ops: ['Sem compensações', 'Valgo dinâmico', 'Queda pélvica', 'Dor no movimento'] },
    { k: 'hop', rot: 'Hop test — índice de simetria (%)', tipo: 'num', min: 0, max: 150 },
  ] : []),
] });
const blocoPSFS = { titulo: 'Escala Funcional Específica do Paciente (PSFS)', dica: '0 = incapaz de realizar · 10 = realiza como antes da lesão', perguntas: [
  { k: 'psfs1', rot: 'Atividade 1', tipo: 'texto' }, { k: 'psfs1n', rot: 'Nota da atividade 1', tipo: 'eva' },
  { k: 'psfs2', rot: 'Atividade 2', tipo: 'texto' }, { k: 'psfs2n', rot: 'Nota da atividade 2', tipo: 'eva' },
  { k: 'psfs3', rot: 'Atividade 3', tipo: 'texto' }, { k: 'psfs3n', rot: 'Nota da atividade 3', tipo: 'eva' },
] };
const blocoPlanoFisio = (esporte) => ({ titulo: 'Objetivos e plano', perguntas: [
  { k: 'obj', rot: 'Objetivos', tipo: 'varios', ops: ['Analgesia', 'Controle de edema/inflamação', 'Ganho de ADM', 'Ganho de força', 'Controle neuromuscular/estabilidade',
    'Melhora da capacidade de carga do tendão', 'Correção do padrão de movimento/pisada', esporte ? 'Retorno gradual ao esporte' : 'Retorno às atividades diárias', 'Prevenção de recidiva', 'Educação em dor e manejo de carga'] },
  { k: 'cond', rot: 'Condutas', tipo: 'varios', ops: ['Terapia manual', 'Exercício terapêutico', 'Fortalecimento progressivo', 'Treino neuromuscular/proprioceptivo', ...(esporte ? ['Pliometria', 'Programa de retorno à corrida'] : []),
    'Liberação miofascial', 'Eletroterapia/termoterapia', 'Bandagem', 'Educação e ajuste de carga', 'Avaliação de palmilha 3D/baropodometria'] },
  { k: 'freq_sem', rot: 'Sessões por semana', tipo: 'num', min: 1, max: 7 },
  { k: 'n_sessoes', rot: 'Sessões previstas', tipo: 'num', min: 1, max: 60 },
  { k: 'reav', rot: 'Reavaliar em (sessões)', tipo: 'num', min: 1, max: 30 },
] });

function bandeiras(st) { return (st.bv || []).filter((x) => x !== NENHUMA_BV); }
function testesTexto(st) {
  const validos = new Set((st.regiao || []).flatMap((r) => TESTES[r] || []));   // teste de região desmarcada sai do texto
  const t = Object.entries(st.testes || {}).filter(([k, v]) => v && validos.has(k));
  const pos = t.filter(([, v]) => v === '+').map(([k]) => k), neg = t.filter(([, v]) => v === '-').map(([k]) => k);
  return { pos, neg, txt: [pos.length ? `positivo(s): ${lista(pos)}` : '', neg.length ? `negativo(s): ${lista(neg)}` : ''].filter(Boolean).join('; ') };
}
function psfsTexto(st) {
  const itens = [1, 2, 3].map((i) => [st['psfs' + i], num(st['psfs' + i + 'n'])]).filter(([a, n]) => tem(a) && n !== null);
  if (!itens.length) return '';
  const media = itens.reduce((s, [, n]) => s + n, 0) / itens.length;
  return `PSFS: ${itens.map(([a, n]) => `${a} (${n}/10)`).join('; ')} — média ${media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}/10`;
}
const tempoTxt = (st) => ({ '< 6 semanas (agudo)': 'há menos de 6 semanas (agudo)', '6 semanas a 3 meses (subagudo)': 'há 6 semanas a 3 meses (subagudo)', '> 3 meses (crônico)': 'há mais de 3 meses (crônico)' }[st.tempo] || '');
const fase = (st) => (st.tempo || '').match(/\((.*)\)/)?.[1] || '';
const regiaoLado = (st) => (tem(st.regiao) ? `${min1(lista(st.regiao))}${st.lado ? ' ' + (st.lado === 'Bilateral' ? 'bilateral' : min1(st.lado)) : ''}` : '');

function gerarFisio(st, esporte) {
  const out = {};
  if (esporte) {
    const mods = [...(st.modalidade || []), st.mod_outra].filter(tem);
    out.esporte = junta(
      mods.length ? `pratica ${min1(lista(mods))}${st.nivel ? ` em nível ${min1(st.nivel)}` : ''}${tem(st.posicao) ? ` (${st.posicao})` : ''}` : '',
      [num(st.freq) !== null ? `${st.freq} treino(s)/semana` : '', tem(st.volume) ? `volume semanal ${st.volume}` : ''].filter(Boolean).join(', '),
      st.fase ? `fase: ${min1(st.fase)}` : '',
      tem(st.carga) ? `mudanças recentes de carga: ${min1(lista(st.carga))}` : '',
      tem(st.prova) ? `objetivo/próxima prova: ${st.prova}` : '');
  }
  out.queixa = junta(regiaoLado(st) ? `dor em ${regiaoLado(st)}` : '', st.queixa_txt);
  const evaR = num(st.eva_rep), evaE = num(st.eva_esf);
  out.hda = junta(
    [st.inicio ? `início ${min1(st.inicio.replace(/ \(.*\)/, ''))}` : '', tempoTxt(st)].filter(Boolean).join(', '),
    tem(st.mecanismo) ? `mecanismo: ${min1(lista(st.mecanismo))}` : '',
    tem(st.tipo_dor) ? `dor em ${min1(lista(st.tipo_dor))}` : '',
    tem(st.comport) ? min1(lista(st.comport)) : '',
    [evaR !== null ? `${evaR}/10 em repouso` : '', evaE !== null ? `${evaE}/10 ${esporte ? 'no esporte/esforço' : 'ao esforço'}` : ''].filter(Boolean).join(' e ').replace(/^(.)/, 'EVA $1'),
    st.impacto ? `${esporte ? 'impacto no treino' : 'impacto funcional'}: ${min1(st.impacto)}` : '');
  const bv = bandeiras(st);
  out.historico = junta(tem(st.hist) ? lista(st.hist) : '', st.hist_txt,
    bv.length ? `⚠ Bandeiras vermelhas: ${min1(lista(bv))} — considerar encaminhamento médico antes de prosseguir` : (st.bv || []).includes(NENHUMA_BV) ? 'triagem de bandeiras vermelhas negativa' : '');
  if (evaR !== null || evaE !== null) out.eva = Math.max(evaR ?? 0, evaE ?? 0);
  const tt = testesTexto(st);
  out.exame = junta(
    tem(st.inspecao) ? `inspeção: ${min1(lista(st.inspecao))}` : '',
    tem(st.palpacao) ? `palpação dolorosa em ${st.palpacao}` : '',
    st.adm || tem(st.adm_txt) ? `ADM ${st.adm ? min1(st.adm) : ''}${tem(st.adm_txt) ? (st.adm ? ' — ' : '') + st.adm_txt : ''}` : '',
    st.forca || tem(st.forca_txt) ? `força ${st.forca ? min1(st.forca) : ''}${tem(st.forca_txt) ? (st.forca ? ' — ' : '') + st.forca_txt : ''}` : '',
    st.neuro ? `neurológico: ${min1(st.neuro)}` : '',
    tt.txt ? `testes especiais ${tt.txt}` : '',
    tem(st.agach) ? `agachamento unipodal: ${min1(lista(st.agach))}` : '',
    num(st.hop) !== null ? `hop test com índice de simetria de ${st.hop}%${Number(st.hop) < 90 ? ' (abaixo de 90%)' : ''}` : '',
    psfsTexto(st));
  out.diagnostico = regiaoLado(st) ? junta(`quadro de dor em ${regiaoLado(st)}${fase(st) ? ', ' + fase(st) : ''}${st.inicio ? ', de início ' + min1(st.inicio.replace(/ \(.*\)/, '')) : ''}${st.impacto ? ` (${min1(st.impacto)})` : ''}`,
    tt.pos.length ? `achados positivos em ${lista(tt.pos)}` : '') : '';
  out.objetivos = tem(st.obj) ? frase(lista(st.obj)) : '';
  out.plano = junta(tem(st.cond) ? `condutas: ${min1(lista(st.cond))}` : '',
    [num(st.freq_sem) !== null ? `${st.freq_sem}×/semana` : '', num(st.n_sessoes) !== null ? `previsão de ${st.n_sessoes} sessões` : '', num(st.reav) !== null ? `reavaliação em ${st.reav} sessões` : ''].filter(Boolean).join(', '));
  return out;
}

// ---------- Nutrição (1ª consulta → S do SOAPN; padrão da skill: última linha = AF) ----------
const BRISTOL = ['Tipo 1 — caroços duros separados', 'Tipo 2 — salsicha encaroçada', 'Tipo 3 — salsicha com rachaduras', 'Tipo 4 — lisa e macia',
  'Tipo 5 — pedaços macios', 'Tipo 6 — pastosa', 'Tipo 7 — líquida'];
const blocosNutri = [
  { titulo: 'Objetivo e rotina', perguntas: [
    { k: 'objetivo', rot: 'Objetivo', tipo: 'varios', ops: ['Emagrecimento', 'Ganho de massa muscular', 'Performance esportiva', 'Saúde intestinal', 'Controle glicêmico', 'Controle de colesterol/pressão', 'Gestação/lactação', 'Reeducação alimentar', 'Recuperação de lesão'] },
    { k: 'refeicoes', rot: 'Refeições por dia', tipo: 'num', min: 1, max: 10 },
    { k: 'habitos', rot: 'Hábitos', tipo: 'varios', ops: ['Pula o café da manhã', 'Belisca entre as refeições', 'Come rápido', 'Fome noturna', 'Alto consumo de ultraprocessados', 'Baixo consumo de frutas e verduras', 'Refeições fora de casa frequentes', 'Bebida açucarada frequente'] },
    { k: 'agua', rot: 'Água (litros/dia)', tipo: 'num', min: 0, max: 8, passo: 0.1 },
    { k: 'alcool', rot: 'Álcool', tipo: 'um', ops: ['Não consome', 'Ocasional', 'Semanal', 'Frequente'] },
    { k: 'restricoes', rot: 'Restrições, aversões e preferências', tipo: 'texto' },
  ] },
  { titulo: 'Intestino, sono e sintomas', perguntas: [
    { k: 'bristol', rot: 'Escala de Bristol', tipo: 'um', ops: BRISTOL },
    { k: 'evac', rot: 'Evacuações por semana', tipo: 'num', min: 0, max: 30 },
    { k: 'gi', rot: 'Sintomas gastrointestinais', tipo: 'varios', ops: ['Sem sintomas', 'Distensão/gases', 'Refluxo/azia', 'Constipação', 'Diarreia', 'Náusea'] },
    { k: 'sono', rot: 'Sono (horas/noite)', tipo: 'num', min: 0, max: 14, passo: 0.5 },
    { k: 'sono_q', rot: 'Qualidade do sono', tipo: 'um', ops: ['Boa', 'Regular', 'Ruim'] },
    { k: 'suplem', rot: 'Suplementos em uso (nome, dose, período)', tipo: 'texto' },
    { k: 'af', rot: 'Atividade física: modalidade (frequência, horário)', tipo: 'texto' },
  ] },
];
function gerarNutri(st) {
  const s = junta(
    tem(st.objetivo) ? `objetivo: ${min1(lista(st.objetivo))}` : '',
    num(st.refeicoes) !== null ? `realiza ${st.refeicoes} refeições/dia` : '',
    tem(st.habitos) ? `hábitos: ${min1(lista(st.habitos))}` : '',
    num(st.agua) !== null ? `hidratação: ${String(st.agua).replace('.', ',')} L/dia` : '',
    st.bristol || num(st.evac) !== null ? `hábito intestinal: ${[st.bristol ? 'Bristol ' + min1(st.bristol) : '', num(st.evac) !== null ? `${st.evac}×/semana` : ''].filter(Boolean).join(', ')}` : '',
    tem(st.gi) ? `sintomas GI: ${min1(lista(st.gi))}` : '',
    num(st.sono) !== null || st.sono_q ? `sono: ${[num(st.sono) !== null ? String(st.sono).replace('.', ',') + ' h/noite' : '', st.sono_q ? 'qualidade ' + min1(st.sono_q) : ''].filter(Boolean).join(', ')}` : '',
    st.alcool ? `álcool: ${min1(st.alcool)}` : '',
    tem(st.restricoes) ? `restrições/preferências: ${st.restricoes}` : '',
    tem(st.suplem) ? `suplementos: ${st.suplem}` : '');
  return { s: [s, tem(st.af) ? `AF: ${st.af}` : ''].filter(Boolean).join('\n') };
}

// ---------- Psicologia (registro documental) ----------
const blocosPsico = [
  { titulo: 'Demanda', perguntas: [
    { k: 'origem', rot: 'Chegada', tipo: 'um', ops: ['Procura espontânea', 'Encaminhamento médico', 'Encaminhamento de outro profissional', 'Escola/empresa'] },
    { k: 'demanda', rot: 'Demanda principal', tipo: 'varios', ops: ['Ansiedade', 'Humor deprimido', 'Estresse', 'Sono', 'Luto', 'Relacionamentos/família', 'Questões profissionais', 'Autoestima', 'Atenção/aprendizagem', 'Adaptação a doença ou lesão', 'Desempenho esportivo'] },
    { k: 'tempo', rot: 'Há quanto tempo', tipo: 'um', ops: ['Menos de 1 mês', '1 a 6 meses', '6 meses a 1 ano', 'Mais de 1 ano'] },
    { k: 'impacto', rot: 'Áreas afetadas', tipo: 'varios', ops: ['Sono', 'Trabalho/estudo', 'Relações', 'Alimentação', 'Lazer', 'Autocuidado'] },
    { k: 'rede', rot: 'Rede de apoio', tipo: 'um', ops: ['Presente', 'Frágil', 'Ausente'] },
    { k: 'previos', rot: 'Acompanhamentos', tipo: 'varios', ops: ['Psicoterapia prévia', 'Acompanhamento psiquiátrico', 'Uso de medicação psiquiátrica'] },
    { k: 'risco', rot: 'Avaliação de risco', tipo: 'um', ops: ['Sem indicadores de risco no momento', 'Indicadores de risco presentes — conduta registrada'] },
  ] },
  { titulo: 'Objetivos e procedimentos', perguntas: [
    { k: 'obj', rot: 'Objetivos do trabalho', tipo: 'varios', ops: ['Acolhimento e compreensão da demanda', 'Manejo da ansiedade', 'Regulação emocional', 'Fortalecimento da autoestima', 'Elaboração do luto', 'Melhora das relações', 'Orientação familiar', 'Psicoeducação'] },
    { k: 'proc', rot: 'Procedimentos', tipo: 'varios', ops: ['Entrevista inicial', 'Escuta clínica', 'Psicoeducação', 'Aplicação de instrumentos', 'Técnicas cognitivo-comportamentais', 'Técnicas de respiração/relaxamento', 'Orientação a familiares'] },
  ] },
];
function gerarPsico(st) {
  return {
    demanda: junta(st.origem ? `chegada por ${min1(st.origem)}` : '', tem(st.demanda) ? `demanda principal: ${min1(lista(st.demanda))}${st.tempo ? ', há ' + min1(st.tempo) : ''}` : '',
      tem(st.impacto) ? `com impacto em ${min1(lista(st.impacto))}` : '', st.rede ? `rede de apoio ${min1(st.rede)}` : '',
      tem(st.previos) ? `histórico: ${min1(lista(st.previos))}` : '', st.risco ? `avaliação de risco: ${min1(st.risco)}` : ''),
    objetivos: tem(st.obj) ? frase(lista(st.obj)) : '',
    procedimentos: tem(st.proc) ? frase(lista(st.proc)) : '',
  };
}

// ---------- Consulta médica ----------
const blocosMedica = [
  { titulo: 'Antecedentes', perguntas: [
    { k: 'antec', rot: 'Comorbidades e hábitos', tipo: 'varios', ops: ['HAS', 'DM2', 'Dislipidemia', 'Asma/DPOC', 'Hipotireoidismo', 'Depressão/ansiedade', 'Tabagismo', 'Etilismo', 'Alergia medicamentosa'] },
    { k: 'antec_txt', rot: 'Detalhar (cirurgias, alergias, história familiar)', tipo: 'texto' },
  ] },
  { titulo: 'Sinais vitais e exame físico', perguntas: [
    { k: 'pas', rot: 'PAS (mmHg)', tipo: 'num', min: 50, max: 260 }, { k: 'pad', rot: 'PAD (mmHg)', tipo: 'num', min: 30, max: 160 },
    { k: 'fc', rot: 'FC (bpm)', tipo: 'num', min: 20, max: 250 }, { k: 'fr', rot: 'FR (irpm)', tipo: 'num', min: 5, max: 60 },
    { k: 'tax', rot: 'Temperatura (°C)', tipo: 'num', min: 30, max: 43, passo: 0.1 }, { k: 'spo2', rot: 'SpO₂ (%)', tipo: 'num', min: 50, max: 100 },
    { k: 'geral', rot: 'Estado geral', tipo: 'um', ops: ['BEG, corado, hidratado, eupneico', 'REG', 'MEG'] },
    { k: 'acv', rot: 'Cardiovascular', tipo: 'um', ops: ['RCR 2T, BNF, sem sopros', 'Alterado (descrever)'] },
    { k: 'ar', rot: 'Respiratório', tipo: 'um', ops: ['MV presente bilateralmente, sem ruídos adventícios', 'Alterado (descrever)'] },
    { k: 'abd', rot: 'Abdome', tipo: 'um', ops: ['Flácido, indolor, RHA presentes, sem visceromegalias', 'Alterado (descrever)'] },
    { k: 'ex_txt', rot: 'Outros achados', tipo: 'texto' },
  ] },
  { titulo: 'Conduta', perguntas: [
    { k: 'cond', rot: 'Conduta', tipo: 'varios', ops: ['Orientações gerais', 'Prescrição medicamentosa', 'Solicitação de exames', 'Encaminhamento', 'Retorno agendado'] },
  ] },
];
function gerarMedica(st) {
  const sv = [num(st.pas) !== null && num(st.pad) !== null ? `PA ${st.pas}x${st.pad} mmHg` : '', num(st.fc) !== null ? `FC ${st.fc} bpm` : '', num(st.fr) !== null ? `FR ${st.fr} irpm` : '',
    num(st.tax) !== null ? `Tax ${String(st.tax).replace('.', ',')} °C` : '', num(st.spo2) !== null ? `SpO₂ ${st.spo2}%` : ''].filter(Boolean).join(', ');
  return {
    antecedentes: junta(tem(st.antec) ? lista(st.antec) : '', st.antec_txt),
    exame: junta(sv, st.geral || '', st.acv ? `ACV: ${st.acv}` : '', st.ar ? `AR: ${st.ar}` : '', st.abd ? `Abdome: ${min1(st.abd)}` : '', st.ex_txt),
    conduta: tem(st.cond) ? frase(lista(st.cond)) : '',
  };
}

// ---------- registro por modelo do prontuário ----------
export const ROTEIROS = {
  fisio_avaliacao: { blocos: [blocoQueixa(false), blocoBandeiras, blocoExame(false), blocoPSFS, blocoPlanoFisio(false)], gerar: (s) => gerarFisio(s, false) },
  fisio_esportiva: { blocos: [blocoEsporte, blocoQueixa(true), blocoBandeiras, blocoExame(true), blocoPSFS, blocoPlanoFisio(true)], gerar: (s) => gerarFisio(s, true) },
  soapn: { blocos: blocosNutri, gerar: gerarNutri, rotulo: 'Anamnese por cliques (preenche o S)' },
  psico_registro: { blocos: blocosPsico, gerar: gerarPsico },
  medica_consulta: { blocos: blocosMedica, gerar: gerarMedica },
};

// ---------- interface ----------
// alvo: contêiner do painel · form: formulário do editor (campos c_<k>) · st: estado salvo (conteudo.cliques) ou {}
export function montarPainel(alvo, modelo, form, st) {
  const R = ROTEIROS[modelo]; if (!R) return null;
  st._g ||= {};
  const desenhar = () => {
    const regs = st.regiao || [];
    const testes = [...new Set(regs.flatMap((r) => TESTES[r] || []))];
    alvo.innerHTML = R.blocos.map((b) => `<fieldset class="ck-bloco"><legend>${esc(b.titulo)}</legend>${b.dica ? `<small class="muted">${esc(b.dica)}</small>` : ''}
      ${b.perguntas.map((p) => {
        const v = st[p.k];
        if (p.tipo === 'um' || p.tipo === 'varios') return `<div class="ck-q"><span class="ck-rot">${esc(p.rot)}</span><div class="ck-ops">${p.ops.map((o) => {
          const on = p.tipo === 'um' ? v === o : (v || []).includes(o);
          return `<button type="button" class="ck${on ? ' on' : ''}${o === NENHUMA_BV ? ' ck-ok' : p.k === 'bv' ? ' ck-alerta' : ''}" data-k="${p.k}" data-t="${p.tipo}" data-v="${esc(o)}" aria-pressed="${on}">${esc(o)}</button>`; }).join('')}</div></div>`;
        if (p.tipo === 'eva') return `<div class="ck-q"><span class="ck-rot">${esc(p.rot)}</span><div class="ck-ops ck-eva">${Array.from({ length: 11 }, (_, n) =>
          `<button type="button" class="ck${num(v) === n ? ' on' : ''}" data-k="${p.k}" data-t="eva" data-v="${n}" aria-pressed="${num(v) === n}">${n}</button>`).join('')}</div></div>`;
        if (p.tipo === 'testes') return `<div class="ck-q"><span class="ck-rot">${esc(p.rot)}</span>${testes.length ? `<div class="ck-ops">${testes.map((t) => {
          const s = (st.testes || {})[t]; return `<button type="button" class="ck ck-teste${s === '+' ? ' pos' : s === '-' ? ' neg' : ''}" data-teste="${esc(t)}">${esc(t)}${s ? ' ' + (s === '+' ? '+' : '−') : ''}</button>`; }).join('')}</div>`
          : '<small class="muted">Escolha a região na queixa para ver os testes.</small>'}</div>`;
        return `<label class="ck-q ck-campo"><span class="ck-rot">${esc(p.rot)}</span><input data-k="${p.k}" ${p.tipo === 'num' ? `type="number" min="${p.min ?? ''}" max="${p.max ?? ''}" step="${p.passo || 1}"` : ''} value="${esc(v ?? '')}"></label>`;
      }).join('')}</fieldset>`).join('');
    const bv = bandeiras(st);
    if (bv.length) alvo.insertAdjacentHTML('afterbegin', `<div class="ck-aviso">⚠ Bandeira vermelha marcada (${esc(lista(bv))}): considerar encaminhamento médico antes de prosseguir.</div>`);
    $$('button.ck[data-k]', alvo).forEach((b) => (b.onclick = () => {
      const { k, t, v } = b.dataset;
      if (t === 'um' || t === 'eva') st[k] = (t === 'eva' ? num(st[k]) === Number(v) : st[k] === v) ? undefined : (t === 'eva' ? Number(v) : v);
      else {
        let a = st[k] || []; a = a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
        const neutro = { bv: NENHUMA_BV, inspecao: 'Sem alterações', gi: 'Sem sintomas', agach: 'Sem compensações' }[k];
        if (neutro) a = v === neutro && a.includes(neutro) ? [neutro] : a.filter((x) => x !== neutro);
        st[k] = a;
      }
      aplicar(); desenhar();
    }));
    $$('button[data-teste]', alvo).forEach((b) => (b.onclick = () => {
      const t = b.dataset.teste, s = (st.testes ||= {})[t];
      st.testes[t] = s === '+' ? '-' : s === '-' ? undefined : '+';
      if (!st.testes[t]) delete st.testes[t];
      aplicar(); desenhar();
    }));
    $$('input[data-k]', alvo).forEach((i) => (i.oninput = () => { st[i.dataset.k] = i.type === 'number' ? (i.value === '' ? undefined : Number(i.value)) : i.value; aplicar(); }));
  };
  // Escreve o texto gerado sem apagar o que o profissional digitou
  const aplicar = () => {
    const out = R.gerar(st);
    for (const [k, txt] of Object.entries(out)) {
      const el = form.elements['c_' + k]; if (!el) continue;
      const novo = txt === undefined || txt === null ? '' : String(txt), prev = st._g[k] || '', cur = el.value;
      if (!cur.trim() || cur === prev) el.value = novo;
      else if (prev && cur.includes(prev)) el.value = (novo ? cur.replace(prev, novo) : cur.replace(prev, '')).trim();
      else if (novo) el.value = cur.replace(/\s*$/, '') + '\n' + novo;
      st._g[k] = novo;
    }
  };
  desenhar();
  return { estado: () => { const { _g, ...resto } = st; return Object.keys(resto).some((k) => tem(resto[k]) && !(typeof resto[k] === 'object' && !Array.isArray(resto[k]) && !Object.keys(resto[k]).length)) ? st : null; } };
}

export const temRoteiro = (modelo) => !!ROTEIROS[modelo];
