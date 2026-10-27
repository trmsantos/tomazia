# Proveniência das fontes

As três faces abaixo são ficheiros do repositório, não uma dependência. A razão
está em `docs/ecras/F3-01.md`, secção 4: a CSP de produção é `font-src 'self'`
com `default-src 'none'`, por isso nada pode vir de um CDN; e bytes fixos não
mudam as métricas da fonte (e com elas o alinhamento das ementas) numa
atualização que ninguém reparou que aconteceu.

Cada ficheiro foi descarregado da origem indicada e o `sha256` abaixo é o do
ficheiro em disco. `src/styles/fontes.test.ts` volta a calcular o resumo e
falha se divergir — é isso que faz desta página uma verificação e não uma
promessa.

Subconjunto **latin** em todas: `U+0000-00FF` mais pontuação geral, `U+20AC`
(€), `U+2122` e companhia. Cobre o português de Portugal inteiro (`ã õ ç á é í
ó ú â ê ô à ü « »` vivem todos abaixo de `U+00FF`), mais o euro, as reticências
`…` e o travessão `–`. `latin-ext` não é preciso e duplicaria o peso.

Formato **woff2 apenas**: todos os browsers que este site suporta o leem desde
2020, e um segundo formato só dobrava os bytes no repositório.

## Playfair Display 700

- Ficheiro: `playfair-display-v40-latin-700.woff2`
- Família: Playfair Display, peso 700, estilo normal
- Versão na origem: v40 (é o `v40` do nome; os ficheiros de `public/` não levam
  hash do Vite, e é o nome versionado que permite `Cache-Control: immutable`)
- Origem: https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiunDXbtM.woff2
- Projeto: https://github.com/google/fonts/tree/main/ofl/playfairdisplay
- Licença: SIL Open Font License 1.1 (ver `OFL.txt`)
- Subconjunto: latin
- Tamanho: 23 224 bytes
- sha256: `28453852ea165c47b5a941be00e418402e1407002ed87507f062a1e316328fe6`

## Source Sans 3 400

- Ficheiro: `source-sans-3-v20-latin-400.woff2`
- Família: Source Sans 3, peso 400, estilo normal
- Versão na origem: v20
- Origem: https://fonts.gstatic.com/s/sourcesans3/v20/nwpBtKy2OAdR1K-IwhWudF-R9QMylBJAV3Bo8Ky462EK9Cs.woff2
- Projeto: https://github.com/google/fonts/tree/main/ofl/sourcesans3
- Licença: SIL Open Font License 1.1 (ver `OFL.txt`)
- Subconjunto: latin
- Tamanho: 15 696 bytes
- sha256: `0f73f35e08cde0a2f10c109c6e01d71459d97e4099ecd9a50f1b6c0209e4de2b`

## Source Sans 3 600

- Ficheiro: `source-sans-3-v20-latin-600.woff2`
- Família: Source Sans 3, peso 600, estilo normal
- Versão na origem: v20
- Origem: https://fonts.gstatic.com/s/sourcesans3/v20/nwpBtKy2OAdR1K-IwhWudF-R9QMylBJAV3Bo8Kxm7GEK9Cs.woff2
- Projeto: https://github.com/google/fonts/tree/main/ofl/sourcesans3
- Licença: SIL Open Font License 1.1 (ver `OFL.txt`)
- Subconjunto: latin
- Tamanho: 15 668 bytes
- sha256: `14527d193b0e30bc32ef931549a246cdfd286573bb12869b7e052b8101a39d38`

## Como confirmar à mão

```bash
shasum -a 256 frontend/public/fontes/*.woff2
```

Os três ficheiros são estáticos, um por peso — não são a fonte variável. Foi de
propósito: pedir um peso a uma fonte variável funciona, mas traz os eixos todos
no mesmo ficheiro, e aqui só se usam três pontos fixos da escala.
