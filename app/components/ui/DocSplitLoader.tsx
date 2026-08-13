// Animación de "separar anexos" (POST /api/anexos/separar) — un documento combinado se abre
// en dos con una tijera que corta justo en el quiebre. Mismo lenguaje visual que DocScanLoader
// (lectura de documentos), estilos en globals.css (.docsplit*).
//
// Uso: <DocSplitLoader titulo="Separando anexos…" subtitulo="Puede tardar unos segundos." />
import { Scissors } from 'lucide-react';

export function DocSplitLoader({
  titulo,
  subtitulo,
}: {
  titulo?: string;
  subtitulo?: string;
}) {
  return (
    <div className="flex flex-col items-center" role="status" aria-label={titulo || 'Separando anexos'}>
      <div className="docsplit" aria-hidden="true">
        <div className="docsplit-doc docsplit-base">
          <span className="docsplit-line" style={{ width: '85%' }} />
          <span className="docsplit-line" style={{ width: '60%' }} />
          <span className="docsplit-line" style={{ width: '90%' }} />
          <span className="docsplit-line" style={{ width: '70%' }} />
        </div>
        <div className="docsplit-doc docsplit-left">
          <span className="docsplit-line" style={{ width: '80%' }} />
          <span className="docsplit-line" style={{ width: '55%' }} />
        </div>
        <div className="docsplit-doc docsplit-right">
          <span className="docsplit-line" style={{ width: '75%' }} />
          <span className="docsplit-line" style={{ width: '60%' }} />
        </div>
        <Scissors className="docsplit-snip" strokeWidth={2.4} />
      </div>
      {titulo && <p className="text-[14px] font-semibold text-slate-700 mt-3">{titulo}</p>}
      {subtitulo && <p className="text-[12px] text-slate-400 mt-1 text-center max-w-xs">{subtitulo}</p>}
    </div>
  );
}
