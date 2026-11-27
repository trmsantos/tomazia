# Frontend

- Estrutura: `src/pages/publico`, `src/pages/gestao` (carregada com lazy loading), `src/components/ui`, `src/lib/api`, `src/styles`.
- Dentro de `src/lib/api`: **`gerado/` é gerado e não se edita** (sai do OpenAPI do backend por `npm run gerar-api`); o resto é o cliente, escrito à mão e testado como qualquer outro código. A regra antiga dizia que a pasta inteira era gerada, e deixou de poder ser a partir do momento em que o cliente passou a viver lá.
- `fetch` só dentro de `src/lib/api`. Fora de lá é erro de lint — e há uma varredura do código em disco por cima, porque um `eslint-disable` desliga a regra e não desliga a varredura.
- Cores, tipografia e espaçamentos só em `src/styles/tokens.css` e `tailwind.config.ts`. Nunca hex soltos em componentes.
- Paleta: bordô noite `#3D0F24` (fundo), bordô vinho `#4A1830` (superfícies), bordô Tomazia `#5D1F3A` (marca, preços no creme), dourado latão `#D4AF37` (ação principal do ecrã, foco no escuro), creme papel `#F5E6D3` (fundo das páginas, texto no escuro), creme sombra `#D9C3AE` (texto secundário). Sobre creme, só com borda de 1,5 px bordo-noite.
- Fontes servidas pelo próprio site: Bricolage Grotesque (800 em títulos de página, 700 em títulos de secção, com `-0.02em`) e DM Sans (400, 500 e 700) para o resto. Preços com `font-variant-numeric: tabular-nums`.
- Primitivas do browser para folhas, diálogos e interruptores: `<dialog>` com `showModal()` e `<input type="checkbox" role="switch">`. Nada de Radix — os estilos inline que ele aplica são bloqueados pela CSP `style-src 'self'`, e isso só se vê em produção (ADR 0008).
- Todos os pedidos passam pelo cliente de `src/lib/api`, que envia `X-Tomazia: 1` e `credentials: "include"`.
- Nada de `localStorage` para sessão. Nada de `dangerouslySetInnerHTML` (regra do ESLint).
- Mobile-first, alvos de toque com pelo menos 44 px, foco visível, `prefers-reduced-motion` respeitado.
- JavaScript da área pública abaixo de 100 KB comprimido (`npm run size`).
- Testes: Vitest + Testing Library em `src/**/*.test.tsx`; Playwright + axe em `e2e/`, com viewport 390×844.
