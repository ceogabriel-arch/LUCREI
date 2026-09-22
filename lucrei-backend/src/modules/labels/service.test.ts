import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { LABEL_HEIGHT_PT, LABEL_WIDTH_PT, resizePdfToLabel } from './service';

async function buildSourcePdf(pageSizes: [number, number][]) {
  const doc = await PDFDocument.create();
  for (const [width, height] of pageSizes) {
    const page = doc.addPage([width, height]);
    // Página sem nenhum desenho não tem stream de conteúdo, e o pdf-lib não
    // consegue embutir (embedPage) uma página assim - precisa de algo nela.
    page.drawRectangle({ x: 0, y: 0, width, height });
  }
  return doc.save();
}

describe('resizePdfToLabel', () => {
  it('fits every page onto a 100x150mm page, one output page per input page', async () => {
    const src = await buildSourcePdf([
      [300, 400],
      [600, 200],
    ]);

    const outBytes = await resizePdfToLabel(src);
    const outDoc = await PDFDocument.load(outBytes);
    const pages = outDoc.getPages();

    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(page.getWidth()).toBeCloseTo(LABEL_WIDTH_PT, 3);
      expect(page.getHeight()).toBeCloseTo(LABEL_HEIGHT_PT, 3);
    }
  });

  it('rejects bytes that are not a valid PDF', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    await expect(resizePdfToLabel(garbage)).rejects.toThrow();
  });
});
