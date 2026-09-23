import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// Padrão "10x15" das etiquetadoras térmicas (Elgin, Zebra etc.) usadas pra
// imprimir etiquetas de envio da Shopee/Mercado Livre no Brasil: 100mm de
// largura por 150mm de altura, em pé.
const MM_TO_PT = 72 / 25.4;
export const LABEL_WIDTH_PT = 100 * MM_TO_PT;
export const LABEL_HEIGHT_PT = 150 * MM_TO_PT;

type BBox = { minX: number; minY: number; maxX: number; maxY: number };
type Matrix = [number, number, number, number, number, number];

function mulMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrix(m: Matrix | number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function normalize(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

// PDFs de etiqueta que Shopee/Mercado Livre geram costumam vir numa folha
// A4, mas com o conteúdo real (endereço, QR code, código de barras)
// desenhado no tamanho físico real da etiqueta, geralmente ancorado num
// canto da página - o resto da folha fica em branco. Se a gente só encolhe
// a página inteira pra caber em 100x150mm, esse espaço em branco encolhe
// junto e a etiqueta sai pequena, cercada de margem. Por isso detectamos
// aqui a área realmente desenhada (imagens, traços e texto) pra usar como
// referência do recorte/escala, em vez do tamanho bruto da página - não
// depende de onde exatamente o marketplace ancorou o conteúdo.
//
// Devolve UMA caixa por marca (imagem/traço/texto) em vez de já mesclar
// tudo numa caixa só - o Mercado Livre às vezes desenha a etiqueta de envio
// e uma declaração fiscal (DANFE) lado a lado na mesma página, e mesclar as
// duas cedo demais faria o recorte abranger as duas juntas, encolhendo tudo
// e sobrando margem enorme. Quem chama decide como agrupar essas marcas.
export async function detectContentMarks(pdfjsPage: {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent: () => Promise<{ items: Array<{ transform?: number[]; width?: number; height?: number }> }>;
}): Promise<BBox[]> {
  const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as { OPS: Record<string, number> };
  const { OPS } = pdfjsLib;

  const marks: BBox[] = [];
  const expand = (pts: Array<[number, number]>) => {
    const bbox: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [x, y] of pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      bbox.minX = Math.min(bbox.minX, x);
      bbox.minY = Math.min(bbox.minY, y);
      bbox.maxX = Math.max(bbox.maxX, x);
      bbox.maxY = Math.max(bbox.maxY, y);
    }
    if (Number.isFinite(bbox.minX) && bbox.maxX > bbox.minX && bbox.maxY > bbox.minY) {
      marks.push(bbox);
    }
  };

  const opList = await pdfjsPage.getOperatorList();
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as number[] & { 0?: unknown };

    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.transform) {
      ctm = mulMatrix(ctm, args as unknown as Matrix);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = (args as unknown as [Matrix | null])[0];
      if (Array.isArray(matrix) && matrix.length === 6) {
        ctm = mulMatrix(ctm, matrix as Matrix);
      }
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      expand([applyMatrix(ctm, 0, 0), applyMatrix(ctm, 1, 0), applyMatrix(ctm, 0, 1), applyMatrix(ctm, 1, 1)]);
    } else if (fn === OPS.constructPath) {
      // args = [subops, minMaxBox, coords] - minMaxBox já vem como
      // [xmin,ymin,xmax,ymax] do próprio traçado, cobre curvas também.
      const minMax = (args as unknown as [unknown, number[]])[1];
      const [xmin, ymin, xmax, ymax] = minMax ?? [];
      if ([xmin, ymin, xmax, ymax].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        expand([
          applyMatrix(ctm, xmin, ymin),
          applyMatrix(ctm, xmax, ymin),
          applyMatrix(ctm, xmin, ymax),
          applyMatrix(ctm, xmax, ymax),
        ]);
      }
    }
  }

  const textContent = await pdfjsPage.getTextContent();
  for (const item of textContent.items) {
    if (!item.transform) continue;
    const t = item.transform;
    const w = item.width ?? 0;
    const h = item.height ?? 0;
    // item.width/height já são comprimentos finais no espaço da página (não
    // unidades de glifo pra escalar de novo pela matriz) - avançam na
    // direção dos vetores da própria matriz do texto.
    const [ux, uy] = normalize(t[0], t[1]);
    const [vx, vy] = normalize(t[2], t[3]);
    const ox = t[4];
    const oy = t[5];
    expand([
      [ox, oy],
      [ox + ux * w, oy + uy * w],
      [ox + vx * h, oy + vy * h],
      [ox + ux * w + vx * h, oy + uy * w + vy * h],
    ]);
  }

  return marks;
}

// Agrupa as marcas em "ilhas" pela posição horizontal: duas marcas cujo
// intervalo de X está mais perto que o vão mínimo entram no mesmo bloco (é
// o espaçamento normal entre elementos de UMA etiqueta - código de barras,
// texto, QR code). Um vão maior indica outra coisa desenhada do lado (a
// declaração fiscal, outra etiqueta) - vira um bloco separado. Etiqueta de
// envio é sempre a mais à esquerda: é a convenção da Shopee/Mercado Livre
// quando isso aparece, e continua funcionando quando só existe uma marca
// mesmo (o caso comum, uma etiqueta só por página).
//
// O vão mínimo é um valor fixo, não proporcional à largura da página: numa
// etiqueta real de Mercado Livre com etiqueta + DANFE lado a lado numa
// folha A4 deitada (larga), o vão de verdade entre os dois documentos foi
// medido em ~17.6pt - bem menor que 3% da largura dessa página (~25pt),
// que juntava os dois por engano. Espaçamentos DENTRO de um mesmo
// documento (entre linhas de texto, código de barras etc.) ficaram bem
// abaixo disso (~2pt) nos PDFs reais testados.
const MIN_ISLAND_GAP_PT = 14;

export function pickShippingLabelRegion(marks: BBox[]): BBox | null {
  if (marks.length === 0) return null;

  const sorted = [...marks].sort((a, b) => a.minX - b.minX);
  const island: BBox = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const mark = sorted[i];
    if (mark.minX - island.maxX > MIN_ISLAND_GAP_PT) break; // próximo bloco - a etiqueta de envio já terminou
    island.minX = Math.min(island.minX, mark.minX);
    island.minY = Math.min(island.minY, mark.minY);
    island.maxX = Math.max(island.maxX, mark.maxX);
    island.maxY = Math.max(island.maxY, mark.maxY);
  }

  return island;
}

// Número do pedido da Shopee (ex: "260923QART6FYH"): 6 dígitos de data
// (AAMMDD) + 8 caracteres alfanuméricos maiúsculos, sempre 14 no total. Bem
// mais confiável que procurar o valor perto do texto "Pedido:" na etiqueta -
// a ordem dos itens de texto no PDF não segue a ordem visual do layout, o
// rótulo e o valor não ficam nem perto um do outro na lista.
const ORDER_SN_PATTERN = /^\d{6}[A-Z0-9]{8}$/;

// Extrai o número do pedido de cada página (ou null se não achar) - usado
// por quem chama pra cruzar com os pedidos já sincronizados no Lucrei e
// escrever o nome do produto na própria etiqueta. Só funciona pra etiquetas
// da Shopee, que é o único marketplace com pedidos sincronizados no banco.
export async function extractOrderSnsByPage(bytes: Uint8Array): Promise<Array<string | null>> {
  const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (opts: { data: Uint8Array }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
      }>;
    };
  };
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;

  const result: Array<string | null> = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const match = textContent.items.find((item) => item.str && ORDER_SN_PATTERN.test(item.str.trim()));
    result.push(match?.str?.trim() ?? null);
  }
  return result;
}

// Altura reservada no topo da etiqueta pro nome do produto, quando a gente
// consegue identificar o pedido - encolhe um pouco o conteúdo de envio
// (proporcionalmente, sem distorcer) pra abrir espaço sem sobrepor nada,
// já que a etiqueta normalmente já preenche a página inteira.
const PRODUCT_BAND_HEIGHT_PT = 12 * MM_TO_PT;
const PRODUCT_BAND_SIDE_MARGIN_PT = 6;

function drawProductBand(page: PDFPage, font: PDFFont, label: string, contentAreaHeight: number) {
  const maxWidth = LABEL_WIDTH_PT - PRODUCT_BAND_SIDE_MARGIN_PT * 2;

  let size = 10;
  while (size > 6 && font.widthOfTextAtSize(label, size) > maxWidth) {
    size -= 0.5;
  }

  let display = label;
  while (display.length > 1 && font.widthOfTextAtSize(`${display}…`, size) > maxWidth) {
    display = display.slice(0, -1);
  }
  if (display !== label) display += '…';

  const textWidth = font.widthOfTextAtSize(display, size);
  const bandTop = LABEL_HEIGHT_PT;
  const bandBottom = contentAreaHeight;

  page.drawText(display, {
    x: (LABEL_WIDTH_PT - textWidth) / 2,
    y: (bandTop + bandBottom) / 2 - size * 0.35,
    size,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawLine({
    start: { x: PRODUCT_BAND_SIDE_MARGIN_PT, y: bandBottom },
    end: { x: LABEL_WIDTH_PT - PRODUCT_BAND_SIDE_MARGIN_PT, y: bandBottom },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
}

// Encaixa a área de conteúdo de cada página do PDF original numa página de
// 100x150mm, mantendo a proporção original (sem esticar) e centralizada.
// Isso evita distorcer código de barras/QR code, que ficam ilegíveis se
// esticados fora de escala.
export async function resizePdfToLabel(
  bytes: Uint8Array,
  opts?: { productLabelByPage?: Array<string | null | undefined> }
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(bytes);
  const outDoc = await PDFDocument.create();
  const productLabelByPage = opts?.productLabelByPage;
  const boldFont = productLabelByPage?.some(Boolean) ? await outDoc.embedFont(StandardFonts.HelveticaBold) : null;

  const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument: (opts: { data: Uint8Array }) => { promise: Promise<{ getPage: (n: number) => Promise<unknown> }> };
  };
  // pdfjs-dist recusa receber um Buffer (mesmo sendo subclasse de
  // Uint8Array) - e a rota HTTP entrega um Buffer via file.toBuffer(). Copia
  // pra um Uint8Array "puro", separado do que o pdf-lib está lendo.
  const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;

  const srcPages = srcDoc.getPages();
  for (let i = 0; i < srcPages.length; i++) {
    const srcPage = srcPages[i];
    const embedded = await outDoc.embedPage(srcPage);

    let bbox: BBox | null = null;
    try {
      const pdfjsPage = await pdfjsDoc.getPage(i + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const marks = await detectContentMarks(pdfjsPage as any);
      bbox = pickShippingLabelRegion(marks);
    } catch {
      bbox = null;
    }

    // Sem conteúdo detectável (raro) - cai de volta pra página inteira, pra
    // não quebrar em PDFs fora do padrão esperado.
    const rawRegion = bbox ?? { minX: 0, minY: 0, maxX: embedded.width, maxY: embedded.height };

    // A largura de texto que o pdf.js reporta é o avanço da pena, não a
    // tinta de verdade - a primeira letra de uma linha às vezes desenha um
    // pouco à esquerda da origem (bearing negativo/serifa), cortando essa
    // pontinha se o recorte for exato. Uma margem pequena (bem menor que a
    // folga grande que já foi corrigida) evita esse corte sem voltar a
    // deixar a etiqueta pequena dentro de uma moldura em branco.
    const BLEED_PT = 3;
    const region = bbox
      ? {
          minX: Math.max(0, rawRegion.minX - BLEED_PT),
          minY: Math.max(0, rawRegion.minY - BLEED_PT),
          maxX: Math.min(embedded.width, rawRegion.maxX + BLEED_PT),
          maxY: Math.min(embedded.height, rawRegion.maxY + BLEED_PT),
        }
      : rawRegion;
    const regionW = region.maxX - region.minX;
    const regionH = region.maxY - region.minY;

    const productLabel = productLabelByPage?.[i];
    const contentAreaHeight = productLabel && boldFont ? LABEL_HEIGHT_PT - PRODUCT_BAND_HEIGHT_PT : LABEL_HEIGHT_PT;

    const outPage = outDoc.addPage([LABEL_WIDTH_PT, LABEL_HEIGHT_PT]);
    const scale = Math.min(LABEL_WIDTH_PT / regionW, contentAreaHeight / regionH);

    outPage.drawPage(embedded, {
      x: (LABEL_WIDTH_PT - regionW * scale) / 2 - region.minX * scale,
      y: (contentAreaHeight - regionH * scale) / 2 - region.minY * scale,
      xScale: scale,
      yScale: scale,
    });

    if (productLabel && boldFont) {
      drawProductBand(outPage, boldFont, productLabel, contentAreaHeight);
    }
  }

  return outDoc.save();
}
