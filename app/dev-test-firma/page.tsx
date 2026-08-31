'use client';
// TEMPORAL — banco de pruebas del componente de firma libre. Borrar al terminar.
import { useEffect, useState } from 'react';
import { AnexoFirmarPdf } from '@/app/components/AnexoFirmarPdf';

// Proporción bien marcada (320x120 = 2.667) para que cualquier deformación salte a la vista.
const svg = (texto: string, color: string) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect x="2" y="2" width="316" height="116" fill="none" stroke="${color}" stroke-width="4"/><text x="14" y="76" font-family="cursive" font-size="42" fill="${color}">${texto}</text></svg>`);

export default function Page() {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    (async () => {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 1; i <= 2; i++) {
        const pg = doc.addPage([595, 842]);
        pg.drawText(`FORMULARIO ADMI-1 — pagina ${i}`, { x: 60, y: 780, size: 16, font, color: rgb(0.1, 0.1, 0.3) });
        for (let l = 0; l < 20; l++) {
          pg.drawText(`linea ${l + 1} de texto del anexo de prueba`, { x: 60, y: 730 - l * 26, size: 11, font, color: rgb(0.25, 0.25, 0.25) });
        }
      }
      setBytes((await doc.save()).buffer as ArrayBuffer);
    })();
  }, []);
  if (!bytes) return <div style={{ padding: 40 }}>generando pdf…</div>;
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
      <AnexoFirmarPdf
        pdfBytes={bytes}
        firmaUrl={svg('Firma', '%23123a8f')}
        timbreUrl={svg('Timbre', '%23a01010')}
        generando={false}
        onConfirmar={(e) => { (window as any).__ESTAMPAS = e; }}
        onVolver={() => {}}
      />
    </div>
  );
}
