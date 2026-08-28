# conversor-doc/Dockerfile — microservicio interno del VPS: convierte .doc (Word 97-2003,
# binario OLE) o .pdf a .docx (OOXML moderno), y .docx a .pdf (29-ago-2026, paso previo a firmar
# con posición libre — ver /convertir-pdf en server.mjs), con LibreOffice headless. Contenedor
# aparte (no se instala LibreOffice en la imagen de "app") para no inflar esa imagen ni su tiempo
# de build — vive en la misma red interna de docker-compose, la app lo llama por su nombre de
# servicio. libreoffice-writer YA trae el exportador de PDF (es una función nativa de Writer, no
# un paquete aparte), así que /convertir-pdf no necesita nada nuevo acá.
FROM node:20-bookworm-slim

WORKDIR /app

# libreoffice-writer trae consigo el motor headless (soffice) suficiente para .doc→.docx.
# libreoffice-draw agrega el filtro de importación de PDF (14-ago-2026, soporte nuevo: extraer
# anexos de un PDF como .docx) — en la mayoría de los paquetes Debian, importar PDF vive en Draw,
# no en Writer, aunque el comando de conversión se siga pidiendo con --convert-to docx.
# Es una imagen pesada (~500-700MB) pero corre UNA vez por conversión, bajo demanda, no en cada
# request de la app — no comparte contenedor con "app" para no inflar ese build ni su tiempo de
# arranque.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-draw \
    ca-certificates \
    tzdata \
  && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Santiago

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

EXPOSE 8091
CMD ["node", "server.mjs"]
