import { z } from 'zod';

export const estadoSchema = z.object({
  usuario: z.string().catch(''),
  password: z.string().catch(''),
  tipo: z.string().catch(''),
  etiqueta: z.string().catch(''),
});
export type EstadoBody = z.infer<typeof estadoSchema>;
