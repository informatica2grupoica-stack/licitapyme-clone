import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Paquetes que usan fs/binarios nativos — no empacar con Webpack
  serverExternalPackages: [
    'pdf-parse',
    'mammoth',
    'puppeteer-core',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    '@sparticuz/chromium',
  ],

  // Ignorar warnings de build sobre módulos opcionales de puppeteer
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Evitar que webpack intente empacar binarios nativos
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        'canvas',
        'bufferutil',
        'utf-8-validate',
      ];
    }
    return config;
  },
};

export default nextConfig;
