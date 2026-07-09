# scheduler/Dockerfile — contenedor liviano que corre el scheduler del notebook.
FROM node:20-alpine

WORKDIR /app

# TZ Chile (los cron se interpretan en esta zona; coincide con la app).
RUN apk add --no-cache tzdata
ENV TZ=America/Santiago

COPY package.json ./
RUN npm install --omit=dev

COPY scheduler.mjs ./

CMD ["node", "scheduler.mjs"]
