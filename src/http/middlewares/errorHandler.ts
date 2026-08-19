import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { BusinessError } from '../../errors/BusinessError.js';
import { Messages } from '../../errors/messages.js';

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof BusinessError) {
    request.log.warn({ code: error.code, err: error.message }, 'business error');
    reply.status(error.statusCode).send(error.toResponseBody());
    return;
  }

  if (error instanceof ZodError) {
    reply
      .status(400)
      .send({ error: { code: 'INVALID_REQUEST', message: 'La solicitud tiene datos invalidos o incompletos.' } });
    return;
  }

  // Excepcion no controlada: nunca stack trace crudo al cliente, solo log server-side.
  request.log.error({ err: error }, 'unhandled error');
  reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: Messages.INTERNAL_ERROR } });
}
