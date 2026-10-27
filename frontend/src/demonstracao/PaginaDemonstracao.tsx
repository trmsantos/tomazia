import type { ReactElement, ReactNode } from "react";
import { useState } from "react";

import { AvisoTemporario } from "../components/ui/AvisoTemporario";
import type { VarianteDeBotao } from "../components/ui/Botao";
import { Botao } from "../components/ui/Botao";
import type { PropriedadesDoCampo } from "../components/ui/Campo";
import { Campo } from "../components/ui/Campo";
import { Chip } from "../components/ui/Chip";
import { EstadoVazio } from "../components/ui/EstadoVazio";
import { Folha } from "../components/ui/Folha";
import { Interruptor } from "../components/ui/Interruptor";
import { juntar } from "../components/ui/juntar";

/**
 * A página que o Tomás abre com `npm run dev`, em
 * `http://localhost:5173/demonstracao.html`.
 *
 * Mostra os sete componentes com todos os estados, cada um com a etiqueta do
 * estado por baixo. A secção mais importante é a penúltima: a repetição dos
 * mesmos componentes dentro de um `.superficie-creme`, onde se vê de relance
 * se algum dourado escapou para cima do creme (onde daria 1,72 e o limite do
 * botão desaparecia).
 *
 * Não chega a produção, e por duas vias e não uma: o Vite só constrói o
 * `index.html` (o que tira daqui o HTML e o JavaScript) e o `content` do
 * `tailwind.config.ts` deixa esta pasta de fora quando se constrói (o que
 * tira o CSS, incluindo as classes da secção "Cores", que são as únicas do
 * projeto a escrever nomes da paleta). Ver `demonstracao.html` e
 * `src/build-de-producao.test.ts`.
 */

/** As onze secções da secção 8 de `docs/ecras/F3-01.md`, pela mesma ordem. */
function Seccao({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      // Fio de 1 px por cima do título, com `--espaco-6` até ele. Num
      // documento de onze secções separadas só por espaço, os títulos perdem
      // para o próprio conteúdo: "Tipografia" a 21 px fica logo por cima de
      // "Destaque, 34 px" e ninguém vê onde uma secção acaba. O fio é também
      // a forma que a secção 6 nomeia como *a* maneira de separar no escuro.
      className="flex flex-col gap-4 border-t border-contorno-superficie pt-6"
    >
      <h2 id={`${id}-titulo`} className="text-seccao font-forte">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Um estado, com o nome por baixo — em caixa normal, nunca em maiúsculas. */
function Estado({ etiqueta, children }: { etiqueta: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <p className="text-nota text-texto-suave">{etiqueta}</p>
    </div>
  );
}

/** Um campo com estado próprio, para a demonstração se poder escrever. */
function CampoDemonstracao(propriedades: PropriedadesDoCampo): ReactElement {
  const [valor, setValor] = useState(propriedades.valor ?? "");

  return <Campo {...propriedades} valor={valor} aoMudar={setValor} />;
}

/** Um interruptor com estado próprio, pela mesma razão. */
function InterruptorDemonstracao({
  etiqueta,
  inicial,
  desativado,
}: {
  etiqueta: string;
  inicial: boolean;
  desativado?: boolean;
}): ReactElement {
  const [ligado, setLigado] = useState(inicial);

  return (
    <Interruptor
      etiqueta={etiqueta}
      ligado={ligado}
      aoMudar={setLigado}
      desativado={desativado ?? false}
    />
  );
}

/**
 * Espaço inquebrável (U+00A0). Escrito como escape e não como o caractere
 * para se ver que ali está: um preço com espaço normal parte-se em duas
 * linhas no fim de uma linha de ementa, e o euro fica sozinho na seguinte.
 */
const ESPACO_INQUEBRAVEL = "\u00a0";

const TAMANHOS = [
  { classe: "text-destaque font-titulo", nome: "Destaque, 34 px, Playfair" },
  { classe: "text-titulo font-titulo", nome: "Título, 27 px, Playfair" },
  { classe: "text-seccao font-forte", nome: "Secção, 21 px, Source Sans 3" },
  { classe: "text-corpo", nome: "Corpo, 17 px, Source Sans 3" },
  { classe: "text-nota", nome: "Nota, 14 px, Source Sans 3" },
];

/*
 * Os dez tokens da paleta. Os seis primeiros têm nome próprio no
 * `tailwind.config.ts`; os quatro de estado só existem como papéis
 * (`--cor-sucesso`, `--cor-erro`), e é por isso que as duas últimas amostras
 * pedem o papel dentro de um âmbito creme — é a mesma variável a dar outra
 * cor, que é precisamente o que esta tabela mostra.
 */
const PALETA = [
  { nome: "bordo-noite", classe: "bg-bordo-noite" },
  { nome: "bordo-vinho", classe: "bg-bordo-vinho" },
  { nome: "bordo-tomazia", classe: "bg-bordo-tomazia" },
  { nome: "dourado-latao", classe: "bg-dourado-latao" },
  { nome: "creme-papel", classe: "bg-creme-papel" },
  { nome: "creme-sombra", classe: "bg-creme-sombra" },
  { nome: "sucesso-escuro", classe: "bg-sucesso" },
  { nome: "erro-escuro", classe: "bg-erro" },
  { nome: "sucesso-creme", classe: "superficie-creme bg-sucesso" },
  { nome: "erro-creme", classe: "superficie-creme bg-erro" },
];

const AMBITOS = [
  { classe: "superficie-escura", nome: "Superfície escura" },
  { classe: "superficie-painel", nome: "Superfície painel" },
  { classe: "superficie-creme", nome: "Superfície creme" },
];

const VARIANTES: {
  variante: VarianteDeBotao;
  nome: string;
  texto: string;
  aTrabalhar: string;
}[] = [
  {
    variante: "principal",
    nome: "Principal",
    texto: "Guardar alterações",
    aTrabalhar: "A guardar…",
  },
  { variante: "secundario", nome: "Secundário", texto: "Cancelar", aTrabalhar: "A cancelar…" },
  { variante: "discreto", nome: "Discreto", texto: "Voltar", aTrabalhar: "A voltar…" },
  {
    variante: "perigo",
    nome: "Perigo",
    texto: "Eliminar produto",
    aTrabalhar: "A eliminar…",
  },
];

const CATEGORIAS = [
  { nome: "Cafés", ancora: "#cafes" },
  { nome: "Cervejas", ancora: "#cervejas" },
  { nome: "Vinhos", ancora: "#vinhos" },
  { nome: "Petiscos", ancora: "#petiscos" },
  { nome: "Sandes", ancora: "#sandes" },
  { nome: "Sobremesas", ancora: "#sobremesas" },
  { nome: "Sumos", ancora: "#sumos" },
  { nome: "Refrigerantes", ancora: "#refrigerantes" },
  { nome: "Gin", ancora: "#gin" },
  { nome: "Whisky", ancora: "#whisky" },
  { nome: "Aguardentes", ancora: "#aguardentes" },
];

/** A barra de chips, que se repete no escuro e sobre o creme. */
function BarraDeChips({ nome }: { nome: string }): ReactElement {
  return (
    <nav aria-label={nome}>
      <ul className="sem-barra-de-deslocamento flex snap-x snap-proximity gap-2 overflow-x-auto scroll-pl-4 py-1">
        {CATEGORIAS.map((categoria, indice) => (
          <li key={categoria.ancora} className="snap-start">
            <Chip href={categoria.ancora} ativo={indice === 0}>
              {categoria.nome}
            </Chip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Os dezasseis botões: quatro variantes vezes quatro estados. */
function GrelhaDeBotoes(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {VARIANTES.map((entrada) => (
        <div key={entrada.variante} className="flex flex-col gap-2">
          <p className="text-nota font-forte">{entrada.nome}</p>
          <div className="grid grid-cols-2 gap-4">
            <Estado etiqueta="Normal">
              <Botao variante={entrada.variante}>{entrada.texto}</Botao>
            </Estado>
            <Estado etiqueta="Premido (desce 1 px enquanto se carrega)">
              <Botao variante={entrada.variante}>{entrada.texto}</Botao>
            </Estado>
            <Estado etiqueta="Desativado">
              <Botao variante={entrada.variante} desativado>
                {entrada.texto}
              </Botao>
            </Estado>
            <Estado etiqueta="A trabalhar">
              <Botao variante={entrada.variante} aTrabalhar textoATrabalhar={entrada.aTrabalhar}>
                {entrada.texto}
              </Botao>
            </Estado>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Os seis campos. */
function GrelhaDeCampos(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <Estado etiqueta="Normal">
        <CampoDemonstracao etiqueta="Nome do produto" />
      </Estado>
      <Estado etiqueta="Com ajuda e exemplo">
        <CampoDemonstracao
          etiqueta="Preço (obrigatório)"
          ajuda="Em euros, com vírgula."
          exemplo="6,50"
          obrigatorio
        />
      </Estado>
      <Estado etiqueta="Com erro">
        <CampoDemonstracao
          etiqueta="Preço"
          valor="seis euros"
          erro="O preço tem de ser um número, por exemplo 6,50."
        />
      </Estado>
      <Estado etiqueta="Desativado">
        <Campo etiqueta="Categoria" valor="Cafés" desativado />
      </Estado>
      <Estado etiqueta="Só de leitura">
        <Campo etiqueta="Ligação da ementa" valor="bardatomazia.pt/ementa" soLeitura />
      </Estado>
      <Estado etiqueta="Área de texto">
        <CampoDemonstracao etiqueta="Descrição" multilinha />
      </Estado>
    </div>
  );
}

/** Os três interruptores, numa linha de lista como na ementa da gestão. */
function ListaDeInterruptores(): ReactElement {
  return (
    // Aresta E divisórias em `fio-interno`, e a aresta é o caso que escapou
    // à primeira: `contorno-superficie` é a cor da aresta de um cartão que
    // assenta no FUNDO da página (8,44 contra o bordô). Esta lista aparece
    // nos dois âmbitos, e dentro do cartão creme essa mesma cor dá 1,39 —
    // invisível. O `fio-interno` é derivado contra o fundo local, por isso
    // serve nos dois: 3,78 no bordô noite, 3,49 no creme.
    //
    // A secção 2 da especificação já lhe tinha dado nome: `--cor-fio-interno`
    // é para "uma divisória dentro do cartão: linhas de lista, aresta de um
    // cartão que já está em cima de outro". É exatamente esta `<ul>`.
    <ul className="divide-y divide-fio-interno rounded-cartao border border-fio-interno px-4">
      <li>
        <InterruptorDemonstracao etiqueta="Bitoque" inicial />
      </li>
      <li>
        <InterruptorDemonstracao etiqueta="Francesinha" inicial={false} />
      </li>
      <li>
        <InterruptorDemonstracao etiqueta="Tosta mista" inicial desativado />
      </li>
    </ul>
  );
}

/** Vazio, a carregar e erro — as três formas que uma lista sem conteúdo toma. */
function EstadosDeLista(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <Estado etiqueta="Vazio">
        <EstadoVazio titulo="Ainda não há fotos." linha="Sê o primeiro a mostrar uma noite no bar.">
          <Botao variante="principal">Enviar uma foto</Botao>
        </EstadoVazio>
      </Estado>

      <Estado etiqueta="A carregar">
        {/* Sem texto "A carregar…": o `aria-busy` já o diz, e o texto seria
            ruído para quem ouve. Os blocos não se mexem, porque o movimento
            só acontece em resposta a uma ação. */}
        <div aria-busy="true" className="flex w-full max-w-vazio flex-col gap-3 py-8">
          {/* Larguras por fração e não por passos da escala de espaçamento:
              `w-8` e `w-12` são 32 e 48 px, e uma barra inteira seguida de
              dois cotos não lê como esqueleto, lê como avaria. */}
          <div className="h-4 w-full rounded-pequeno bg-fio-interno" />
          <div className="h-4 w-3/4 rounded-pequeno bg-fio-interno" />
          <div className="h-4 w-1/2 rounded-pequeno bg-fio-interno" />
        </div>
      </Estado>

      <Estado etiqueta="Erro">
        <EstadoVazio
          tom="erro"
          titulo="Não consegui carregar a ementa."
          linha="Verifica a ligação e tenta outra vez."
        >
          <Botao variante="principal">Tentar outra vez</Botao>
        </EstadoVazio>
      </Estado>
    </div>
  );
}

export function PaginaDemonstracao(): ReactElement {
  const [folhaAberta, setFolhaAberta] = useState<"wifi" | "foto" | "confirmar" | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "sucesso" | "erro";
    mensagem: string;
    reversivel: boolean;
  } | null>(null);

  const fecharFolha = (): void => {
    setFolhaAberta(null);
  };
  const fecharAviso = (): void => {
    setAviso(null);
  };

  return (
    <main className="mx-auto flex max-w-coluna flex-col gap-12 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-titulo text-destaque">Componentes do Bar da Tomazia</h1>
        <p className="text-corpo text-texto-suave">
          Os sete componentes base, com todos os estados. Pensada para 390 × 844.
        </p>
      </header>

      {/* Uma coluna, também a 1024 px. Em duas colunas, a Tipografia (curta)
          ficava ao lado das Cores (muito alta) e cada linha da grelha tomava a
          altura da célula mais alta: uns 60% da captura era bordô vazio. E a
          área pública é uma coluna de 640 px a toda a largura, por isso é
          nessa largura que os componentes têm de se ver. */}
      <div className="flex flex-col gap-12">
        <Seccao id="tipografia" titulo="Tipografia">
          <div className="flex flex-col gap-4">
            {TAMANHOS.map((tamanho) => (
              <p key={tamanho.nome} className={tamanho.classe}>
                {tamanho.nome}
              </p>
            ))}
          </div>
          <p className="text-corpo">
            {/* A linha que prova, numa captura, que o subconjunto latin chega
                para o português. O espaço antes do euro é inquebrável. */}
            Vão à praça de São João comprar pão e açúcar — 6,50{ESPACO_INQUEBRAVEL}€
          </p>
        </Seccao>

        <Seccao id="cores" titulo="Cores">
          <div className="grid grid-cols-2 gap-4">
            {PALETA.map((cor) => (
              <div key={cor.nome} className="flex flex-col gap-2">
                <div
                  className={juntar(
                    "h-8 w-full rounded-pequeno border border-contorno-superficie",
                    cor.classe,
                  )}
                />
                <p className="text-nota">{cor.nome}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4">
            {AMBITOS.map((ambito) => (
              <div
                key={ambito.classe}
                className={juntar(
                  "flex flex-col gap-3 rounded-cartao border border-contorno-superficie p-4",
                  ambito.classe,
                )}
              >
                <p className="text-nota font-forte">{ambito.nome}</p>
                <p className="text-corpo">Texto corrente</p>
                <p className="text-corpo text-texto-suave">Texto suave</p>
                <p className="text-nota text-sucesso">Mensagem de sucesso</p>
                <p className="text-nota text-erro">Mensagem de erro</p>
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-pequeno bg-acao" />
                  <div className="h-8 w-8 rounded-pequeno bg-perigo" />
                  <div className="h-8 w-8 rounded-pequeno border border-contorno" />
                </div>
                <p className="text-nota text-texto-suave">Ação, perigo e contorno</p>
              </div>
            ))}
          </div>
        </Seccao>

        <Seccao id="botao" titulo="Botão">
          <GrelhaDeBotoes />
          <p className="text-nota text-texto-suave">
            O premido vê-se a carregar e a segurar: o botão desce 1 px. Não há nada que se levante
            no hover — no telemóvel o hover nem existe.
          </p>
        </Seccao>

        <Seccao id="campo" titulo="Campo">
          <GrelhaDeCampos />
        </Seccao>

        <Seccao id="chip" titulo="Chip de categoria">
          <BarraDeChips nome="Categorias" />
          <p className="text-nota text-texto-suave">
            Onze chips, o primeiro ativo. A barra desliza na horizontal.
          </p>
        </Seccao>

        <Seccao id="folha" titulo="Folha">
          <div className="flex flex-col items-start gap-4">
            <Botao
              variante="principal"
              onClick={() => {
                setFolhaAberta("wifi");
              }}
            >
              WiFi
            </Botao>
            <Botao
              onClick={() => {
                setFolhaAberta("foto");
              }}
            >
              Enviar foto
            </Botao>
            <Botao
              variante="perigo"
              onClick={() => {
                setFolhaAberta("confirmar");
              }}
            >
              Eliminar produto
            </Botao>
          </div>
        </Seccao>

        <Seccao id="aviso" titulo="Aviso temporário">
          <div className="flex flex-col items-start gap-4">
            <Botao
              onClick={() => {
                setAviso({ tipo: "sucesso", mensagem: "Foto aprovada.", reversivel: false });
              }}
            >
              Aviso de sucesso
            </Botao>
            <Botao
              onClick={() => {
                setAviso({ tipo: "sucesso", mensagem: "Preço atualizado.", reversivel: true });
              }}
            >
              Aviso com Desfazer
            </Botao>
            <Botao
              onClick={() => {
                setAviso({
                  tipo: "erro",
                  mensagem: "Não consegui guardar. Tenta outra vez.",
                  reversivel: false,
                });
              }}
            >
              Aviso de erro
            </Botao>

            {/*
              O Aviso vive **aqui**, logo a seguir aos botões que o disparam, e
              não no fim da página. É `position: fixed`, por isso não muda um
              pixel — muda a ordem de tabulação, que é tudo o que interessa:
              estava a 44 tabulações do gatilho, e como o contador só pára
              quando o foco já está dentro do aviso, quem navega por teclado
              nunca chegava ao "Desfazer" nos cinco segundos. O mecanismo da
              WCAG 2.2.1 existia e era inútil. Daqui são duas.
            */}
            <AvisoTemporario
              tipo={aviso?.tipo ?? "sucesso"}
              mensagem={aviso?.mensagem}
              aoDesfazer={aviso?.reversivel === true ? fecharAviso : undefined}
              aoFechar={fecharAviso}
            />

            <p className="text-nota text-texto-suave">
              Some ao fim de cinco segundos. Com o rato por cima, ou com o foco lá dentro, o tempo
              pára. O «Desfazer» fica a duas tabulações do botão que o originou.
            </p>
          </div>
        </Seccao>

        <Seccao id="interruptor" titulo="Interruptor">
          <ListaDeInterruptores />
          <p className="text-nota text-texto-suave">
            Ligado, desligado e desativado. A linha inteira é clicável — é de lá que vêm os 44 px.
          </p>
        </Seccao>

        <Seccao id="estado-vazio" titulo="Estado vazio">
          <EstadosDeLista />
        </Seccao>

        <Seccao id="sobre-creme" titulo="Sobre creme">
          <p className="text-nota text-texto-suave">
            A secção que interessa olhar primeiro: os mesmos componentes dentro de um cartão creme.
            Se algum dourado tivesse escapado, era aqui que se via — e o limite do botão ficaria a
            1,72 contra o fundo.
          </p>

          <div className="superficie-creme flex flex-col gap-8 rounded-cartao border border-contorno-superficie p-4">
            <GrelhaDeBotoes />
            <GrelhaDeCampos />
            <BarraDeChips nome="Categorias sobre creme" />
            <ListaDeInterruptores />
            <EstadosDeLista />
          </div>

          <p className="text-nota text-texto-suave">
            O Aviso temporário não se repete aqui: é uma camada fixa por cima da página, e o dourado
            que ele podia ter estava no &laquo;Desfazer&raquo;, que é um botão secundário — repetido
            acima.
          </p>
        </Seccao>

        <Seccao id="foco" titulo="Foco">
          <p className="text-corpo">
            Percorre esta página com Tab: todos os controlos têm de mostrar um anel visível. Dentro
            do cartão creme o anel é bordô, não dourado — o dourado sobre creme dá 1,72 e não se
            veria.
          </p>
        </Seccao>
      </div>

      <Folha aberta={folhaAberta === "wifi"} titulo="WiFi" aoFechar={fecharFolha}>
        <p>
          Rede: <strong>Bar da Tomazia</strong>
        </p>
        <p>
          Password: <strong>tomazia2026</strong>
        </p>
        <Botao variante="principal" larguraTotal>
          Copiar password
        </Botao>
      </Folha>

      <Folha aberta={folhaAberta === "foto"} titulo="Enviar foto" aoFechar={fecharFolha}>
        <CampoDemonstracao etiqueta="O teu nome (opcional)" exemplo="Ana" />
        <CampoDemonstracao
          etiqueta="Uma linha sobre a foto"
          multilinha
          ajuda="Aparece por baixo da foto na galeria."
        />
        <Botao variante="principal" larguraTotal>
          Enviar foto
        </Botao>
        <Botao variante="discreto" larguraTotal onClick={fecharFolha}>
          Cancelar
        </Botao>
      </Folha>

      <Folha aberta={folhaAberta === "confirmar"} titulo="Eliminar produto" aoFechar={fecharFolha}>
        <p>Tem a certeza? O produto deixa de aparecer na ementa.</p>
        <Botao variante="perigo" larguraTotal onClick={fecharFolha}>
          Eliminar produto
        </Botao>
        <Botao variante="discreto" larguraTotal onClick={fecharFolha}>
          Cancelar
        </Botao>
      </Folha>
    </main>
  );
}
