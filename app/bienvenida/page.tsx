// Landing pública de LICITANK — página de presentación antes del login.
// Server Component: exporta la metadata (SEO) y renderiza el cliente animado.
import type { Metadata } from 'next';
import Landing from './Landing';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.licitank.cl';
const TITULO = 'LICITANK — Radar y gestión de licitaciones públicas';
const DESCRIPCION =
  'LICITANK vigila Mercado Público con tus palabras clave, te muestra lo nuevo cada día y te deja asignar y seguir cada licitación con tu equipo.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: TITULO,
  description: DESCRIPCION,
  keywords: [
    'licitaciones', 'mercado público', 'chilecompra', 'licitaciones chile',
    'compras públicas', 'viabilidad licitaciones', 'inteligencia artificial licitaciones',
    'radar de licitaciones', 'LICITANK',
  ],
  applicationName: 'LICITANK',
  authors: [{ name: 'LICITANK' }],
  alternates: { canonical: '/bienvenida' },
  openGraph: {
    type: 'website',
    siteName: 'LICITANK',
    title: TITULO,
    description: DESCRIPCION,
    url: `${APP_URL}/bienvenida`,
    locale: 'es_CL',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITULO,
    description: DESCRIPCION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function BienvenidaPage() {
  return <Landing />;
}
