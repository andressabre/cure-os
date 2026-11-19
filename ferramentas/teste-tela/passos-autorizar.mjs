// Passos da tela Autorizar guias: marca as prontas, envia para a fila e cancela um pedido. Uso: --script ferramentas/teste-tela/passos-autorizar.mjs --escritas
import assert from 'node:assert/strict';
export default async (pagina) => {
  await pagina.waitForSelector('.au-item');
  assert.equal(await pagina.locator('input[data-aut]:disabled').count(), 5, '5 bloqueadas desabilitadas');
  await pagina.click('#au-marcar');
  assert.equal(await pagina.locator('input[data-aut]:checked').count(), 2, 'marca só as 2 liberadas (pronta + confira)');
  assert.match(await pagina.textContent('#au-enviar'), /Enviar 2 para o robô/);
  await pagina.click('#au-enviar');
  await pagina.waitForTimeout(300);
  await pagina.click('[data-cancelar="fr-2"]');
  await pagina.click('#ok');
  await pagina.waitForTimeout(300);
};
