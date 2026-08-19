import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middlewares/auth.js';
import { estadoSchema } from '../schemas/estado.js';
import { consultarEstadoEtiqueta } from '../../modules/estado/service.js';

export async function estadoRoutes(app: FastifyInstance): Promise<void> {
  // POST en vez de GET para no loguear password en URL.
  app.post('/etiquetas/estado', { preHandler: requireAuth }, async (request) => {
    const body = estadoSchema.parse(request.body ?? {});
    return consultarEstadoEtiqueta(body);
  });
}
