# conversor-doc/Dockerfile — microservicio interno del VPS: convierte .doc (Word 97-2003,
# binario OLE) a .docx (OOXML moderno) con LibreOffice headless. Contenedor aparte (no se
# instala LibreOffice en la imagen de "app") para no inflar esa imagen ni su tiempo de build —
# vive en la misma red interna de docker-compose, la app lo llama por su nombre de servicio.
FROM node:20-bookworm-slim

WORKDIR /app

# libreoffice-writer trae consigo el motor headless (soffice) suficiente para .doc→.docx.
# Es una imagen pesada (~400-600MB) pero corre UNA vez por conversión, bajo demanda, no en cada
# request de la app — no comparte contenedor con "app" para no inflar ese build ni su tiempo de
# arranque.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    ca-certificates \
    tzdata \
  && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Santiago

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

EXPOSE 8091
CMD ["node", "server.mjs"]
