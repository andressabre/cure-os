// 1) o combo aparece como UM bloco com os dois procedimentos; 2) "+ Agendamento" oferece "Agendar junto" e grava 2 atendimentos com o mesmo combo_id.
export default async (pagina, { erros }) => {
  const blocos = await pagina.locator('.ag-ev:has-text("Carla Teste")').count();
  if (blocos !== 1) erros.push(`combo deveria ser 1 bloco, achei ${blocos}`);
  const txt = await pagina.locator('.ag-ev:has-text("Carla Teste")').first().innerText();
  if (!/Bioimped/.test(txt) || !/Consulta/.test(txt)) erros.push('bloco do combo sem a descrição dos dois procedimentos: ' + txt);
  await pagina.click('#novo');
  await pagina.fill('#pbusca', 'Carla'); await pagina.waitForTimeout(500);
  await pagina.click('[data-id="00000000-0000-4000-8000-000000000001"]'); await pagina.waitForTimeout(500);
  await pagina.selectOption('#c-plano', 'cb-pl');
  await pagina.selectOption('#c-aut', 'cb-au3'); await pagina.waitForTimeout(300);
  const tem = await pagina.locator('.c-junto').count();
  if (tem !== 1) erros.push(`"agendar junto" deveria listar 1 procedimento, listou ${tem}`);
  await pagina.check('.c-junto');
  await pagina.click('#s'); await pagina.waitForTimeout(800);
};
