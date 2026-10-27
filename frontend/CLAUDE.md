# Frontend

- Estrutura: `src/pages/publico`, `src/pages/gestao` (carregada com lazy loading), `src/components/ui`, `src/lib/api` (gerado, não editar), `src/styles`.
- Cores, tipografia e espaçamentos só em `src/styles/tokens.css` e `tailwind.config.ts`. Nunca hex soltos em componentes.
- Paleta: bordô noite `#3D0F24` (fundo), bordô vinho `#4A1830` (superfícies), bordô Tomazia `#5D1F3A` (marca, preços no creme), dourado latão `#D4AF37` (ação principal, chip ativo, foco), creme papel `#F5E6D3` (texto no escuro, cartões da ementa), creme sombra `#D9C3AE` (texto secundário). Dourado nunca sobre creme.
- Fontes servidas pelo próprio site: Playfair Display 700 para títulos (nunca abaixo de 22 px) e Source Sans 3 para o resto. Preços com `font-variant-numeric: tabular-nums`.
- Primitivas do browser para folhas, diálogos e interruptores: `<dialog>` com `showModal()` e `<input type="checkbox" role="switch">`. Nada de Radix — os estilos inline que ele aplica são bloqueados pela CSP `style-src 'self'`, e isso só se vê em produção (ADR 0008).
- Todos os pedidos passam pelo cliente de `src/lib/api`, que envia `X-Tomazia: 1` e `credentials: "include"`.
- Nada de `localStorage` para sessão. Nada de `dangerouslySetInnerHTML` (regra do ESLint).
- Mobile-first, alvos de toque com pelo menos 44 px, foco visível, `prefers-reduced-motion` respeitado.
- JavaScript da área pública abaixo de 100 KB comprimido (`npm run size`).
- Testes: Vitest + Testing Library em `src/**/*.test.tsx`; Playwright + axe em `e2e/`, com viewport 390×844.
