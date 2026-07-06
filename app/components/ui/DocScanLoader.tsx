// Animación de "lectura de documentos" para los estados de carga de viabilidad:
// una hoja cuyas líneas se van leyendo, hojas que pasan, y una lupa que barre.
// Reemplaza al spinner genérico. Estilos en globals.css (.docscan*).
//
// Uso:  <DocScanLoader titulo="Leyendo los documentos…" subtitulo="Puede tardar 1–2 minutos." />

export function DocScanLoader({
  titulo,
  subtitulo,
}: {
  titulo?: string;
  subtitulo?: string;
}) {
  return (
    <div className="flex flex-col items-center" role="status" aria-label={titulo || 'Leyendo documentos'}>
      <div className="docscan" aria-hidden="true">
        <div className="docscan-page" />
        <div className="docscan-doc">
          <span className="docscan-line" />
          <span className="docscan-line" />
          <span className="docscan-line" />
          <span className="docscan-line" />
        </div>
        <div className="docscan-lupa">
          <span className="docscan-lente" />
          <span className="docscan-mango" />
        </div>
      </div>
      {titulo && <p className="text-[14px] font-semibold text-slate-700 mt-3">{titulo}</p>}
      {subtitulo && <p className="text-[12px] text-slate-400 mt-1 text-center max-w-xs">{subtitulo}</p>}
    </div>
  );
}
