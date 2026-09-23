import { PDFDocument } from 'pdf-lib';

// Padrão "10x15" das etiquetadoras térmicas (Elgin, Zebra etc.) usadas pra
// imprimir etiquetas de envio da Shopee no Brasil: 100mm de largura por
// 150mm de altura, em pé.
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

// PDFs de etiqueta que a Shopee gera costumam vir numa folha A4, mas com o
// conteúdo real (endereço, QR code, código de barras) desenhado no tamanho
// físico real da etiqueta, ancorado no canto superior esquerdo da página -
// o resto da folha fica em branco. Se a gente só encolhe a página inteira
// pra caber em 100x150mm, esse espaço em branco encolhe junto e a etiqueta
// sai pequena, cercada de margem. Por isso detectamos aqui a área realmente
// desenhada (imagens, traços e texto) pra usar como referência do
// recorte/escala, em vez do tamanho bruto da página.
async function detectContentBBox(pdfjsPage: {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent: () => Promise<{ items: Array<{ transform?: number[]; width?: number; height?: number }> }>;
}): Promise<BBox | null> {
  const pdfjsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as { OPS: Record<string, number> };
  const { OPS } = pdfjsLib;

  const bbox: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const expand = (pts: Array<[number, number]>) => {
    for (const [x, y] of pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      bbox.minX = Math.min(bbox.minX, x);
      bbox.minY = Math.min(bbox.minY, y);
      bbox.maxX = Math.max(bbox.maxX, x);
      bbox.maxY = Math.max(bbox.maxY, y);
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

  if (!Number.isFinite(bbox.minX) || !Number.isFinite(bbox.maxX) || bbox.maxX <= bbox.minX || bbox.maxY <= bbox.minY) {
    return null;
  }
  return bbox;
}

// Encaixa a área de conteúdo de cada página do PDF original numa página de
// 100x150mm, mantendo a proporção original (sem esticar) e centralizada.
// Isso evita distorcer código de barras/QR code, que ficam ilegíveis se
// esticados fora de escala.
export async function resizePdfToLabel(bytes: Uint8Array): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(bytes);
  const outDoc = await PDFDocument.create();

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
      bbox = await detectContentBBox(pdfjsPage as any);
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

    const outPage = outDoc.addPage([LABEL_WIDTH_PT, LABEL_HEIGHT_PT]);
    const scale = Math.min(LABEL_WIDTH_PT / regionW, LABEL_HEIGHT_PT / regionH);

    outPage.drawPage(embedded, {
      x: (LABEL_WIDTH_PT - regionW * scale) / 2 - region.minX * scale,
      y: (LABEL_HEIGHT_PT - regionH * scale) / 2 - region.minY * scale,
      xScale: scale,
      yScale: scale,
    });
  }

  return outDoc.save();
}
