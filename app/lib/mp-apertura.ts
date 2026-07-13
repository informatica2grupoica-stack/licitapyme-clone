// app/lib/mp-apertura.ts
// Detección de "¿esta licitación ya está APERTURADA?" leyendo el MISMO portal de MP que se
// usa para descargar documentos (DetailsAcquisition.aspx), NO la API.
//
// Cómo se distingue (verificado con fichas reales, jul-2026):
//   · Aún abierta / sin apertura → la ficha solo trae el ícono ESTÁTICO de apertura:
//       PreviewTechnicalOpeningResults.aspx?qs=<idlic>   (link "gris", siempre presente)
//   · Ya APERTURADA → además aparece el acceso REAL a los resultados de apertura:
//       OpeningFrame.aspx?enc=<token>   y/o   PreviewElectronicOpening.aspx
//     El token `enc=` solo se genera cuando el acto de apertura ya ocurrió → "puedes entrar
//     a la apertura" = está aperturada. Ese es el discriminador.
//
// Requiere IP chilena (WAF de MP), igual que la descarga → corre en el notebook/VPS, no en Vercel.

import { obtenerFichaHTML } from '@/app/lib/mp-adjuntos';

export interface ResultadoApertura {
  aperturada: boolean;
  evidencia: string;   // qué marcador la delató (para depurar)
}

// Marcadores que SOLO aparecen cuando la apertura ya se realizó.
const RE_OPENING_FRAME      = /OpeningFrame\.aspx\?enc=/i;         // acceso real a resultados (token enc)
const RE_OPENING_ELECTRONIC = /PreviewElectronicOpening\.aspx/i;  // apertura electrónica publicada
// Cualquier página de "Opening" con token enc= (no el qs= del ícono estático) también cuenta.
const RE_OPENING_ENC        = /Opening[A-Za-z]*\.aspx\?enc=/i;

// Devuelve el estado de apertura, o null si no se pudo leer el portal (WAF/timeout/MP caído).
// null = "desconocido": el caller NO debe marcar nada (se reintenta la próxima corrida).
export async function detectarAperturaPortal(codigo: string): Promise<ResultadoApertura | null> {
  try {
    const { html } = await obtenerFichaHTML(codigo);
    if (!html) return null;

    const frame      = RE_OPENING_FRAME.test(html);
    const electronica = RE_OPENING_ELECTRONIC.test(html);
    const encGenerico = RE_OPENING_ENC.test(html);
    const aperturada = frame || electronica || encGenerico;

    return {
      aperturada,
      evidencia: frame ? 'OpeningFrame.enc'
        : electronica ? 'PreviewElectronicOpening'
        : encGenerico ? 'Opening.enc'
        : 'solo-icono-estatico',
    };
  } catch (e) {
    console.error(`[mp-apertura] no se pudo leer la ficha de ${codigo}:`, String(e));
    return null;
  }
}
