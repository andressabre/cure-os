# Cure OS — manual do construtor (para qualquer modelo que for mexer no repositório)

> Leia junto com o `CLAUDE.md` (contexto técnico) e o `docs/BACKLOG-30.md` (o que falta). Este arquivo diz **como** trabalhar.
> Repositório público: nenhum valor de contrato, CNPJ de terceiro, código de prestador, dado de portal ou dado de paciente entra aqui.

## 1. Regras fixas

1. **Um módulo, um arquivo.** Tela nova = `js/modulos/<nome>.js` exportando `export async function render(params)`.
   Estilo novo = `css/<nome>.css` (classes com prefixo curto do módulo, cores só pelas variáveis de `css/app.css`), ligado no `index.html`.
2. **Não tocar sem card aprovado:** `js/core.js`, `js/main.js`, `index.html`, `css/app.css`, RLS, `guia_atendimento*`, XML TISS, repasse.
   Quem integra rota/menu/aba é o arquiteto (modelo maior), depois de revisar.
3. **Sem build, sem biblioteca nova, sem CDN novo, sem custo** (Supabase gratuito, nada de API paga).
4. **Segurança de tela:** todo valor vindo do banco passa por `esc()` antes de entrar em HTML; nada de `onclick="…${valor}…"` com dado do banco.
   A tela nunca é a proteção — quem protege é a RLS. Se a tela precisa de dado que a RLS não entrega, o caminho é uma função no banco com card, não um atalho.
5. **`confirmar()` apaga o modal aberto:** ler todos os campos do formulário antes de chamar.
6. **Datas:** `inicio`/`fim` são `timestamptz`; dia local = `new Date(x).toLocaleDateString('sv')`. Colunas `date` chegam como `AAAA-MM-DD` (usar `data()` do core para mostrar).
7. **Dinheiro e perfil:** profissional nunca vê quanto a clínica recebe. `podeGerir()` decide o que aparece; no modo profissional o sócio enxerga como profissional.
8. **Migração:** arquivo `db/0NN_<nome>.sql` numerado em sequência; política sempre `TO authenticated`; função `SECURITY DEFINER` só com
   `set search_path = public`, checagem de perfil dentro e `revoke execute … from public, anon`. Depois de aplicar: `get_advisors(security)` +
   `ferramentas/auditoria-rls.sql` (devem voltar só os alertas esperados do `CLAUDE.md`). Modelo pequeno **escreve** a SQL; modelo maior revisa e aplica.
9. **Teste só do que foi tocado**, com `ferramentas/teste-tela/` (ver LEIAME de lá) para tela e SQL em transação com `rollback` para regra de banco.
10. **Registro:** 1 parágrafo no `CLAUDE.md` na seção de funcionalidades + `db/0NN` na mensagem do commit. Autor do commit: "Andressa Brenneisen".

## 2. Peças prontas para reaproveitar

| Preciso de | Use |
|---|---|
| Título da tela + botões do topo | `tela(titulo, acoesHtml)` → devolve o contêiner `#conteudo` |
| Janela / confirmação / aviso | `modal(html, (caixa, fechar) => …)`, `confirmar(texto, rotulo)`, `toast(msg, erro)`, `falha(error, contexto)` |
| Formatação | `brl`, `pct`, `data`, `esc`, `foneFmt`, `mascaraFone`, `normCid`, `descricaoCid` |
| Sessão | `estado.clinica.id`, `estado.perfil` (já considera a chave Gestão ↔ Profissional), `estado.perfilReal`, `estado.profissionalId`, `podeGerir()` |
| Blocos visuais | `.cartao`, `.kpis` > `.kpi` (`.rotulo` `.valor` `.sub`, variante `.alerta`), `.selo` (`ok` `alerta` `pendente` `outra`), `.btn` (`primario` `fantasma`), `.vazio`, `.muted`, `.barra > span`, `.linha-acoes`, `.abas`, `.chip-filtro`, `.tabela-rolagem`, `td.num` |
| Link de WhatsApp | `foneWhats()` exportado de `js/modulos/agenda.js` + `https://wa.me/<fone>?text=…` |
| Abrir a ficha | `location.hash = 'paciente-<uuid>'` ou `'paciente-<uuid>-<aba>'` |

## 3. Card de tarefa (copiar e preencher antes de começar)

```
Item: <código do backlog ou nome>
Objetivo (1 frase):
Arquivos que PODEM ser tocados:
Regras que NÃO mudam: (copiar do CLAUDE.md as que tangenciam o item)
Dados: nenhum valor/CNPJ/código de prestador/paciente real no repo. Custos: zero.
Testes: node ferramentas/teste-tela/rodar.mjs … (só o módulo tocado) [+ SQL em rollback, se houver migração]
Pronto quando: <critério verificável>
Registro: 1 parágrafo no CLAUDE.md + "db/0NN" no commit.
```

## 4. Relatório de entrega (o que o construtor devolve ao arquiteto)

Arquivos criados/alterados · como integrar (rota: id, nome, perfis; ou função exportada) · o que foi testado e o comando · o que a tela
supõe sobre o banco (tabelas, colunas, RPC) · limitações conhecidas · dúvidas de regra de negócio que só a gestora responde.
