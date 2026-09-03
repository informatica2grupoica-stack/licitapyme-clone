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
#
# FUENTES (3-sep-2026, BUG REAL medido sobre el "ANEXO Nº 01: IDENTIFICACIÓN DEL OFERENTE" ya
# generado): sin estas tres líneas el PDF NO sale con la misma letra que el .docx de la licitación.
# `--no-install-recommends` bota los paquetes de fuentes que LibreOffice trae como "recomendados",
# así que el contenedor quedaba SOLO con DejaVu. Los anexos piden Arial (cuerpo) y Calibri (los
# títulos que heredan del estilo Normal); LibreOffice no las encuentra y sustituye AMBAS por DejaVu
# Sans. Se comprobó leyendo las fuentes incrustadas del PDF generado: `BAAAAA+DejaVuSans-Bold` y
# `CAAAAA+DejaVuSans`, cuando el XML del .docx dice Arial/Calibri en cada run. DejaVu es más ancha
# que Arial, así que además de "otra letra" cambian los cortes de línea y el largo de los párrafos
# justificados — el anexo deja de ser idéntico al que entrega el organismo.
# Las tres son clones MÉTRICOS (mismo ancho por carácter que la original, no solo parecidas), que es
# lo que hace que la paginación calce exacta:
#   fonts-liberation2       → Liberation Sans/Serif/Mono = Arial / Times New Roman / Courier New
#   fonts-crosextra-carlito → Carlito = Calibri
#   fonts-crosextra-caladea → Caladea = Cambria
# LibreOffice las toma solo, por su tabla interna de sustitución métrica: no hay que configurar nada.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-draw \
    fonts-liberation2 \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    ca-certificates \
    tzdata \
  && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Santiago

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

EXPOSE 8091
CMD ["node", "server.mjs"]
