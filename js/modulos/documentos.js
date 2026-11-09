// Arquivos no Storage privado "documentos" (caminho <clinica_id>/<pasta>/<uuid>.<ext>).
// Formatos e limite seguem o portal SulAmérica: JPG, JPEG, PDF, PNG, TIFF, até 10 MB.
import { sb, estado, toast } from '../core.js';

const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff'];
export const ACEITA = EXT.map((e) => '.' + e).join(',');

export async function enviarArquivo(arquivo, pasta) {
  const ext = (arquivo.name.split('.').pop() || '').toLowerCase();
  if (!EXT.includes(ext)) throw new Error('Formato não aceito. Use PDF, JPG, PNG ou TIFF.');
  if (arquivo.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB (limite do portal da operadora).');
  const caminho = `${estado.clinica.id}/${pasta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('documentos').upload(caminho, arquivo, { contentType: arquivo.type || undefined });
  if (error) throw error;
  return { arquivo: caminho, arquivo_nome: arquivo.name };
}

export async function abrirArquivo(caminho) {
  const janela = window.open('', '_blank');   // abre já no clique (bloqueador de pop-up)
  const { data, error } = await sb.storage.from('documentos').createSignedUrl(caminho, 300);
  if (error) { janela?.close(); return toast('Não foi possível abrir o arquivo: ' + error.message, true); }
  if (janela) janela.location = data.signedUrl; else location.href = data.signedUrl;
}

// Pede um arquivo ao usuário (input invisível) e devolve o File escolhido
export function escolherArquivo() {
  return new Promise((res) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', accept: ACEITA });
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
