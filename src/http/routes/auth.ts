import type { FastifyInstance } from 'fastify';
import { loginSchema } from '../schemas/auth.js';
import { validarCredenciales } from '../../modules/auth/service.js';
import { BusinessError } from '../../errors/BusinessError.js';
import { Messages } from '../../errors/messages.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request, reply) => {
    const { usuario, password } = loginSchema.parse(request.body ?? {});
    const valido = await validarCredenciales(usuario, password);
    if (!valido) {
      throw new BusinessError(401, 'INVALID_CREDENTIALS', Messages.INVALID_CREDENTIALS);
    }
    reply.status(200).send({ valid: true });
  });
}
