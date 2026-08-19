import { z } from 'zod';

export const escaneoSchema = z.object({
  usuario: z.string().catch(''),
  password: z.string().catch(''),
  etiqueta: z.string().catch(''),
  tipo: z.string().catch(''),
  remitoN: z.string().catch(''),
});
export type EscaneoBody = z.infer<typeof escaneoSchema>;

export const eliminarEtiquetaSchema = z.object({
  usuario: z.string().catch(''),
  password: z.string().catch(''),
  etiqueta: z.string().catch(''),
  tipo: z.string().catch(''),
});
export type EliminarEtiquetaBody = z.infer<typeof eliminarEtiquetaSchema>;

export const credencialesSchema = z.object({
  usuario: z.string().catch(''),
  password: z.string().catch(''),
});
export type CredencialesBody = z.infer<typeof credencialesSchema>;
