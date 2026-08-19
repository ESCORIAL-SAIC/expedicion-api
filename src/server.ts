import { buildApp } from './app.js';
import { config } from './config/index.js';
import { checkPgHealth, isPgConfigured } from './db/postgres.js';
import { checkMssqlHealth, isMssqlConfigured } from './db/mssql.js';

async function runHealthchecks(app: ReturnType<typeof buildApp>): Promise<void> {
  if (!isPgConfigured()) {
    app.log.error('Postgres (ESCORIAL) sin configurar: revise PG_HOST/PG_PORT/PG_DATABASE/PG_USER/PG_PASSWORD en .env');
  } else {
    const ok = await checkPgHealth();
    if (ok) app.log.info('Postgres (ESCORIAL): conexion OK');
    else app.log.error('Postgres (ESCORIAL): SELECT 1 fallo, endpoints dependientes devolveran 503 DB_UNAVAILABLE');
  }

  if (!isMssqlConfigured()) {
    app.log.error('SQL Server Etiquetas (Suipacha) sin configurar: revise MSSQL_HOST/MSSQL_PORT/MSSQL_DATABASE/MSSQL_USER/MSSQL_PASSWORD en .env');
  } else {
    const ok = await checkMssqlHealth();
    if (ok) app.log.info('SQL Server Etiquetas (Suipacha): conexion OK');
    else app.log.error('SQL Server Etiquetas (Suipacha): SELECT 1 fallo, endpoints dependientes devolveran 503 DB_UNAVAILABLE');
  }
}

async function main(): Promise<void> {
  const app = buildApp();

  // El healthcheck nunca bloquea el arranque del HTTP: si falta config o la DB esta caida,
  // se loguea y el servidor sigue arriba; los endpoints dependientes fallan con 503 recien
  // cuando se los invoca.
  await runHealthchecks(app);

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
