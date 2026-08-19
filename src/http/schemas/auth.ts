import { z } from 'zod';

export const loginSchema = z.object({
  usuario: z.string().catch(''),
  password: z.string().catch(''),
});

export type LoginBody = z.infer<typeof loginSchema>;
