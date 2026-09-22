import { PDFDocument } from 'pdf-lib';

// Padrão "10x15" das etiquetadoras térmicas (Elgin, Zebra etc.) usadas pra
// imprimir etiquetas de envio da Shopee no Brasil: 100mm de largura por
// 150mm de altura, em pé.
const MM_TO_PT = 72 / 25.4;
export const LABEL_WIDTH_PT = 100 * MM_TO_PT;
export const LABEL_HEIGHT_PT = 150 * MM_TO_PT;

// Encaixa cada página do PDF original numa página de 100x150mm, mantendo a
// proporção original (sem esticar) e centralizada. Isso evita distorcer
// código de barras/QR code, que ficam ilegíveis se esticados fora de escala.
export async function resizePdfToLabel(bytes: Uint8Array): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(bytes);
  const outDoc = await PDFDocument.create();

  for (const srcPage of srcDoc.getPages()) {
    const embedded = await outDoc.embedPage(srcPage);
    const outPage = outDoc.addPage([LABEL_WIDTH_PT, LABEL_HEIGHT_PT]);

    const scale = Math.min(LABEL_WIDTH_PT / embedded.width, LABEL_HEIGHT_PT / embedded.height);
    const drawWidth = embedded.width * scale;
    const drawHeight = embedded.height * scale;

    outPage.drawPage(embedded, {
      x: (LABEL_WIDTH_PT - drawWidth) / 2,
      y: (LABEL_HEIGHT_PT - drawHeight) / 2,
      xScale: scale,
      yScale: scale,
    });
  }

  return outDoc.save();
}
