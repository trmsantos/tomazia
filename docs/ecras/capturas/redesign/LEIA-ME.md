# Capturas das maquetas do redesign B

Três capturas de página inteira, a 1280 px de largura, das maquetas HTML aprovadas pelo Tomás durante a sessão de desenho do R-01:

- `direcoes.png`: as três direções (A, B e C) para a página pública.
- `b-completo.png`: a direção B, página pública e gestão (Início e Ementa).
- `b-gestao.png`: a direção B nos ecrãs da gestão (Entrar, Galeria, Eventos e Mais).

## Origem

- Maquetas: fragmentos HTML da sessão de desenho (`direcoes.html`, `b-completo.html`, `b-gestao.html`), com o `logo.webp` da mesma pasta. Os fragmentos não entram no repositório.
- Data das capturas: 2026-11-27.
- Geradas com Playwright (Chromium), por um script de uma só vez fora do repositório. O pedido do logótipo foi respondido com o `logo.webp` local e esperou-se por `document.fonts.ready`.
- As letras vieram do Google Fonts, carregado pela própria maqueta. É uma maqueta e não o site: o site serve as suas letras e tem uma CSP que não o permitiria.
- Os fragmentos não têm `<html>`, por isso aparecem sem o invólucro que o servidor de maquetas lhes dava (títulos e texto de apoio em letra por omissão). As telas dos telemóveis estão como foram aprovadas.
- Os produtos, preços e eventos são exemplos, não a ementa real.

São referência visual para a revisão da ui-ux. Não são comparadas pixel a pixel por nenhum teste.
