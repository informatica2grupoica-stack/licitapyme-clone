import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes server-only que no deben empacarse con Turbopack/Webpack
  serverExternalPackages: [
    'pdf-parse',
    'mupdf',
    'tesseract.js',
    'mammoth',
    'puppeteer-core',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    '@sparticuz/chromium',
  ],

  // Turbopack es el bundler por defecto en Next.js 16
  // Config vacía para indicar que lo usamos intencionalmente
  turbopack: {},

  // Cabeceras de seguridad básicas (sin CSP: la app usa estilos/scripts en línea de Mantine).
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default nextConfig;
