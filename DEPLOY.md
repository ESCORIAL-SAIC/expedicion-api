# Deploy — Expedicion API

Versionado SemVer (git tags) + build Docker + publicación en GHCR, automatizado por
`.github/workflows/docker-publish.yml` y `.github/scripts/compute-version.sh` (raíz del repo).

Repo: `ESCORIAL-SAIC/expedicion-api` (extraído del monorepo original de la app Delphi/Android,
que sigue viviendo en `ESCORIAL-RS/Expedicion` sin este código).

## Setup único (hacerlo una sola vez)

1. Crear los labels de release en el repo (requiere `gh` autenticado con permisos sobre
   `ESCORIAL-SAIC/expedicion-api`):

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

- Push a `main` o `dev` → build + push a `ghcr.io/escorial-saic/expedicion-api`.
  - `main` → release final `vX.Y.Z` (tags `:X.Y.Z`, `:X.Y`, `:latest`, `:sha-XXXXXXX`).
  - `dev` → pre-release `vX.Y.Z-rc.N` (tags `:X.Y.Z-rc.N`, `:dev`, `:sha-XXXXXXX`).
- Tag manual `vX.Y.Z` pusheado a mano → build usando ese tag tal cual.
- `workflow_dispatch` manual también disponible.

## Deploy en un servidor nuevo

Requisitos: Docker con el plugin `compose`, y acceso de red a Postgres ESCORIAL (5432) y
SQL Server Etiquetas (1433). No hace falta Node ni clonar el repo entero: alcanzan
`docker-compose.yml` y el `.env`.

**1. Configuración.**

```bash
cp .env.example .env
```

Completar hosts y credenciales de las dos bases, y **fijar `IMAGE_TAG`**. Sin esa variable el
compose usa `:latest`, que es el último release de `main` — no lo último mergeado. Conviene la
versión exacta (`IMAGE_TAG=0.2.0-rc.2`) para saber qué está corriendo y para que un
`docker compose up` de otra persona no cambie de versión sin aviso.

**2. Levantar.**

```bash
docker compose up -d
docker compose ps          # debe decir (healthy)
```

**3. Verificar.**

```bash
curl http://localhost:3000/version        # versión desplegada
curl http://localhost:3000/health/ready   # 200 si las dos bases responden, 503 con detalle
```

`/health/live` (el del healthcheck) no toca la base: sirve para saber si el proceso está vivo,
no si puede trabajar. Para eso está `/health/ready`.

**4. Actualizar.**

```bash
# editar IMAGE_TAG en .env
docker compose pull && docker compose up -d
```

### TLS y exposición a la red

Por defecto el compose publica **solo en `127.0.0.1:3000`**, a propósito: la API no tiene
sesión ni token — cada request lleva usuario y password, y se revalidan contra la base. Sin TLS
cualquiera en la red ve las credenciales de los operarios en texto plano. Tampoco hay rate
limiting, así que el login es bruteforce-able.

Para exponerla a los handheld, levantar el proxy incluido:

```bash
mkdir -p certs                            # poner fullchain.pem y privkey.pem
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
```

Eso pone nginx en 443 con redirección desde 80 y rate limiting (20 r/s por IP, ráfagas de 40),
y la API deja de publicar puerto al host. Con certificado de CA interna o autofirmado hay que
instalarlo en los dispositivos, o Android rechaza la conexión.

Si el server está en una red cerrada y se acepta el riesgo, se puede saltear el proxy cambiando
el puerto del compose a `'3000:3000'`.

### Notas

`docker-compose.yml` nunca copia el `.env` dentro de la imagen: lo pasa por `env_file` en
tiempo de ejecución.

Los logs rotan a 10 MB × 5 archivos. Sin eso crecen sin límite (cada request deja una línea) y
terminan llenando el disco.

> `docker compose config` imprime en texto plano las variables resueltas desde `env_file`,
> incluidas las credenciales reales. Evitar correrlo en terminales compartidas o con logging
> habilitado.

### Configurar la app

En el handheld: **Configuración del servidor** → URL del server. La app verifica la conexión
contra `/health/ready` antes de guardarla, y sólo persiste si responde.

```
https://<host>/          con proxy
http://<host>:3000/      sin proxy (red cerrada)
```
