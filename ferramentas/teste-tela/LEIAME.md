# Teste de tela sem rede (Supabase de mentira)

Abre o app num Chrome sem cabeça, troca o cliente Supabase do `js/core.js` por `sb-falso.js` e falha se a tela soltar erro de
JavaScript, `console.error` ou toast de erro. Serve para o modelo que mexeu num módulo conferir **só a tela tocada** antes do commit.

```
node ferramentas/teste-tela/rodar.mjs <rota> [--perfil gestor|financeiro|recepcao|profissional] [--modo profissional]
     [--fixtures a.js,b.js] [--modulo js/modulos/x.js] [--script passos.mjs] [--shot /tmp/tela.png] [--inteira] [--texto] [--escritas] [--tamanho 390x800]
```
- `fixtures-base.js` cria clínica, 2 profissionais, 4 pacientes e atendimentos em torno de hoje. Fixtures extras (`--fixtures`) rodam depois e
  acrescentam em `window.__FIXTURES.tabelas.<tabela>` e `.rpc.<função>` (valor fixo ou `(args, fx) => valor`). Ajudantes em `window.__fx` (`dia`, `iso`, `dt`). Pacientes têm id `00000000-0000-4000-8000-00000000000N` (N = 1…4) porque a rota da ficha espera UUID.
- Selects aninhados (`pacientes(nome)`) não são resolvidos: a linha da fixture já deve trazer o objeto embutido.
- `.or()` e `.filter()` são ignorados (devolvem tudo). RPC sem fixture devolve erro — é o aviso de que falta a fixture.
- `--modulo js/modulos/x.js [--params abc]`: importa o módulo e chama `render(params)` — para testar módulo que ainda não está nas rotas do `main.js`.
- `--script`: módulo com `export default async (pagina, { erros }) => { … }` (Playwright) para clicar e conferir; `--escritas` lista o que a tela gravou.
- Não substitui o teste de RLS: regra de banco se testa com SQL (`ferramentas/testes-sql/`), nunca aqui.
- Nunca colocar dado real de paciente em fixture (repositório público).
