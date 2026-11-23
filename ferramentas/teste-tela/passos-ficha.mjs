// Passos da ficha do profissional: gestão edita o pagamento (modal); profissional pede troca.
export default async (pagina) => {
  if (pagina.url().includes('#cadastro')) {
    await pagina.click('#troca');
    await pagina.fill('#msg', 'Nova conta de teste');
    await pagina.click('#env');
  } else {
    await pagina.click('#ed-pag');
    await pagina.fill('input[name="agencia"]', '0002');
    await pagina.click('#salvar');
  }
  await pagina.waitForTimeout(500);
};
