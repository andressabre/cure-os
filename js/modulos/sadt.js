// Guia SP/SADT preenchida sobre o modelo em branco da operadora (TISS 3.01.002), gerada no navegador.
// Modelo + geometria dos campos em /modelos (sadt-<modelo>.pdf e .layout.json). Os códigos do prestador, CNES, Registro ANS
// e solicitante NÃO ficam no código: vêm de contratos.regras.autorizacao e do cadastro (banco).
import { sb, estado, toast, falha } from '../core.js';
import { enviarArquivo, removerArquivo } from './documentos.js';

const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
const CONSELHO = { CRAS: '01', COREN: '02', CRF: '03', CRFA: '04', CREFITO: '05', CRM: '06', CRN: '07', CRO: '08', CRP: '09' };
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const ddmmaaaa = (iso) => (iso ? iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(0, 4) : '');

export const temModeloSadt = (contrato) => !!contrato?.regras?.autorizacao?.modelo_sadt;

// a = autorização clicada; ctx = { paciente, plano (com contratos), auts (todas do paciente) }
export async function gerarSadt(a, ctx) {
  const reg = ctx.plano?.contratos?.regras?.autorizacao || {};
  const modelo = reg.modelo_sadt;
  if (!modelo) return toast('Este convênio ainda não tem modelo de SADT configurado.', true);
  if (!a.numero_guia_operadora) return toast('Preencha o nº da guia da operadora antes de gerar a SADT.', true);
  const janela = window.open('', '_blank');   // abre já no clique (bloqueador de pop-up)
  try {
    const base = new URL(`../../modelos/sadt-${modelo}`, import.meta.url).href;
    const [layout, molde, lib, num] = await Promise.all([
      fetch(base + '.layout.json').then((r) => r.json()),
      fetch(base + '.pdf').then((r) => r.arrayBuffer()),
      import(PDFLIB),
      sb.rpc('numero_guia_prestador_aut', { p_aut: a.id }),
    ]);
    if (num.error) throw num.error;
    const irmas = ctx.auts.filter((k) => k.paciente_plano_id === a.paciente_plano_id && k.numero_guia_operadora === a.numero_guia_operadora).slice(0, 5);
    const { data: sol } = a.solicitante_id ? await sb.from('solicitantes').select('nome, conselho, numero_conselho, uf_conselho, cbo').eq('id', a.solicitante_id).single() : {};
    const p = ctx.paciente;
    const doc = await lib.PDFDocument.load(molde);
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    const pg = doc.getPage(0), H = layout.H;
    const desenha = (txt, x, base, size) => pg.drawText(String(txt), { x, y: H - base, size, font });
    const comb = (c, texto) => {
      texto = String(texto ?? ''); if (!texto || !c) return;
      let cs = c.cells; if (texto.length > cs.length) texto = texto.slice(0, cs.length);
      if (c.right) cs = cs.slice(cs.length - texto.length);
      [...texto].forEach((ch, i) => { const [x0, x1] = cs[i]; desenha(ch, (x0 + x1) / 2 - font.widthOfTextAtSize(ch, c.size) / 2, c.base, c.size); });
    };
    const livre = (c, texto, size = 8.5) => {
      texto = String(texto ?? ''); if (!texto) return;
      let s = c.size || size; while (c.maxw && font.widthOfTextAtSize(texto, s) > c.maxw && s > 5) s -= 0.5;
      desenha(texto, c.x, c.base, s);
    };
    const C = layout.comb, L = layout.livre;
    livre(L.guia_prestador, num.data);
    comb(C.ans, dig(reg.registro_ans));
    livre(L.guia_operadora, a.numero_guia_operadora);          // senha (campo 5) fica em branco, como no portal
    comb(C.carteira, dig(ctx.plano.carteirinha));
    comb(C.val_cart, ddmmaaaa(ctx.plano.validade));
    livre(L.nome, p.nome);
    comb(C.cns, dig(p.cns));
    livre(L.rn, 'N');
    comb(C.sol_cod, dig(reg.codigo_prestador)); livre(L.sol_contratado, reg.prestador_nome || '');
    if (sol) {
      livre(L.sol_profissional, sol.nome);
      comb(C.conselho, CONSELHO[(sol.conselho || '').toUpperCase()] || '10');
      comb(C.sol_num, dig(sol.numero_conselho)); comb(C.uf, (sol.uf_conselho || '').toUpperCase()); comb(C.cbo, dig(sol.cbo));
    }
    comb(C.carater, '1'); comb(C.dt_solic, ddmmaaaa(a.solicitada_em || a.data_autorizacao));
    irmas.forEach((k, i) => {
      const r = layout.procs[i];
      comb(r.tabela, '22'); comb(r.codigo, dig(k.procedimentos?.codigo));
      livre({ x: L.desc_x, base: r.desc_base, size: 7.5 }, semAcento(k.procedimentos?.descricao).slice(0, 80));
      comb(r.qtd_sol, String(k.qtd_solicitada || 1)); comb(r.qtd_aut, String(k.qtd_autorizada || 1));
    });
    comb(C.exec_cod, dig(reg.codigo_prestador)); livre(L.exec_nome, reg.prestador_nome || ''); comb(C.cnes, dig(reg.cnes));
    const bytes = await doc.save();
    const nome = `SADT_${a.numero_guia_operadora}.pdf`;
    const arquivo = new File([bytes], nome, { type: 'application/pdf' });
    // guarda no paciente (mesma pasta/slot da "guia da operadora") para todas as linhas da guia
    const up = await enviarArquivo(arquivo, `pacientes/${p.id}/autorizacoes`);
    const ids = irmas.map((k) => k.id);
    const { error } = await sb.from('autorizacoes').update({ guia_arquivo: up.arquivo, guia_arquivo_nome: up.arquivo_nome }).in('id', ids);
    if (error) throw error;
    for (const k of irmas) if (k.guia_arquivo) await removerArquivo(k.guia_arquivo).catch(() => {});
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (janela) janela.location = url; else window.open(url, '_blank');
    toast(`SADT gerada e salva no paciente (nº ${num.data}).`);
    return true;
  } catch (e) { janela?.close(); falha(e, 'Gerar SADT'); return false; }
}
