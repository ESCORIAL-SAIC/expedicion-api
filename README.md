# Expedicion API

API Node.js/TypeScript que reemplaza la logica de datos embebida en la app Delphi/FireMonkey
"Expedicion" (despacho y devolucion de mercaderia por escaneo de etiquetas). Mantiene las
2 bases de datos actuales: PostgreSQL "ESCORIAL" y SQL Server "Etiquetas" (Suipacha).

## Requisitos

- Node.js 20.x o superior.
- Acceso de red a Postgres ESCORIAL (10.90.98.7:5432) y SQL Server Etiquetas Suipacha
  (192.168.10.103:1433), o una base de test equivalente.

## Instalar

```bash
cd api
npm install
```

## Configurar

Copiar `.env.example` a `.env` y completar credenciales reales:

```bash
cp .env.example .env
```

Variables: `PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD, MSSQL_HOST, MSSQL_PORT,
MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD, PORT, LOG_LEVEL`.

Si `.env` no existe o falta alguna variable, el servidor HTTP levanta igual: el healthcheck de
arranque loguea el problema y los endpoints que dependen de esa base devuelven
`503 DB_UNAVAILABLE` hasta que se complete la configuracion.

## Correr

```bash
npm run dev     # desarrollo, con recarga (tsx watch)
npm run build   # compila TypeScript a dist/
npm start       # corre dist/server.js (requiere build previo)
```

El servidor expone `GET /health` (alias de `GET /health/live`, chequeo basico de vida del
proceso, no valida las bases), `GET /health/ready` (200 si Postgres y SQL Server responden,
503 con detalle si alguno falla) y `GET /version` (version embebida via `APP_VERSION`,
`"dev"` fuera de un build con `--build-arg VERSION`). Ver `DEPLOY.md` para containerizacion,
versionado y publicacion en GHCR.

## Tests

```bash
npm test
```

Los tests de integracion (`test/integration/`) usan `vitest` + `supertest` y mockean por completo
los modulos `src/db/postgres.ts` y `src/db/mssql.ts`, por lo que corren sin necesidad de bases
reales ni de `.env`. Cubren, por cada endpoint, los mensajes de error de la especificacion
funcional (login invalido/sin conexion, los 9 pasos de escaneo de despacho y devolucion,
duplicado silencioso, eliminar etiqueta invalida, borrar transaccion, confirmar con y sin
diferencias, estado con tipo vacio/etiqueta vacia/no encontrado/disponible/no disponible).

## Estructura

```
src/
  config/            carga y validacion de variables de entorno
  db/postgres.ts       pool pg (ESCORIAL)
  db/mssql.ts           pool mssql (Etiquetas Suipacha)
  modules/auth           validarCredenciales (VP_APLICACIONES_EMPLEADO)
  modules/remitos         listado + detalle de remitos
  modules/escaneo          alta/baja de etiqueta, borrar transaccion, confirmar
  modules/estado            consulta de estado de etiqueta
  http/routes|middlewares|schemas
  errors/                    BusinessError, mensajes centralizados
  app.ts / server.ts
test/integration/
```

## Notas de fidelidad funcional

- Los mensajes de error son textuales, tal como los especifico el analista de requisitos
  (`src/errors/messages.ts` es el archivo unico de auditoria).
- Unico texto que difiere del Delphi original: `QUANTITY_MISMATCH` corrige el typo legado
  ("Exiten" -> "Existen"), decision de calidad ya validada.
- `DELETE /despacho|devolucion/:remitoId/etiqueta` replica el comportamiento funcional del bug
  del Delphi original (no valida que la etiqueta pertenezca al remito/es_despacho actual antes
  de borrar), no el nombre del parametro.
- `POST /devolucion/:remitoId/confirmar` no valida cantidades, igual que el codigo Delphi
  original (bloque de validacion deshabilitado).
