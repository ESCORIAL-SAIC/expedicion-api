import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middlewares/auth.js';
import { credencialesSchema, eliminarEtiquetaSchema, escaneoSchema } from '../schemas/escaneo.js';
import {
  borrarTransaccion,
  confirmarDespacho,
  confirmarDevolucion,
  eliminarEtiqueta,
  escanear,
} from '../../modules/escaneo/service.js';

type RemitoParams = { Params: { remitoId: string } };

export async function escaneoRoutes(app: FastifyInstance): Promise<void> {
  // Escaneo (alta de etiqueta).
  app.post<RemitoParams>(
    '/despacho/:remitoId/escaneo',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = escaneoSchema.parse(request.body ?? {});
      const resultado = await escanear(true, request.params.remitoId, body);
      reply.status('duplicated' in resultado ? 200 : 201).send(resultado);
    },
  );

  app.post<RemitoParams>(
    '/devolucion/:remitoId/escaneo',
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = escaneoSchema.parse(request.body ?? {});
      const resultado = await escanear(false, request.params.remitoId, body);
      reply.status('duplicated' in resultado ? 200 : 201).send(resultado);
    },
  );

  // Eliminar etiqueta.
  app.delete<RemitoParams>(
    '/despacho/:remitoId/etiqueta',
    { preHandler: requireAuth },
    async (request) => {
      const body = eliminarEtiquetaSchema.parse(request.body ?? {});
      return eliminarEtiqueta(true, request.params.remitoId, body);
    },
  );

  app.delete<RemitoParams>(
    '/devolucion/:remitoId/etiqueta',
    { preHandler: requireAuth },
    async (request) => {
      const body = eliminarEtiquetaSchema.parse(request.body ?? {});
      return eliminarEtiqueta(false, request.params.remitoId, body);
    },
  );

  // Borrar transaccion completa del remito (irreversible, la confirmacion es responsabilidad
  // de la UI Android; el API no reconfirma).
  app.delete<RemitoParams>(
    '/despacho/:remitoId/transaccion',
    { preHandler: requireAuth },
    async (request) => {
      credencialesSchema.parse(request.body ?? {});
      return borrarTransaccion(true, request.params.remitoId);
    },
  );

  app.delete<RemitoParams>(
    '/devolucion/:remitoId/transaccion',
    { preHandler: requireAuth },
    async (request) => {
      credencialesSchema.parse(request.body ?? {});
      return borrarTransaccion(false, request.params.remitoId);
    },
  );

  // Confirmar.
  app.post<RemitoParams>(
    '/despacho/:remitoId/confirmar',
    { preHandler: requireAuth },
    async (request) => {
      credencialesSchema.parse(request.body ?? {});
      return confirmarDespacho(request.params.remitoId);
    },
  );

  app.post<RemitoParams>(
    '/devolucion/:remitoId/confirmar',
    { preHandler: requireAuth },
    async (request) => {
      credencialesSchema.parse(request.body ?? {});
      return confirmarDevolucion(request.params.remitoId);
    },
  );
}
