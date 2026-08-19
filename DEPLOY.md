# Deploy — Expedicion API

Versionado SemVer (git tags) + build Docker + publicación en GHCR, automatizado por
`.github/workflows/docker-publish.yml` y `.github/scripts/compute-version.sh` (raíz del repo).

## Setup único (hacerlo una sola vez)

1. Crear los labels de release en el repo (requiere `gh` autenticado con permisos sobre
   `ESCORIAL-RS/Expedicion`):

   ```bash
   gh label create release:minor -c 0e8a16 -d "Sube MINOR al mergear"
   gh label create release:major -c b60205 -d "Sube MAJOR al mergear"
   gh label create release:skip  -c cccccc -d "No versiona esta PR"
   ```

   Sin label en la PR, el bump por defecto es `patch`.

2. Sembrar el primer tag (a partir de ahí, todo automático por label de PR al mergear a
   `main`/`dev`). **No se ejecutó como parte de esta tarea** — queda a criterio de quien
   haga el primer release:

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. Settings → Actions → General → Workflow permissions → "Read and write permissions"
   (el workflow necesita `contents: write` para crear/pushear el tag de versión y
   `packages: write` para publicar en GHCR).

4. Hacer público el package `expedicion-api` en GHCR (Settings del package en GitHub) si
   el servidor de despliegue debe poder hacer `docker pull` sin autenticarse.

## Cómo se dispara el build

- Push a `main` o `dev` que toque `api/**` (o el workflow/script de versión) → build +
  push a `ghcr.io/escorial-rs/expedicion-api`.
  - `main` → release final `vX.Y.Z` (tags `:X.Y.Z`, `:X.Y`, `:latest`, `:sha-XXXXXXX`).
  - `dev` → pre-release `vX.Y.Z-rc.N` (tags `:X.Y.Z-rc.N`, `:dev`, `:sha-XXXXXXX`).
- Tag manual `vX.Y.Z` pusheado a mano → build usando ese tag tal cual.
- `workflow_dispatch` manual también disponible.

## Deploy en el servidor

```bash
cd api
cp .env.example .env   # completar credenciales reales de Postgres/SQL Server (no versionar)
IMAGE_TAG=1.2.3 docker compose up -d   # o sin IMAGE_TAG para :latest
```

`docker-compose.yml` nunca copia el `.env` dentro de la imagen: lo pasa por `env_file` en
tiempo de ejecución. El healthcheck del compose y del `Dockerfile` apuntan a
`GET /health/live` (liveness, no toca la DB). Para verificar que las bases responden,
consultar `GET /health/ready` (200 si Postgres y SQL Server responden, 503 con detalle si
alguno falla).

> Nota: `docker compose config` imprime en texto plano las variables resueltas desde
> `env_file`, incluidas las credenciales reales. Evitar correrlo en terminales
> compartidas o con logging habilitado.

## Verificar versión desplegada

```bash
curl http://<host>:3000/version
```
