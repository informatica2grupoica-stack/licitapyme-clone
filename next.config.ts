import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes server-only que no deben empacarse con Turbopack/Webpack
  serverExternalPackages: [
    'pdf-parse',
    'mammoth',
    'puppeteer-core',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    '@sparticuz/chromium',
  ],

  // Turbopack es el bundler por defecto en Next.js 16
  // Config vacía para indicar que lo usamos intencionalmente
  turbopack: {},
};

export default nextConfig;
