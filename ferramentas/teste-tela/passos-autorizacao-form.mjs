// Registra guia com 2 procedimentos e edita a guia existente (adiciona um 2º código) — confere o que foi gravado.
export default async (pagina, { erros }) => {
  await pagina.click('#abrir-aut');
  await pagina.fill('.lp-busca', 'consulta'); await pagina.locator('.lp-busca').blur(); await pagina.fill('.lp-qtd', '1');
  await pagina.click('#add-proc');
  await pagina.locator('.lp-busca').nth(1).fill('bioimp'); await pagina.locator('.lp-busca').nth(1).blur(); await pagina.locator('.lp-qtd').nth(1).fill('1');
  await pagina.fill('#f input[name="senha"]', '555'); await pagina.fill('#f input[name="guia"]', '777');
  await pagina.fill('#f input[name="validade"]', '2099-01-01');
  await pagina.click('#s'); await pagina.waitForTimeout(600);
  await pagina.click('.aut-bloco summary'); await pagina.click('[data-edaut] >> nth=0'); await pagina.waitForTimeout(300);
  const n = await pagina.locator('.lp').count();
  if (n < 1) erros.push('Editar não abriu o formulário com linhas de procedimento');
  await pagina.click('#add-proc'); await pagina.locator('.lp-busca').last().fill('4080'); await pagina.locator('.lp-busca').last().blur();
  await pagina.click('#s'); await pagina.waitForTimeout(600);
};
