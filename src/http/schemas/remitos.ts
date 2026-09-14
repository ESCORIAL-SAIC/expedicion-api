import { z } from 'zod';

export const listarRemitosQuerySchema = z.object({
  remitoN: z.string().catch(''),
});
export type ListarRemitosQuery = z.infer<typeof listarRemitosQuerySchema>;

export const detalleRemitoQuerySchema = z.object({
  esDespacho: z
    .string()
    .catch('false')
    .transform((v) => v === 'true' || v === '1'),
  // Opcional: filtra los items a los productos de ese tipo. Sin tipo, el remito completo.
  tipo: z.string().catch('').optional(),
});
export type DetalleRemitoQuery = z.infer<typeof detalleRemitoQuerySchema>;

export const detalleRemitoParamsSchema = z.object({
  remitoId: z.string(),
});
