import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middlewares/auth.js';
import {
  detalleRemitoQuerySchema,
  listarRemitosQuerySchema,
} from '../schemas/remitos.js';
import {
  listarRemitosDespacho,
  listarRemitosDevolucion,
  obtenerProductosRemito,
  obtenerVistaTransaccion,
  calcularTotalEscaneado,
} from '../../modules/remitos/service.js';

export async function remitosRoutes(app: FastifyInstance): Promise<void> {
  app.get('/remitos/despacho', { preHandler: requireAuth }, async (request) => {
    const { remitoN } = listarRemitosQuerySchema.parse(request.query ?? {});
    return listarRemitosDespacho(remitoN);
  });

  app.get('/remitos/devolucion', { preHandler: requireAuth }, async (request) => {
    const { remitoN } = listarRemitosQuerySchema.parse(request.query ?? {});
    return listarRemitosDevolucion(remitoN);
  });

  app.get<{ Params: { remitoId: string } }>(
    '/remitos/:remitoId/detalle',
    { preHandler: requireAuth },
    async (request) => {
      const { remitoId } = request.params;
      const { esDespacho } = detalleRemitoQuerySchema.parse(request.query ?? {});

      const [items, productosValidos] = await Promise.all([
        obtenerVistaTransaccion(esDespacho, remitoId),
        esDespacho ? obtenerProductosRemito(remitoId) : Promise.resolve(undefined),
      ]);

      return {
        items,
        totalEscaneado: calcularTotalEscaneado(items),
        ...(esDespacho ? { productosValidos } : {}),
      };
    },
  );
}
