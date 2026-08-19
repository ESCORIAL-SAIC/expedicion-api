import type { FastifyReply, FastifyRequest } from 'fastify';
import { validarCredenciales } from '../../modules/auth/service.js';
import { BusinessError } from '../../errors/BusinessError.js';
import { Messages } from '../../errors/messages.js';

interface Credentials {
  usuario: string;
  password: string;
}

/**
 * Resuelve credenciales desde el body (usuario/password, endpoints POST/DELETE con cuerpo)
 * o desde el header Authorization: Basic (endpoints GET sin cuerpo, ej. listado de remitos).
 */
function resolveCredentials(request: FastifyRequest): Credentials {
  const body = request.body as Record<string, unknown> | undefined;
  if (body && typeof body.usuario === 'string' && typeof body.password === 'string') {
    return { usuario: body.usuario, password: body.password };
  }

  const header = request.headers.authorization;
  if (header && header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex >= 0) {
      return {
        usuario: decoded.slice(0, separatorIndex),
        password: decoded.slice(separatorIndex + 1),
      };
    }
  }

  return { usuario: '', password: '' };
}

/**
 * Middleware unico de autenticacion por request, reusado en todos los endpoints de negocio
 * (salvo POST /auth/login que tiene su propio handler dedicado). Sin sesion/JWT: revalida
 * usuario+password contra VP_APLICACIONES_EMPLEADO en cada llamada (igual que hoy).
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const { usuario, password } = resolveCredentials(request);
  const valido = await validarCredenciales(usuario, password);
  if (!valido) {
    throw new BusinessError(401, 'INVALID_CREDENTIALS', Messages.INVALID_CREDENTIALS);
  }
}
