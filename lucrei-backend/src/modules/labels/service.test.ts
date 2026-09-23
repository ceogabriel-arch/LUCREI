import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { LABEL_HEIGHT_PT, LABEL_WIDTH_PT, pickShippingLabelRegion, resizePdfToLabel } from './service';

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

describe('pickShippingLabelRegion', () => {
  it('returns null when there are no marks', () => {
    expect(pickShippingLabelRegion([])).toBeNull();
  });

  it('merges marks that are close together into a single region', () => {
    const marks = [
      { minX: 0, minY: 0, maxX: 50, maxY: 100 },
      { minX: 55, minY: 0, maxX: 120, maxY: 100 },
    ];
    expect(pickShippingLabelRegion(marks)).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 100 });
  });

  it('keeps only the left-most island, ignoring a separate document further right', () => {
    // Simula uma etiqueta de envio (0-120) e um DANFE separado mais à
    // direita (140-320) - o vão entre eles (20pt) é maior que o mínimo
    // fixo (14pt, calibrado com PDFs reais de Mercado Livre), então tem
    // que cortar fora o DANFE.
    const marks = [
      { minX: 0, minY: 0, maxX: 50, maxY: 100 },
      { minX: 55, minY: 10, maxX: 120, maxY: 90 },
      { minX: 140, minY: 0, maxX: 320, maxY: 150 },
    ];
    expect(pickShippingLabelRegion(marks)).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 100 });
  });

  it('handles a single mark (the common case of one label per page)', () => {
    const marks = [{ minX: 10, minY: 20, maxX: 200, maxY: 300 }];
    expect(pickShippingLabelRegion(marks)).toEqual(marks[0]);
  });
});
