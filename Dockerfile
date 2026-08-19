# Etapa build: instala todas las deps (incl. dev) y compila TypeScript -> dist/
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Etapa runtime: sólo deps de produccion + dist compilado, sin toolchain de build.
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG VERSION=0.0.0-dev
ENV APP_VERSION=$VERSION
LABEL org.opencontainers.image.version=$VERSION

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
