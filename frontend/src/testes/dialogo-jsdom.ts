/**
 * Adaptador mínimo do `<dialog>` para o jsdom — só para os testes.
 *
 * **Ponto de extensão, não código de produção.** O jsdom 30 implementa o
 * elemento `<dialog>` (o construtor existe, o atributo `open` reflete,
 * o papel ARIA é `dialog`) mas **não implementa `show()`, `showModal()`
 * nem `close()`**: chamar `showModal()` num teste rebenta com
 * "d.showModal is not a function". Sem isto, a Folha — que o ADR 0008
 * manda construir sobre o `<dialog>` nativo — não poderia ter nenhum teste
 * de componente.
 *
 * O que este adaptador faz, e **só** isto:
 *  - `show()` e `showModal()` põem o atributo `open`;
 *  - `showModal()` marca o diálogo como modal, para um teste poder
 *    distinguir as duas chamadas;
 *  - `close(valor)` tira o `open`, guarda o `returnValue` e dispara o
 *    evento `close`, como manda o HTML.
 *
 * O que este adaptador **não** faz, de propósito: não prende o foco, não
 * move o foco para dentro ao abrir, não devolve o foco ao abrir-dor ao
 * fechar, não desenha `::backdrop` e não fecha com `Esc`. Essas quatro
 * coisas são o que o browser traz de origem e são a razão inteira do ADR
 * 0008 — se fossem simuladas aqui, um teste em jsdom passaria a provar
 * que o adaptador funciona, não que a Folha funciona. Quem as verifica é
 * o `e2e/componentes.spec.ts`, num Chromium a sério.
 *
 * O `Esc` do browser dispara `cancel` no diálogo (e só depois `close`);
 * os testes de componente simulam essa parte disparando `cancel` à mão, o
 * que exercita o nosso `onCancel` sem fingir o comportamento do browser.
 */

const MODAIS = new WeakSet<HTMLDialogElement>();

/** Diz se `showModal()` (e não `show()`) foi a chamada que abriu este diálogo. */
export function estaModal(dialogo: HTMLDialogElement): boolean {
  return MODAIS.has(dialogo);
}

export function instalarAdaptadorDeDialogo(): void {
  const prototipo = globalThis.HTMLDialogElement?.prototype;
  if (prototipo === undefined) return;
  if (typeof prototipo.showModal === "function") return; // Num browser a sério, não toca em nada.

  prototipo.show = function mostrar(this: HTMLDialogElement): void {
    MODAIS.delete(this);
    this.setAttribute("open", "");
  };

  prototipo.showModal = function mostrarModal(this: HTMLDialogElement): void {
    MODAIS.add(this);
    this.setAttribute("open", "");
  };

  prototipo.close = function fechar(this: HTMLDialogElement, valor?: string): void {
    if (!this.hasAttribute("open")) return;
    MODAIS.delete(this);
    this.removeAttribute("open");
    if (valor !== undefined) this.returnValue = valor;
    this.dispatchEvent(new Event("close"));
  };
}
