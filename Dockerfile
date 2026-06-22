# Base Debian (no Alpine): trae glibc y permite instalar Chromium del sistema,
# que es lo que necesita puppeteer-core para la descarga automática de adjuntos.
FROM node:20-bookworm-slim AS base

WORKDIR /app

# Chromium + fuentes para que el navegador headless renderice y descargue bien.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/*

# puppeteer-core NO descarga su propio Chromium: usamos el del sistema.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Dependencias (capa cacheable)
COPY package.json package-lock.json* ./
RUN npm ci

# Variables NEXT_PUBLIC_* — se incrustan en el bundle EN BUILD (no en runtime).
# docker-compose las pasa como build args desde el .env.
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_AUTOMATIZACION_PAUSADA
ARG NEXT_PUBLIC_CRON_SECRET
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_AUTOMATIZACION_PAUSADA=$NEXT_PUBLIC_AUTOMATIZACION_PAUSADA \
    NEXT_PUBLIC_CRON_SECRET=$NEXT_PUBLIC_CRON_SECRET

# Código y build
COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
