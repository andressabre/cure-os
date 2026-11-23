// Filtra por chips e confere que a linha glosada mostra código e orientação.
export default async (pagina) => {
  await pagina.click('[data-f="glosado"]');
  const t = await pagina.textContent('#extrato-corpo');
  if (!t.includes('1801') || !t.includes('Conferir a senha') || t.includes('Paciente A')) throw new Error('filtro Glosados não bateu');
  await pagina.click('[data-f="aguardando"]');
  if (!(await pagina.textContent('#extrato-corpo')).includes('Enviado, aguardando pagamento')) throw new Error('etapa não apareceu');
};
