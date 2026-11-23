// Passos da ficha do profissional: gestão salva o pagamento; profissional pede troca.
export default async (pagina, { erros }) => {
  if (pagina.url().includes('#cadastro')) {
    await pagina.click('#troca');
    await pagina.fill('#msg', 'Nova conta de teste');
    await pagina.click('#env');
  } else {
    await pagina.fill('input[name="agencia"]', '0002');
    await pagina.click('#salvar');
  }
  await pagina.waitForTimeout(500);
};
