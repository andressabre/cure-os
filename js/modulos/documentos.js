// Arquivos no Storage privado "documentos" (caminho <clinica_id>/<pasta>/<uuid>.<ext>).
// Formatos e limite seguem o portal SulAmérica: JPG, JPEG, PDF, PNG, TIFF, até 10 MB.
import { sb, estado, toast } from '../core.js';

const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff'];
export const ACEITA = EXT.map((e) => '.' + e).join(',');

// Foto de celular (3–5 MB) vira JPEG de até 2000 px, ~300 KB, ainda legível para a operadora
async function comprimir(arquivo) {
  if (!/^image\/(jpeg|png)$/.test(arquivo.type) || arquivo.size < 600 * 1024) return arquivo;
  try {
    const img = await createImageBitmap(arquivo), lado = 2000, k = Math.min(1, lado / Math.max(img.width, img.height));
    const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.8));
    return blob && blob.size < arquivo.size ? new File([blob], arquivo.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : arquivo;
  } catch { return arquivo; }
}

export async function enviarArquivo(original, pasta) {
  const arquivo = await comprimir(original);
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
