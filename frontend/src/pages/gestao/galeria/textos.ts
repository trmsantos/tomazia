import type { FotoAprovada, FotoPendente } from "../../../lib/api/gestao-fotos";
import { quandoFoiEnviada } from "./quando-foi-enviada";

/**
 * Todo o texto visível da moderação de fotos (F4-04, spec 15), validado pelo dominio-bar em
 * 2026-11-19. PT-PT, maiúscula só no início, sem emojis nem setas, reticências em «…».
 * «Tem a certeza?» é a única frase formal do ecrã: o resto fala por «tu».
 */
export const TEXTOS = {
  titulo: "Galeria",
  enviarFoto: "Enviar foto",
  fotosAEspera: "Fotos à espera",
  fotosAEsperaN: (n: number): string => `Fotos à espera (${String(n)})`,

  aprovar: "Aprovar",
  rejeitar: "Rejeitar",
  aAprovar: "A aprovar…",
  aRejeitar: "A rejeitar…",

  /** «Enviada hoje, às 23:40»; o `quando` vem de `quandoFoiEnviada`. */
  enviadaEm: (quando: string): string => `Enviada ${quando}`,
  porNome: (nome: string): string => `, por ${nome}`,
  legendaNoSite: "Legenda no site",

  avisoAprovada: "Foto aprovada. Já aparece no site.",
  avisoRejeitada: "Foto rejeitada.",

  vazioTitulo: "Não há fotos à espera.",
  vazioLinha: "Quando um cliente enviar uma, aparece aqui.",

  carregarTitulo: "Não consegui carregar as fotos.",
  carregarSemResposta: "Verifica a ligação e tenta outra vez.",
  carregarServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",

  tituloRejeitar: "Tem a certeza?",
  rejeitarAviso: "A foto é apagada e não aparece no site. Não se pode desfazer.",
  cancelar: "Cancelar",
  rejeitarServidor:
    "Não consegui rejeitar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  aprovarServidor:
    "Não consegui aprovar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  // Sem resposta (spec 9.4): nunca se diz «aprovada» nem «não aprovada» como facto.
  verificarAprovada: "Não consegui confirmar se a foto ficou aprovada. A verificar…",
  verificarRejeitada: "Não consegui confirmar se a foto ficou rejeitada. A verificar…",
  continuaAprovar: "Não consegui aprovar. Verifica a ligação e tenta outra vez.",
  continuaRejeitar: "Não consegui rejeitar. Verifica a ligação e tenta outra vez.",
  semConfirmarAprovada:
    "Não consegui confirmar se a foto ficou aprovada. Verifica a ligação e toca em Verificar outra vez.",
  semConfirmarRejeitada:
    "Não consegui confirmar se a foto ficou rejeitada. Verifica a ligação e toca em Verificar outra vez.",
  verificarOutraVez: "Verificar outra vez",

  // 409 e 404 (spec 9.2 e 9.3): informação sobre a foto anterior, não erro.
  outroAparelhoRejeitada: "A foto anterior já tinha sido rejeitada noutro aparelho.",
  outroAparelhoAprovada: "A foto anterior já tinha sido aprovada noutro aparelho.",
  jaNaoExistia: "A foto anterior já não existia.",

  // A imagem não carrega (spec 9.5).
  aVerificarFoto: "A verificar a foto…",
  fotoSemLigacao: "Não consegui mostrar esta foto. Verifica a ligação.",
  fotoNaoSeMostra: "Esta foto não se consegue mostrar. Só a podes rejeitar.",
  fotoNaoSeMostraNaFolha: "Esta foto não se consegue mostrar.",
  jaModerada: "A foto anterior já tinha sido aprovada ou rejeitada.",

  // A folha de enviar (spec 7).
  tituloEnviar: "Enviar foto",
  promessaEnviar: "A foto entra na fila e só aparece no site depois de a aprovares.",
  etiquetaFoto: "Foto",
  etiquetaLegenda: "Legenda (opcional)",
  ajudaLegenda: "Aparece no site, junto da foto.",
  enviar: "Enviar foto",
  aEnviar: "A enviar…",
  aPreparar: "A preparar a foto…",
  demoraUmPouco: "Pode demorar um pouco em fotos grandes.",
  falhaAPreparar: "Não consegui preparar esta foto. Tenta outra, ou tira uma fotografia nova.",
  semEscolha: "Escolhe uma foto para enviar.",
  fotoEnviada: "Foto enviada. Está na fila para aprovares.",
  envioSemSaber:
    "Não sei se a foto foi enviada. Atualizei a fila: vê se já lá está antes de tentar outra vez.",
  envioServidor:
    "Não consegui enviar a foto. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  saidaTitulo: "Ainda não enviaste a foto.",
  saidaLinha: "Se saíres agora, a foto e a legenda perdem-se.",
  saidaSair: "Sair sem enviar",
  saidaContinuar: "Continuar",
} as const;

/**
 * O `alt` da foto em moderação: «Foto enviada {quando}». **Nunca a legenda nem o nome**: são
 * texto de terceiros, não verificado, que um leitor de ecrã leria como se descrevesse a imagem
 * — e o dono está precisamente a decidir se a confia.
 */
export function altDaFoto(foto: FotoPendente, agora: Date): string {
  return `Foto enviada ${quandoFoiEnviada(foto.criada_em, agora)}`;
}

/**
 * Onde aparece cada erro do `POST /fotos` na folha de enviar (spec 7.5). Cópia do mapa da F3-05
 * (o público não importa da gestão nem a gestão do público, para o público não puxar nada do
 * chunk da gestão), **sem «nome»**: a folha do dono não tem esse campo.
 */
export const DESTINO_POR_CODIGO: Record<string, "foto" | "legenda" | "geral"> = {
  imagem_invalida: "foto",
  imagem_demasiado_grande: "foto",
  ficheiro_grande_demais: "foto",
  descricao_grande_demais: "legenda",
  dados_invalidos: "geral",
  tamanho_do_pedido_em_falta: "geral",
  limite_de_envios_excedido: "geral",
};

/**
 * Todo o texto visível da secção «Fotos no site» e da folha de eliminar (F4-04b, spec 12),
 * validado pelo dominio-bar. A palavra é **Eliminar**, a foto fica **eliminada**.
 * `quando` vem de `quandoFoiEnviada`.
 */
export const TEXTOS_APROVADAS = {
  titulo: "Fotos no site",
  tituloN: (n: number): string => `Fotos no site (${String(n)})`,

  /** Sem `quando` (foto sem data de aprovação): só «Aprovada». */
  aprovadaEm: (quando: string | null): string =>
    quando === null ? "Aprovada" : `Aprovada ${quando}`,
  enviadaPor: (nome: string): string => `Enviada por ${nome}`,
  eliminar: "Eliminar",
  aEliminar: "A eliminar…",
  cancelar: "Cancelar",
  /** O nome acessível: nunca a legenda nem o nome (texto de terceiros). */
  nomeDoBotao: (quando: string): string => `Eliminar foto aprovada ${quando}`,
  /** Sem data de aprovação, distingue-se pela data de envio (também nossa, nunca de terceiros). */
  nomeDoBotaoSemData: (envio: string): string => `Eliminar foto aprovada enviada ${envio}`,
  semImagem: "Sem imagem",

  vazioTitulo: "Ainda não há fotos no site.",
  vazioLinha: "As que aprovares aparecem aqui.",

  carregarTitulo: "Não consegui carregar as fotos do site.",
  carregarSemResposta: "Verifica a ligação e tenta outra vez.",
  carregarServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  desatualizada: "Não consegui atualizar esta lista. Pode estar desatualizada.",

  aMostrar: (x: number, n: number): string => `A mostrar ${String(x)} de ${String(n)}.`,
  mostrarMais: "Mostrar mais fotos",

  tituloDaFolha: "Tem a certeza?",
  avisoDaFolha: "A foto deixa de aparecer no site e é eliminada. Não se pode desfazer.",
  naoSeMostra: "Esta foto não se consegue mostrar.",
  erroNaFolha:
    "Não consegui eliminar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  avisoEliminada: "Foto eliminada.",
  jaNaoExistia: "Essa foto já não existia.",
  jaNaoEstaNoSite: "Essa foto já não está no site.",

  // Sem resposta (spec 8.4): nunca se diz «eliminada» nem «não eliminada» como facto.
  aVerificar: "Não consegui confirmar se a foto foi eliminada. A verificar…",
  continuaSemResposta: "Não consegui eliminar. Verifica a ligação e tenta outra vez.",
  semConfirmar:
    "Não consegui confirmar se a foto foi eliminada. Verifica a ligação e toca em Verificar outra vez.",
  verificarOutraVez: "Verificar outra vez",
} as const;

/** Quando a foto foi aprovada, em Lisboa; `null` se não tem data de aprovação. */
export function quandoFoiAprovada(foto: FotoAprovada, agora: Date): string | null {
  return foto.moderada_em === null ? null : quandoFoiEnviada(foto.moderada_em, agora);
}

/** O nome acessível do «Eliminar» de um item: só datas nossas, nunca a legenda nem o nome. */
export function nomeDoBotaoEliminar(foto: FotoAprovada, agora: Date): string {
  const quando = quandoFoiAprovada(foto, agora);
  return quando === null
    ? TEXTOS_APROVADAS.nomeDoBotaoSemData(quandoFoiEnviada(foto.criada_em, agora))
    : TEXTOS_APROVADAS.nomeDoBotao(quando);
}
