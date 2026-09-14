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
      const { esDespacho, tipo } = detalleRemitoQuerySchema.parse(request.query ?? {});

      // Con tipo, los items se limitan a los productos de ese tipo dentro del remito: es lo que
      // hace que entrar por COCINA no muestre los termotanques del mismo remito. Sin tipo, el
      // remito completo (comportamiento historico).
      const [items, productosValidos] = await Promise.all([
        obtenerVistaTransaccion(esDespacho, remitoId, tipo || undefined),
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
