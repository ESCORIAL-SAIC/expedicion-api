import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middlewares/auth.js';
import { credencialesSchema, eliminarEtiquetaSchema, escaneoSchema } from '../schemas/escaneo.js';
import { listarRemitosQuerySchema } from '../schemas/remitos.js';
import { listarRemitosPorTipo } from '../../modules/remitos/service.js';
import { CIRCUITOS } from '../../modules/circuitos/config.js';
import {
  borrarTransaccionCircuito,
  confirmarCircuito,
  eliminarEtiquetaCircuito,
  escanearCircuito,
} from '../../modules/circuitos/service.js';

type RemitoParams = { Params: { remitoId: string } };

/**
 * Rutas de los circuitos IMPORT / PEABODY. Espejan las de /despacho pero apuntan al maestro
 * de importados y saltean las validaciones que no aplican (ver modules/circuitos/config.ts).
 *
 * El slug va interpolado como literal en cada path, no como parametro: una ruta
 * /remitos/:slug seria un catch-all que capturaria cualquier /remitos/xxx desconocido y
 * convertiria un 404 claro en una respuesta del circuito nuevo.
 *
 * El TIPO sale siempre de la config del circuito y nunca del body, asi que un cliente no
 * puede escanear con un tipo que no corresponde a la ruta que llamo.
 */
export async function circuitosRoutes(app: FastifyInstance): Promise<void> {
  for (const circuito of CIRCUITOS) {
    const { slug } = circuito;

    app.get(`/remitos/${slug}`, { preHandler: requireAuth }, async (request) => {
      const { remitoN } = listarRemitosQuerySchema.parse(request.query ?? {});
      return listarRemitosPorTipo(circuito.tipo, remitoN);
    });

    app.post<RemitoParams>(
      `/${slug}/:remitoId/escaneo`,
      { preHandler: requireAuth },
      async (request, reply) => {
        const body = escaneoSchema.parse(request.body ?? {});
        const resultado = await escanearCircuito(circuito, request.params.remitoId, body);
        reply.status('duplicated' in resultado ? 200 : 201).send(resultado);
      },
    );

    app.delete<RemitoParams>(
      `/${slug}/:remitoId/etiqueta`,
      { preHandler: requireAuth },
      async (request) => {
        const body = eliminarEtiquetaSchema.parse(request.body ?? {});
        return eliminarEtiquetaCircuito(circuito, request.params.remitoId, body);
      },
    );

    // Irreversible y de alcance remito completo. La confirmacion es responsabilidad de la UI.
    app.delete<RemitoParams>(
      `/${slug}/:remitoId/transaccion`,
      { preHandler: requireAuth },
      async (request) => {
        credencialesSchema.parse(request.body ?? {});
        return borrarTransaccionCircuito(request.params.remitoId);
      },
    );

    app.post<RemitoParams>(
      `/${slug}/:remitoId/confirmar`,
      { preHandler: requireAuth },
      async (request) => {
        credencialesSchema.parse(request.body ?? {});
        return confirmarCircuito(request.params.remitoId);
      },
    );
  }
}
