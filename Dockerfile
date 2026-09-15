# ---------------------------------------------------------------------
# 1) Compilación de la PWA
# ---------------------------------------------------------------------
FROM node:22-alpine AS web

WORKDIR /origen
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------------------------------------------------------------------
# 2) Imagen final: servidor + PWA ya compilada
# ---------------------------------------------------------------------
FROM node:22-alpine

# `pg_dump` para las copias de seguridad, y `tzdata` porque el cómputo de la
# jornada depende del huso: sin él, el contenedor cree que vive en UTC y las
# jornadas que cruzan la medianoche se imputan al día equivocado.
RUN apk add --no-cache postgresql16-client tzdata
ENV TZ=Europe/Madrid

WORKDIR /app

COPY servidor/package.json servidor/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY servidor/src ./src
COPY servidor/sql ./sql
COPY --from=web /origen/dist ./web

# No se ejecuta como root: si alguien logra salir de la aplicación, sale
# como un usuario sin privilegios.
USER node

ENV NODE_ENV=production
ENV RUTA_WEB=/app/web
EXPOSE 3000

# Comprobación de salud: el orquestador reinicia el contenedor si la
# aplicación deja de responder, lo que en un PC de oficina desatendido es la
# diferencia entre un corte de un minuto y uno de toda la mañana.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/sesion').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
