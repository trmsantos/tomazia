# R-01 Base do redesign B: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans, tarefa a tarefa. Passos com caixas (`- [ ]`).

**Objetivo:** trocar a letra, os tokens de forma e de papel e o aspeto dos componentes de `components/ui/` para a direção B, sem mudar o fundo de nenhuma página.
**Arquitetura:** tudo continua a passar por `tokens.css` → `tailwind.config.ts` → papéis por âmbito. Entram dois âmbitos novos (`.superficie-papel`, `.superficie-destaque`), uma variante `dourado` do `Botao` com borda própria por âmbito, um componente `Cartao`, e duas letras variáveis servidas de `public/fontes/`. Os ecrãs não mudam de layout: herdam a letra e os componentes.
**Stack:** React + TypeScript + Vite + Tailwind 3.4, Vitest + Testing Library, Playwright + axe; `fonttools` só como ferramenta pontual (`uvx`), nunca dependência.
**Spec:** docs/superpowers/specs/2026-11-26-redesign-b-design.md

## Restrições globais

- CSP de produção: `default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self' data:` (`deploy/htaccess.exemplo:57`). Sem `style` inline, sem fontes de outro domínio, sem `data:` em `@font-face`.
- Hex e `color-mix` só em `frontend/src/styles/tokens.css`; a paleta continua com os dez hex da tabela Design (o `cores-so-nos-tokens.test.ts` exige 10).
- A única cor com nome permitida em `tokens.css` é `white`, e só dentro de `--cor-papel`.
- Componentes escrevem papéis (`bg-acao`, `bg-dourada`), nunca nomes da paleta.
- Texto visível em PT-PT (regra 6); nada de maiúsculas em etiquetas, emojis, desfoque, hover que levanta, sombras.
- Alvo de toque 44 px (`--alvo-toque`), 56 px nos botões de moderar (`--alvo-grande`); foco visível em todos os controlos.
- Corpo a 17 px, entrelinha 1,5; a escala 14/17/21/27/34 mantém-se.
- Q-02: pacote público ≤ 86 000 bytes comprimidos (`TECTO_DO_PACOTE_PUBLICO`, `frontend/src/orcamento-q02.test.ts:127`); critério 100 kB.
- Letras: as duas `.woff2` juntas ≤ 100 000 bytes. Se passar, larga-se primeiro o eixo `opsz` (decisão do Tomás, 2026-11-27); se mesmo assim passar, parar e perguntar. Nunca subir o teto sozinho.
- Um só botão `dourado` por ecrã. No R-01 nenhum ecrã o usa ainda; a regra fica no `Botao` e é medida no R-02/R-03.
- Regras do CLAUDE.md: 1 (sem `.env`), 2 (sem push para `main`), 3 (não contactar o servidor), 6, 8 (as letras não são dependência npm; `fonttools` corre por `uvx`, fora de `pyproject.toml`), 9 (não editar gerados), 10 (guardas distinguem "não encontrei" de "não consegui procurar").
- Testes que mudam por causa do redesign dizem porquê num comentário com "R-01 / ADR 0023".
- `CLAUDE.md` não se toca. `frontend/CLAUDE.md`: só as linhas 7 (paleta, "Dourado nunca sobre creme") e 8 (fontes) mudam, na Tarefa 2 (autorizado pelo Tomás, 2026-11-27).

## Foco da revisão

1. **Glifo ou recurso em falta no subconjunto.** Um `ã`, `€`, `…`, `–`, `«` fora do `cmap`, ou o `tnum` cortado das `layout-features`, cai em silêncio na letra de sistema ou desalinha os preços. Dono: Tarefa 6 (leitor de `cmap`/`GSUB` do woff2 com `zlib.brotliDecompressSync`).
2. **Intervalo de pesos desencontrado.** O `font-weight` do `@font-face`, o eixo `wght` do ficheiro e os `--peso-*` usados por cada família têm de coincidir; com `font-synthesis: none` um 500 pedido à Bricolage (a maqueta pede-o) sai noutro peso sem erro. Dono: Tarefas 6 e 7.
3. **A borda do dourado a desaparecer num âmbito.** `--cor-contorno-dourada` declarada só num sítio, ou o dourado dentro de papel dentro de destaque, ou a exceção ao teste "nenhum papel do creme é dourado" alargada demais. Dono: Tarefa 4 (par `contorno-dourada` × `fundo-local` ≥ 3 nos cinco âmbitos) e Tarefa 11 (cor computada da borda no browser).
4. **Âmbito com `color-mix` medido como "não sei".** O `resolver` de `src/testes/tokens.ts` devolve `null` para `color-mix`; sem mudança, os pares de `.superficie-papel` não são medidos e o teste passa. Dono: Tarefa 3 (`null` num par obrigatório passa a falhar).
5. **Chão da opacidade do desativado em `.superficie-destaque`.** Anel dourado a 0,6 sobre bordo-tomazia dá ≈ 3,0 (sem folga). Por isso o foco no destaque é creme-papel (≈ 4,5). Dono: Tarefa 4 (alargar `foco-no-desativado.test.ts` aos cinco âmbitos).

---

## Mapa de ficheiros

| Ação | Caminho | Responsabilidade |
| --- | --- | --- |
| Criar | `docs/ecras/R-01.md` | Valores e decisões visuais do R-01, confirmados pela ui-ux |
| Criar | `docs/decisoes/0023-redesign-b-letra-forma-e-superficies.md` | ADR 0023 |
| Modificar | `docs/ESPECIFICACAO.md` | Secção Design reescrita; linha 144 (Playfair → Bricolage) |
| Modificar | `docs/TAREFAS.md` | Secção "Redesign" com R-01/R-02/R-03 antes da F3-09 |
| Modificar | `frontend/src/testes/tokens.ts` | `resolver` sabe `color-mix` em srgb; `AMBITOS` com cinco |
| Modificar | `frontend/src/styles/tokens.css` | Âmbitos papel e destaque, dourada, forma, tipografia |
| Modificar | `frontend/src/styles/global.css` | Fundo dos âmbitos novos, `.font-seccao`, `.cartao-destaque::after` |
| Modificar | `frontend/tailwind.config.ts` | Índices novos (cores, raios, contorno, pesos, família) |
| Substituir | `frontend/public/fontes/*.woff2`, `OFL.txt`, `PROVENIENCIA.md` | Bricolage + DM Sans; saem Playfair e Source Sans 3 |
| Modificar | `frontend/src/styles/fontes.css`, `frontend/index.html` | Duas faces variáveis, dois preloads |
| Criar | `frontend/src/testes/woff2.ts` | Ler tabelas (`cmap`, `GSUB`, `fvar`) de um woff2, sem dependências |
| Modificar | `frontend/src/components/ui/Botao.tsx` | Variante `dourado`, `principal` no creme, `data-variante`, raio |
| Modificar | `Campo.tsx`, `Chip.tsx`, `Folha.tsx`, `AvisoTemporario.tsx`, `EstadoVazio.tsx`, `LinhaDeProduto.tsx` | Aspeto B |
| Criar | `frontend/src/components/ui/Cartao.tsx` | Cartão papel e cartão de destaque |
| Modificar | `frontend/src/testes/componentes.ts` | Sentinela inclui `Cartao.tsx` |
| Modificar | `frontend/src/demonstracao/PaginaDemonstracao.tsx`, `frontend/e2e/apoio/pagina.ts` | Secções papel e destaque, variante dourada, Cartão |
| Modificar | `frontend/e2e/componentes.spec.ts`, `eventos.spec.ts`, `ementa-pixeis.spec.ts` | Testes que fixavam a letra ou o "dourado nunca no creme" |
| Criar | `docs/ecras/capturas/redesign/*.png`, `docs/ecras/capturas/redesign/LEIA-ME.md` | Capturas das maquetas e de onde vieram |
| Criar | `docs/ecras/capturas/R-01/*.png` | Componentes a 390×844 nos âmbitos |

Valores fixados por este plano (a ui-ux confirma ou corrige na Tarefa 1, antes de qualquer código):

| Token | Valor |
| --- | --- |
| `--raio-pequeno` | 10px (etiquetas, miniaturas, barras do horário) |
| `--raio-campo` | 12px |
| `--raio-botao` | 14px (botões; bloco da data no R-02) |
| `--raio-cartao` | 18px |
| `--raio-grande` | 24px (cartão de destaque, topo da Folha) |
| `--raio-barra` | 22px (barra da gestão, R-03) |
| `--contorno-medio` | 1.5px (botão dourado e secundário) |
| `--cor-papel` | `color-mix(in srgb, var(--cor-creme-papel) 25%, white)` (≈ `#fdf9f4`; maqueta `#fffaf3`) |
| `--cor-decoracao-destaque` | `color-mix(in srgb, var(--cor-dourado-latao) 18%, transparent)` |
| `--decoracao-destaque` / `--decoracao-afastamento` | 150px / -40px |
| `--fonte-titulo` | `"Bricolage Grotesque", -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--fonte-corpo` | `"DM Sans", -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--peso-normal` / `--peso-medio` / `--peso-forte` | 400 / 500 / 700 (DM Sans) |
| `--peso-seccao` / `--peso-titulo` | 700 / 800 (Bricolage) |
| `--espacejamento-titulo` | -0.02em |

Papéis por âmbito (o que muda; o resto como hoje):

| Papel | escura / painel | creme | papel | destaque |
| --- | --- | --- | --- | --- |
| `--cor-fundo-local` | noite / vinho | creme-papel | `--cor-papel` | bordo-tomazia |
| `--cor-acao` | dourado | **bordo-noite** (era tomazia) | bordo-noite | dourado |
| `--cor-texto-sobre-acao` | bordo-noite | creme-papel | creme-papel | bordo-noite |
| `--cor-acao-dourada` | dourado | dourado | dourado | dourado |
| `--cor-texto-sobre-dourada` | bordo-noite | bordo-noite | bordo-noite | bordo-noite |
| `--cor-contorno-dourada` | dourado | **bordo-noite** | **bordo-noite** | dourado |
| `--cor-foco` | dourado | tomazia | tomazia | **creme-papel** |
| `--cor-texto` / `--cor-texto-suave` | creme / sombra | noite / tomazia | noite / tomazia | creme-papel / creme-sombra |
| `--cor-erro` | erro-escuro | erro-creme | erro-creme | **creme-papel** (o erro diz-se em texto: erro-escuro dá 4,13) |
| `--cor-perigo` / sobre | erro-escuro / noite | erro-creme / creme | erro-creme / creme | erro-creme / creme |
| `--cor-sucesso` | sucesso-escuro | sucesso-creme | sucesso-creme | sucesso-escuro (≈ 5,2) |
| `--cor-contorno` | sombra | tomazia | tomazia | creme-sombra |
| `--cor-fio-interno` | repetido em **cada** âmbito (nota em `tokens.css:311`) |

---

### Tarefa 1: valores visuais do R-01 (ui-ux)

**Ficheiros:** Criar `docs/ecras/R-01.md`.
**Interfaces:** Consome as duas tabelas acima e as maquetas. Produz a lista final de tokens, papéis, classes de cada componente e a confirmação (ou recusa) da borda bordo-noite no dourado sobre creme, com os contrastes calculados.

- [ ] Confirmar a borda de 1,5 px: contorno do controlo bordo-noite × creme ≥ 3 (1.4.11) e texto bordo-noite × dourado ≥ 4,5. Se recusar, a variante `dourado` fica só para âmbitos escuro/destaque, e a Tarefa 8 muda em conformidade.
- [ ] Fixar as classes de cada componente (secção "Componentes" do `R-01.md`): Botão (cinco variantes), Campo, Chip, Folha, Aviso, Estado vazio, Linha de produto, Interruptor, Cartão.
- [ ] Decidir se o Chip inativo tem preenchimento `bg-papel` no creme (a maqueta) e manter `border-contorno` (1.4.11).
- [ ] Commit:
```
docs(ecras): valores visuais do R-01

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 2: ADR 0023, especificação e tarefas (arquiteto, só `docs/`)

**Ficheiros:** Criar `docs/decisoes/0023-redesign-b-letra-forma-e-superficies.md`; Modificar `docs/ESPECIFICACAO.md` (secção `## Design`, linhas 118–134, e linha 144), `frontend/CLAUDE.md` (linhas 7–8: paleta com "Sobre creme, só com borda bordo-noite" e fontes Bricolage Grotesque + DM Sans), `docs/TAREFAS.md` (secção `## Redesign` antes de `### F3-09`, com R-01, R-02, R-03: Agentes, Depende de, Faz, Feito quando).
**Interfaces:** Produz a tabela Design com os **mesmos dez hex** e "Uso" novo; `dourado-latao` passa a "Ação principal do ecrã, foco no escuro. Sobre creme, só com borda de 1,5 px bordo-noite". Tipografia: Bricolage Grotesque 800/700 com `-0.02em`, DM Sans 400/500/700. Cantos: os da tabela de raios. Linha de produto: "nome, pontilhado, preço" até ao R-02.

- [ ] Teste a falhar: em `frontend/src/styles/fontes.test.ts`, novo `it("cada família de fontes.css está na secção Design da especificação")` — para cada `font-family` dos `@font-face`, `expect(seccaoDesign).toContain(familia)`; e `expect(seccaoDesign).not.toMatch(/Playfair|Source Sans/)`.
- [ ] Correr: `cd frontend && npm test -- --run src/styles/fontes.test.ts` → falha com "Playfair" encontrado.
- [ ] Escrever o ADR (Estado: aceite, pelo Tomás em 2026-11-27; Contexto, Decisão, Consequências, Alternativas: A e C das maquetas), a secção Design e a secção Redesign. Os `docs/ecras/F3-*.md` e `F4-*.md` não se reescrevem: o ADR diz que as menções a Playfair, raios de 4/12 px e "nunca sobre creme" neles ficam substituídas.
- [ ] Correr `npm test -- --run src/styles/cores-so-nos-tokens.test.ts` → passa (lê 10 cores). O teste novo só passa depois da Tarefa 7.
- [ ] Commit:
```
docs(redesign): ADR 0023 e secção Design da especificação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 3: o leitor de tokens sabe `color-mix` e cinco âmbitos (qa)

**Ficheiros:** Modificar `frontend/src/testes/tokens.ts`; Teste `frontend/src/styles/papeis-por-ambito.test.ts` (bloco "autoteste do leitor de tokens").
**Interfaces:** Produz `resolver()` que resolve `color-mix(in srgb, <a> <p>%, <b>)` com `<a>`/`<b>` em `var(--x)`, hex ou `white`, para `#rrggbb` arredondado; `transparent` continua `null` (tem alfa). `AMBITOS = [".superficie-escura", ".superficie-painel", ".superficie-creme", ".superficie-papel", ".superficie-destaque"]`.

- [ ] Teste a falhar, `it("resolve color-mix em srgb, com white e com var()")`:
  - `color-mix(in srgb, #f5e6d3 25%, white)` → `"#fdf9f4"`;
  - `color-mix(in srgb, var(--cor-creme-sombra) 55%, var(--cor-fundo-local))` em `.superficie-creme` de um CSS de prova → hex esperado calculado à mão no teste;
  - `color-mix(in srgb, #3d0f24 88%, transparent)` → `null`.
- [ ] Teste a falhar: em `papeis-por-ambito.test.ts`, um par obrigatório que resolva para `null` falha com "não consegui resolver <papel> em <âmbito>", em vez de ser saltado.
- [ ] Correr `npm test -- --run src/styles/papeis-por-ambito.test.ts` → falham os dois.
- [ ] Implementar `misturarEmSrgb(a: string, b: string, percentagem: number): string` em `tokens.ts` e o ramo `color-mix` no `resolver`.
- [ ] Correr → passa o autoteste; os pares dos âmbitos novos falham por "não consegui resolver" (esperado até à Tarefa 4).
- [ ] Commit:
```
test(tokens): resolver color-mix e cinco âmbitos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 4: papéis de cor novos (qa escreve os testes, frontend implementa)

**Ficheiros:** Modificar `frontend/src/styles/tokens.css`, `frontend/src/styles/global.css` (lista de `.superficie-*` em `@layer components`), `frontend/tailwind.config.ts` (`colors`); Teste `papeis-por-ambito.test.ts`, `foco-no-desativado.test.ts`, `cores-so-nos-tokens.test.ts`.
**Interfaces:** Produz tokens `--cor-papel`, `--cor-decoracao-destaque`, `--cor-acao-dourada`, `--cor-texto-sobre-dourada`, `--cor-contorno-dourada`; âmbitos `.superficie-papel`, `.superficie-destaque` com a tabela de papéis acima; classes Tailwind `bg-papel` (via `papel: var(--cor-papel)`), `bg-dourada`, `text-sobre-dourada`, `border-contorno-dourada`.

- [ ] Testes a falhar em `papeis-por-ambito.test.ts`:
  - `PARES_OBRIGATORIOS` ganha `{frente: "--cor-texto-sobre-dourada", tras: "--cor-acao-dourada", minimo: 4.5}` e `{frente: "--cor-contorno-dourada", tras: "--cor-fundo-local", minimo: 3}`; correm nos cinco âmbitos.
  - `it("no creme e no papel a borda do dourado é bordo-noite")`: `resolver(blocos, ambito, "--cor-contorno-dourada") === resolver(blocos, ":root", "--cor-bordo-noite")` para `.superficie-creme` e `.superficie-papel`.
  - `it("o principal no creme é bordo-noite")`: `--cor-acao` em `.superficie-creme` resolve para `#3d0f24`.
  - "nenhum papel do âmbito creme resolve para o dourado" passa a excluir **só** `--cor-acao-dourada`, e corre também em `.superficie-papel`.
  - "o bordo-tomazia nunca é fundo de superfície" passa a "só `.superficie-destaque` tem o bordo-tomazia por fundo, e aí `--cor-erro` não é `--cor-erro-escuro`" (comentário: R-01 / ADR 0023).
- [ ] Teste a falhar em `foco-no-desativado.test.ts`: `AMBITOS` com os cinco; o anel a `--opacidade-desativado` ≥ 3 em todos; a tabela de chãos escrita no teste atualiza-se.
- [ ] Teste a falhar em `cores-so-nos-tokens.test.ts`: `it("a única cor com nome no tokens.css é white, dentro de --cor-papel")`.
- [ ] Correr `npm test -- --run src/styles` → falham.
- [ ] Implementar os tokens e âmbitos (valores da tabela; `--cor-fio-interno` repetido em `.superficie-papel` e `.superficie-destaque`; em destaque `color-mix(in srgb, var(--cor-creme-sombra) 55%, var(--cor-fundo-local))`).
- [ ] Correr `npm test -- --run src/styles` → passa.
- [ ] Commit:
```
feat(tokens): âmbitos papel e destaque e papéis do dourado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 5: tokens de forma (frontend)

**Ficheiros:** Modificar `tokens.css` (bloco "Forma"), `tailwind.config.ts` (`borderRadius`, `borderWidth`); Teste `frontend/src/styles/escala-de-espacamento.test.ts` ou novo `frontend/src/styles/forma.test.ts`.
**Interfaces:** Produz `rounded-pequeno|campo|botao|cartao|grande|barra|cheio` e `border-medio`. `--raio-pequeno` muda de 4px para 10px e continua a servir os 28 ficheiros que o usam.

- [ ] Teste a falhar `forma.test.ts`: lê `tokens.css` e espera `--raio-pequeno: 10px`, `--raio-campo: 12px`, `--raio-botao: 14px`, `--raio-cartao: 18px`, `--raio-grande: 24px`, `--raio-barra: 22px`, `--contorno-medio: 1.5px`; e que `tailwind.config.ts` tem `borderRadius` com exatamente `nenhum, pequeno, campo, botao, cartao, grande, barra, cheio` e `borderWidth.medio = "var(--contorno-medio)"`.
- [ ] Correr `npm test -- --run src/styles/forma.test.ts` → falha.
- [ ] Implementar; atualizar o comentário de `--raio-cheio` ("chips e Interruptor").
- [ ] Correr `npm test -- --run src/styles` → passa.
- [ ] Commit:
```
feat(tokens): raios e contorno médio do redesign B

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 6: os ficheiros das letras (infra obtém, qa testa)

**Ficheiros:** Criar `frontend/public/fontes/bricolage-grotesque-v<rev>-latin-700-800.woff2`, `frontend/public/fontes/dm-sans-v<rev>-latin-400-700.woff2`, `frontend/src/testes/woff2.ts`; Modificar `frontend/public/fontes/OFL.txt` (os dois textos OFL de `google/fonts`), `PROVENIENCIA.md`; Apagar os três `.woff2` antigos; Teste `frontend/src/styles/fontes.test.ts` (bloco "os ficheiros das fontes").
**Interfaces:** `<rev>` é `head.fontRevision` com o ponto trocado por `_` (ex.: `v1_001`). Produz `lerTabelasWoff2(caminho: string): Map<string, Buffer>`, `temGlifo(tabelas, codepoint: number): boolean`, `recursosGsub(tabelas): string[]`, `eixosFvar(tabelas): {tag, min, max}[]`.

Obtenção (registada no `PROVENIENCIA.md`, comando a comando):
1. Bytes de origem: `https://raw.githubusercontent.com/google/fonts/<commit>/ofl/bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf` e `.../ofl/dmsans/DMSans[opsz,wght].ttf`, mais o `OFL.txt` de cada pasta, com `<commit>` fixo e escrito. Para a pasta de trabalho do scratchpad, nunca para o repositório.
2. Instanciar: `uvx --from 'fonttools[woff]==<versão fixa>' fonttools varLib.instancer <ttf> wdth=100 wght=700:800 -o b.ttf` (Bricolage: fica `opsz` 12–96 e `wght` 700–800) e `... DMSans... wght=400:700 -o d.ttf` (fica `opsz`).
3. Subconjunto: `uvx --from 'fonttools[woff]==<versão>' pyftsubset <ttf> --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk,tnum,lnum,pnum' --flavor=woff2 --output-file=<nome>`.
4. Nada entra em `pyproject.toml`, `package.json` nem `uv.lock` (`uvx` é efémero; regra 8 não se aplica).
5. Se a soma passar 100 000 bytes: repetir o passo 2 com `opsz` fixado (Bricolage `opsz=32`, DM Sans `opsz=14`) e medir de novo; se ainda passar, parar e perguntar ao Tomás.

- [ ] Testes a falhar em `fontes.test.ts` (FACES passa a duas):
  - "são exatamente dois .woff2" com padrões `/^bricolage-grotesque-v\d+_\d+-latin-700-800\.woff2$/` e `/^dm-sans-v\d+_\d+-latin-400-700\.woff2$/`;
  - `it("as duas juntas pesam no máximo 100 000 bytes")`;
  - `it("cada face tem os glifos do português")`: `temGlifo` verdadeiro para cada caractere de `"ãõçáéíóúâêôàüÁÉÍÓÚÃÕÇ€…–—«»ºª"`;
  - `it("o DM Sans traz tnum")`: `recursosGsub` contém `"tnum"`;
  - `it("o eixo wght de cada ficheiro é o do nome")`: Bricolage `{wght, 700, 800}`, DM Sans `{wght, 400, 700}`; Bricolage sem eixo `wdth`;
  - autoteste do leitor: um ficheiro que não é woff2 dá "não consegui ler" (regra 10), não `temGlifo === false`.
- [ ] Correr `npm test -- --run src/styles/fontes.test.ts` → falham (ficheiros ainda são os antigos).
- [ ] Obter os ficheiros pelos passos acima; escrever `PROVENIENCIA.md` (origem com commit, versão do `fonttools`, comandos exatos, tamanho, `sha256`); trocar `OFL.txt`.
- [ ] Correr → passa este bloco (os blocos de `fontes.css` e preload falham até à Tarefa 7).
- [ ] Commit:
```
feat(fontes): Bricolage Grotesque e DM Sans variáveis, latin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 7: letras ligadas ao site (frontend)

**Ficheiros:** Modificar `frontend/src/styles/fontes.css`, `frontend/index.html` (preloads, ≈ linhas 30–48), `tokens.css` (bloco Tipografia), `global.css` (`.font-titulo`, `.font-seccao`, comentário de `font-synthesis`), `tailwind.config.ts` (`fontFamily.seccao`, `fontWeight.medio`, `fontWeight.forte` passa a 700 pelo token); Teste `fontes.test.ts`, `frontend/src/marca/head-do-index.test.ts:277–283`, `frontend/src/build-de-producao.test.ts:112–131`, `frontend/src/styles/base-global.test.ts`.
**Interfaces:** `@font-face` "Bricolage Grotesque" com `font-weight: 700 800`, "DM Sans" com `font-weight: 400 700`, ambos `font-display: swap`, sem `unicode-range`. Classes: `font-titulo` (Bricolage, 800, `-0.02em`), `font-seccao` (Bricolage, 700, `-0.02em`), `font-corpo`, `font-normal|medio|forte`.

- [ ] Testes a falhar:
  - `fontes.test.ts`: dois `@font-face`; `font-weight` do bloco é exatamente `"<min> <max>"` do nome do ficheiro; dois preloads (as duas faces estão acima da dobra), com `crossorigin`; `it("todo o --peso-* aplicado a uma família cabe no intervalo dela")` — `--peso-titulo`/`--peso-seccao` ∈ [700, 800]; `--peso-normal|medio|forte` ∈ [400, 700];
  - `head-do-index.test.ts`: os dois preloads são os dois ficheiros novos;
  - `build-de-producao.test.ts`: "tem de ter as duas faces" (`toBe(2)`);
  - `base-global.test.ts`: `.font-titulo` tem `font-weight: var(--peso-titulo)` e `letter-spacing: var(--espacejamento-titulo)`; `.font-seccao` idem com `--peso-seccao`.
- [ ] Correr `npm test -- --run src/styles src/marca` → falham.
- [ ] Implementar. O teste da Tarefa 2 (família na especificação) passa a passar aqui.
- [ ] Correr `npm test -- --run` → passa (o `build-de-producao` corre o build; se a máquina estiver carregada, adiar para a Tarefa 13).
- [ ] Commit:
```
feat(fontes): Bricolage nos títulos e DM Sans no texto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 8: Botão no aspeto B (qa escreve, frontend implementa)

**Ficheiros:** Modificar `frontend/src/components/ui/Botao.tsx`; Teste `Botao.test.tsx`, `desativado-mantem-a-variante.test.tsx`.
**Interfaces:** `VarianteDeBotao = "principal" | "dourado" | "secundario" | "discreto" | "perigo"`. Classes: `dourado: "bg-dourada text-sobre-dourada border-medio border-contorno-dourada"`; `secundario: "border-medio border-contorno text-texto"`; `principal`, `discreto`, `perigo` como hoje (o principal muda de cor pelo âmbito). Base: `rounded-botao` em vez de `rounded-pequeno`. O `<button>` leva `data-variante={variante}` (para o R-02/R-03 contarem os dourados por ecrã). Docstring: "um só `dourado` por ecrã; sobre creme leva sempre a borda".

- [ ] Testes a falhar:
  - `Botao.test.tsx`: `render(<Botao variante="dourado">Entrar</Botao>)` → `className` contém `bg-dourada`, `text-sobre-dourada`, `border-medio`, `border-contorno-dourada`, `rounded-botao`; `getAttribute("data-variante") === "dourado"`; nenhuma variante contém `rounded-pequeno`.
  - `desativado-mantem-a-variante.test.tsx`: `VARIANTES` ganha `{variante: "dourado", marcas: ["bg-dourada", "text-sobre-dourada", "border-contorno-dourada"]}`; "as cinco variantes continuam distinguíveis".
- [ ] Correr `npm test -- --run src/components/ui/Botao.test.tsx src/components/ui/desativado-mantem-a-variante.test.tsx` → falham.
- [ ] Implementar.
- [ ] Correr → passa.
- [ ] Commit:
```
feat(ui): variante dourada do Botão e raio B

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 9: Campo, Chip e Interruptor (qa escreve, frontend implementa)

**Ficheiros:** Modificar `Campo.tsx`, `Chip.tsx`, `Interruptor.tsx` (só comentários e raio, se a ui-ux o pedir); Teste `Campo.test.tsx:131`, `Chip.test.tsx:66–72`, `Interruptor.test.tsx`.
**Interfaces:** Campo `rounded-campo`; Chip `rounded-cheio text-nota font-medio`, ativo `bg-acao text-sobre-acao`, inativo `border border-contorno text-texto` (mais `bg-papel` se a Tarefa 1 o decidir); o peso é o mesmo nos dois estados.

- [ ] Testes a falhar: Campo contém `rounded-campo`; Chip contém `rounded-cheio` e não `rounded-pequeno`; `it("ativo e inativo têm o mesmo peso")` — o conjunto de classes `font-*` é igual nos dois estados (a barra não salta ao mudar de chip).
- [ ] Correr `npm test -- --run src/components/ui` → falham.
- [ ] Implementar.
- [ ] Correr → passa.
- [ ] Commit:
```
feat(ui): Campo, Chip e Interruptor no aspeto B

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 10: Folha, Aviso, Estado vazio e Linha de produto (qa escreve, frontend implementa)

**Ficheiros:** Modificar `Folha.tsx` (≈ linhas 107–122), `AvisoTemporario.tsx:103`, `EstadoVazio.tsx` (≈ 10–47), `LinhaDeProduto.tsx` (≈ 55–66); Modificar `frontend/src/lib/formato/data-do-evento.ts` (só comentários "Playfair"); Teste os `.test.tsx` respetivos.
**Interfaces:** Folha `rounded-t-grande lg:rounded-grande`, título `font-titulo text-titulo`; Aviso `rounded-cartao`; Estado vazio título `font-seccao text-seccao` (a regra dos 22 px da Playfair sai); Linha de produto mantém nome, pontilhado e preço (`font-forte tabular-nums text-texto-marca`) até ao R-02.

- [ ] Testes a falhar: Folha contém `rounded-t-grande`; Estado vazio: o título contém `font-seccao`; Linha de produto: o preço continua com `tabular-nums` e o pontilhado continua lá (comentário: muda no R-02, ADR 0023).
- [ ] Correr `npm test -- --run src/components/ui` → falham.
- [ ] Implementar; tirar "Playfair"/"Source Sans" dos comentários.
- [ ] Correr → passa.
- [ ] Commit:
```
feat(ui): Folha, Aviso, Estado vazio e Linha de produto na letra B

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 11: Cartão (qa escreve, frontend implementa)

**Ficheiros:** Criar `frontend/src/components/ui/Cartao.tsx`, `Cartao.test.tsx`; Modificar `global.css` (`.cartao-destaque::after`), `tokens.css` (`--decoracao-destaque`, `--decoracao-afastamento`), `frontend/src/testes/componentes.ts` (entra `Cartao.tsx`).
**Interfaces:** `Cartao({ tom = "papel", como = "div", children }: { tom?: "papel" | "destaque"; como?: "div" | "section" | "article" | "li"; children: ReactNode })`. Papel: `superficie-papel rounded-cartao border-b border-contorno-superficie p-4`. Destaque: `superficie-destaque cartao-destaque relative overflow-hidden rounded-grande p-6`; o círculo é `::after` com `--cor-decoracao-destaque`, `pointer-events: none`, sem `style` inline.

- [ ] Testes a falhar: `render(<Cartao>x</Cartao>)` tem `superficie-papel` e `rounded-cartao`; `tom="destaque"` tem `superficie-destaque`, `cartao-destaque`, `rounded-grande`; `como="li"` dá um `<li>`; nenhum atributo `style`.
- [ ] Teste a falhar em `papeis-por-ambito.test.ts`: `--cor-texto` de `.superficie-destaque` contra a decoração sobreposta ao fundo (alfa 0,18) ≥ 4,5.
- [ ] Correr `npm test -- --run src/components/ui/Cartao.test.tsx src/styles` → falham.
- [ ] Implementar.
- [ ] Correr → passa.
- [ ] Commit:
```
feat(ui): Cartão papel e de destaque

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 12: demonstração e testes de browser (qa)

**Ficheiros:** Modificar `frontend/src/demonstracao/PaginaDemonstracao.tsx`, `frontend/e2e/apoio/pagina.ts`, `frontend/e2e/componentes.spec.ts`, `frontend/e2e/eventos.spec.ts:897–951`, `frontend/e2e/ementa-pixeis.spec.ts:44–68`.
**Interfaces:** A demonstração ganha as secções "Superfície papel" e "Superfície destaque" (cada uma com as cinco variantes do Botão, Campo, Chip, Interruptor) e o Botão `dourado` nas cinco superfícies.

- [ ] Testes a falhar em `componentes.spec.ts`:
  - "o dourado nunca sobre o creme" passa a "dentro de `.superficie-creme` e `.superficie-papel`, todo o elemento com fundo dourado é `[data-variante=dourado]` e tem `borderTopColor` = bordo-noite e `borderTopWidth` = `1.5px`";
  - o anel e o anel desativado medidos nas cinco superfícies;
  - contagem de secções atualizada (onze → treze), axe sem violações sérias.
- [ ] `eventos.spec.ts`: a data é Bricolage e o nome não (`/bricolage/i`); `ementa-pixeis.spec.ts`: a família do preço contém `"DM Sans"`. Comentário R-01 / ADR 0023 em cada um.
- [ ] Correr `cd frontend && npx playwright test e2e/componentes.spec.ts e2e/eventos.spec.ts e2e/ementa-pixeis.spec.ts` → falham antes da demonstração mudar; implementar; correr → passam.
- [ ] Commit:
```
test(ui): componentes B nas cinco superfícies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 13: `/verificar` completo (qa)

**Ficheiros:** nenhum novo; corrige o que falhar na tarefa dona.

- [ ] Correr `/verificar` (lint, typecheck, `npm test -- --run`, `VITE_URL_PUBLICA=https://novo.bardatomazia.pt npm run build`, `npm run size`, `npx playwright test`, e o backend inteiro).
- [ ] Confirmar à mão: `npm run size` ≤ 100 kB e `orcamento-q02` ≤ 86 000 bytes; `ls -l frontend/dist/fontes` com dois ficheiros, soma ≤ 100 000; `grep -rn "Playfair\|Source Sans" frontend/src frontend/index.html frontend/e2e` vazio (estado de saída 1 verificado à mão, não num `if` — regra 10).
- [ ] Commit, só se houve correções:
```
fix(redesign): correções do /verificar do R-01

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Tarefa 14: capturas (frontend gera, ui-ux revê)

**Ficheiros:** Criar `docs/ecras/capturas/redesign/{direcoes,b-completo,b-gestao}.png`, `docs/ecras/capturas/redesign/LEIA-ME.md`, `docs/ecras/capturas/R-01/390-*.png`.
**Interfaces:** Maquetas: um script de uma só vez, no scratchpad e fora do repositório, com Playwright, abre cada HTML por `file://`, responde a `**/files/logo.webp` com o `logo.webp` da mesma pasta (`page.route`), deixa o Google Fonts carregar (é uma maqueta, não o site; a CSP não se aplica) e espera `document.fonts.ready`; captura página inteira a 1280 de largura. O `LEIA-ME.md` diz a origem, a data e que as letras vieram do Google Fonts. Componentes: as capturas existentes de `e2e/capturas.spec.ts` passam a escrever também a secção papel e a secção destaque, a 390×844, e copiam-se para `docs/ecras/capturas/R-01/` (pelo menos `390-botao.png`, `390-foco-botao.png`, `390-folha-aberta.png`, `390-sobre-creme.png`, `390-sobre-papel.png`, `390-sobre-destaque.png`).

- [ ] Gerar as capturas das maquetas e confirmar que as três PNG têm mais de 0 bytes e foram escritas nesta corrida.
- [ ] `cd frontend && npx playwright test e2e/capturas.spec.ts` → passa e escreve as capturas novas.
- [ ] A ui-ux revê contra `docs/ecras/R-01.md` e dá APROVADO ou a lista de correções.
- [ ] Commit:
```
docs(ecras): capturas das maquetas B e dos componentes do R-01

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**Ordem:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14. A 5 e a 6 não dependem uma da outra e podem trocar. Não há contrato de backend.

**Não tocar:** o fundo de nenhuma página (`superficie-escura` do público e da gestão fica), layout de ecrãs, `src/pages/**` (exceto se um teste de página fixar `rounded-pequeno` com um valor que deixou de ser verdade), backend, `deploy/`, `.github/`, `CLAUDE.md`, `frontend/CLAUDE.md` (fora das linhas 7–8, Tarefa 2), `docs/ecras/F*.md`.
