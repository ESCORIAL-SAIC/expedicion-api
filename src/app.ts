import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config/index.js';
import { errorHandler } from './http/middlewares/errorHandler.js';
import { authRoutes } from './http/routes/auth.js';
import { remitosRoutes } from './http/routes/remitos.js';
import { escaneoRoutes } from './http/routes/escaneo.js';
import { estadoRoutes } from './http/routes/estado.js';
import { checkPgHealth } from './db/postgres.js';
import { checkMssqlHealth } from './db/mssql.js';

async function healthLive() {
  return { status: 'ok' };
}

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: config.logLevel },
  });

  app.setErrorHandler(errorHandler);

  app.get('/health', healthLive);
  app.get('/health/live', healthLive);

  app.get('/health/ready', async (_request, reply) => {
    const [pg, mssql] = await Promise.all([checkPgHealth(), checkMssqlHealth()]);
    const status = pg && mssql ? 'ok' : 'error';
    const body = {
      status,
      checks: {
        postgres: pg ? 'ok' : 'error',
        mssql: mssql ? 'ok' : 'error',
      },
    };
    reply.status(status === 'ok' ? 200 : 503).send(body);
  });

  app.get('/version', async () => ({ version: process.env.APP_VERSION ?? 'dev' }));

  app.register(authRoutes);
  app.register(remitosRoutes);
  app.register(escaneoRoutes);
  app.register(estadoRoutes);

  return app;
}
