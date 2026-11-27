# Proveniência das fontes

As duas faces abaixo são ficheiros do repositório, não uma dependência. A razão
está em `docs/ecras/F3-01.md`, secção 4: a CSP de produção é `font-src 'self'`
com `default-src 'none'`, por isso nada pode vir de um CDN; e bytes fixos não
mudam as métricas da fonte (e com elas o alinhamento das ementas) numa
atualização que ninguém reparou que aconteceu.

As famílias são as do redesign B (ADR 0023, `docs/ecras/R-01.md`, secção 3):
Bricolage Grotesque nos títulos (700 e 800) e DM Sans no resto (400, 500 e
700). Substituem a Playfair Display e a Source Sans 3.

Cada ficheiro foi produzido pelos comandos abaixo, a partir das fontes
variáveis de `google/fonts` num commit fixo, e o `sha256` é o do ficheiro em
disco. `src/styles/fontes.test.ts` volta a calcular o resumo e falha se
divergir — é isso que faz desta página uma verificação e não uma promessa. O
mesmo teste lê os bytes (`src/testes/woff2.ts`) e confirma os glifos do
português, o `tnum` da Bricolage e o intervalo de `wght` de cada ficheiro.

## Porque é que são variáveis e recortadas à mão

O desenho usa cinco pesos (400, 500 e 700 do DM Sans; 700 e 800 da
Bricolage). Cinco ficheiros estáticos eram cinco pedidos; dois ficheiros
variáveis cobrem os cinco. Mas a fonte variável inteira traz eixos e
intervalos que o site nunca pede, e era isso que pesava. Por isso:

1. **Instância parcial.** Na Bricolage o `wdth` fica fixo em 100 (sai o eixo)
   e o `wght` fica só entre 700 e 800; no DM Sans o `wght` fica entre 400 e 700. O eixo `opsz` fica nas duas: é o que deixa o título a 34 px com o
   desenho de título e a nota a 14 px com o desenho de texto pequeno
   (`font-optical-sizing: auto`, o valor por omissão do browser).
2. **Subconjunto latin.** `U+0000-00FF` mais a pontuação geral, `U+20AC` (€),
   `U+2122` e companhia — os mesmos intervalos do subconjunto latin do Google
   Fonts. Cobre o português de Portugal inteiro (`ã õ ç á é í ó ú â ê ô à ü
« » º ª` vivem todos abaixo de `U+00FF`), mais o euro, as reticências `…`
   e os travessões `–` e `—`. `latin-ext` não é preciso e duplicaria o peso.
3. **Recursos tipográficos.** Ficam só `kern`, `liga`, `calt`, `ccmp`,
   `locl`, `mark`, `mkmk`, `tnum`, `lnum` e `pnum` (os que a fonte tiver).
   O `tnum` da Bricolage é obrigatório: os preços são em Bricolage Grotesque
   700 com algarismos tabulares (o DM Sans não tem tnum). O DM Sans de
   `google/fonts` (4.004) não traz `tnum`, `lnum` nem `pnum` na origem, e
   os algarismos dele são proporcionais (o «1» tem 342 unidades e o «0»
   656), por isso não serve para colunas de preços (R-01 6.8, `.font-preco`).

O teto das duas juntas é 100 000 bytes (especificação, secção Design). Estas
somam **93 472**, por isso não foi preciso fixar o `opsz` (o plano B, se
passassem: Bricolage `opsz=32`, DM Sans `opsz=14`).

Formato **woff2 apenas**: todos os browsers que este site suporta o leem desde
2020, e um segundo formato só dobrava os bytes no repositório.

O `v<N>_<M>` do nome é o `head.fontRevision` do ficheiro (1.001 e 4.004), com o
ponto trocado por `_`. Os ficheiros de `public/` não levam hash do Vite, e é o
nome versionado que permite `Cache-Control: immutable`.

## Origem

- Repositório: https://github.com/google/fonts, commit
  `5026800714d07231937d92eb4cceabf06e05d74e` (o `main` a 2026-11-27).
- Bricolage Grotesque:
  https://raw.githubusercontent.com/google/fonts/5026800714d07231937d92eb4cceabf06e05d74e/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz,wdth,wght%5D.ttf
  (408 496 bytes, sha256
  `413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682`)
- DM Sans:
  https://raw.githubusercontent.com/google/fonts/5026800714d07231937d92eb4cceabf06e05d74e/ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf
  (240 164 bytes, sha256
  `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d`)
- Licenças: `ofl/bricolagegrotesque/OFL.txt` e `ofl/dmsans/OFL.txt` no mesmo
  commit, copiadas para `OFL.txt` nesta pasta.
- Ferramenta: `fonttools[woff]==4.69.1`, corrido com `uvx` (efémero: nada
  entra em `pyproject.toml`, `package.json` nem `uv.lock`).

## Comandos

Corridos numa pasta de trabalho fora do repositório (`$T`), com os ficheiros
descarregados em `$T/origem` e o resultado em `$T/trabalho`. Os ficheiros
descarregados passam sempre por argumento; nenhum comando corre de dentro
da pasta onde eles estão.

```bash
C=5026800714d07231937d92eb4cceabf06e05d74e
B=https://raw.githubusercontent.com/google/fonts/$C/ofl
mkdir -p "$T/origem" "$T/trabalho"
curl -fsSL -o "$T/origem/BricolageGrotesque[opsz,wdth,wght].ttf" \
  "$B/bricolagegrotesque/BricolageGrotesque%5Bopsz,wdth,wght%5D.ttf"
curl -fsSL -o "$T/origem/DMSans[opsz,wght].ttf" "$B/dmsans/DMSans%5Bopsz,wght%5D.ttf"
curl -fsSL -o "$T/origem/OFL-bricolage.txt" "$B/bricolagegrotesque/OFL.txt"
curl -fsSL -o "$T/origem/OFL-dmsans.txt" "$B/dmsans/OFL.txt"

FT='fonttools[woff]==4.69.1'
# Data fixa no head.modified: sem ela, cada corrida dá bytes diferentes.
export SOURCE_DATE_EPOCH=1795737600   # 2026-11-27T00:00:00Z
uvx --from "$FT" fonttools varLib.instancer \
  "$T/origem/BricolageGrotesque[opsz,wdth,wght].ttf" wdth=100 wght=700:800 -o "$T/trabalho/b.ttf"
uvx --from "$FT" fonttools varLib.instancer \
  "$T/origem/DMSans[opsz,wght].ttf" wght=400:700 -o "$T/trabalho/d.ttf"

U='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
L='kern,liga,calt,ccmp,locl,mark,mkmk,tnum,lnum,pnum'
uvx --from "$FT" pyftsubset "$T/trabalho/b.ttf" --unicodes="$U" --layout-features="$L" \
  --flavor=woff2 --output-file="$T/trabalho/b.woff2"
uvx --from "$FT" pyftsubset "$T/trabalho/d.ttf" --unicodes="$U" --layout-features="$L" \
  --flavor=woff2 --output-file="$T/trabalho/d.woff2"

cp "$T/trabalho/b.woff2" frontend/public/fontes/bricolage-grotesque-v1_001-latin-700-800.woff2
cp "$T/trabalho/d.woff2" frontend/public/fontes/dm-sans-v4_004-latin-400-700.woff2
```

## Bricolage Grotesque 700–800

- Ficheiro: `bricolage-grotesque-v1_001-latin-700-800.woff2`
- Família: Bricolage Grotesque, variável, estilo normal
- Eixos: `opsz` 12–96, `wght` 700–800 (`wdth` fixado em 100)
- Versão na origem: 1.001 (`head.fontRevision`)
- Projeto: https://github.com/ateliertriay/bricolage
- Licença: SIL Open Font License 1.1 (ver `OFL.txt`)
- Subconjunto: latin
- Tamanho: 58 004 bytes
- sha256: `56368d03f47a81ccd502ab3b4cbf0af7e463482c2cece0248232bbf205d85153`

## DM Sans 400–700

- Ficheiro: `dm-sans-v4_004-latin-400-700.woff2`
- Família: DM Sans, variável, estilo normal
- Eixos: `opsz` 9–40, `wght` 400–700
- Versão na origem: 4.004 (`head.fontRevision`)
- Projeto: https://github.com/googlefonts/dm-fonts
- Licença: SIL Open Font License 1.1 (ver `OFL.txt`)
- Subconjunto: latin
- Tamanho: 35 468 bytes
- sha256: `759f88077f0cf96e8f31e5eb2084af9a4099395ee3f654be9068b951f061762f`

## Como confirmar à mão

```bash
shasum -a 256 frontend/public/fontes/*.woff2
wc -c frontend/public/fontes/*.woff2   # as duas juntas: 93 472 bytes
```

Os comandos acima, corridos de novo com o mesmo commit, a mesma versão do
`fonttools` e o mesmo `SOURCE_DATE_EPOCH`, dão os mesmos bytes: foram corridos
duas vezes em pastas diferentes e os dois `sha256` coincidiram. Sem o
`SOURCE_DATE_EPOCH` o `fonttools` grava a hora da corrida em `head.modified`,
e o Brotli comprime-a de outra maneira: muda o resumo e até o tamanho, em
dezenas de bytes.
