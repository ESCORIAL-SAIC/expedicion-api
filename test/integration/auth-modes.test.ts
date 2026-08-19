import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { makePgDispatcher, Markers } from './testUtils.js';

// Verifica que requireAuth soporte body y header Authorization: Basic de forma consistente
// (documentado en resolveCredentials, src/http/middlewares/auth.ts), y que ninguno de los dos
// modos se salte la revalidacion por request.

const { queryPgMock, queryMssqlMock } = vi.hoisted(() => ({
  queryPgMock: vi.fn(),
  queryMssqlMock: vi.fn(),
}));

vi.mock('../../src/db/postgres.js', () => ({
  queryPg: queryPgMock,
  isPgConfigured: () => true,
  checkPgHealth: vi.fn(),
  getPgPool: vi.fn(),
}));

vi.mock('../../src/db/mssql.js', () => ({
  queryMssql: queryMssqlMock,
  isMssqlConfigured: () => true,
  checkMssqlHealth: vi.fn(),
}));

const { buildApp } = await import('../../src/app.js');

function basicAuthHeader(usuario: string, password: string): string {
  return 'Basic ' + Buffer.from(`${usuario}:${password}`).toString('base64');
}

// Mock "real": solo valida si usuario===JPEREZ (uppercased) y password==='1234', para poder
// probar credenciales invalidas/vacias con significado real (no solo "presencia de fila").
function authRuleRealista() {
  return {
    match: Markers.auth,
    handler: (params: unknown[]) => {
      const [usuario, password] = params as [string, string];
      // La query real aplica UPPER(usuario) en el motor; se replica aqui para no acoplar
      // el mock a que el cliente ya mande el usuario en mayusculas.
      return usuario.toUpperCase() === 'JPEREZ' && password === '1234'
        ? [{ usuario: 'JPEREZ', password: '1234' }]
        : [];
    },
  };
}

describe('Auth por request: body vs header Authorization Basic', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    queryPgMock.mockReset();
    queryMssqlMock.mockReset();
    queryPgMock.mockImplementation(
      makePgDispatcher([authRuleRealista(), { match: Markers.borrarTransaccion, handler: () => [] }]),
    );
  });

  it('body con credenciales validas autentica (endpoint POST/DELETE con cuerpo)', async () => {
    const res = await request(app.server)
      .delete('/despacho/remito-1/transaccion')
      .send({ usuario: 'jperez', password: '1234' });

    expect(res.status).toBe(200);
  });

  it('header Authorization Basic con credenciales validas autentica igual que el body', async () => {
    const res = await request(app.server)
      .delete('/despacho/remito-1/transaccion')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .send({});

    expect(res.status).toBe(200);
  });

  it('body con credenciales invalidas -> 401, aunque el mensaje sea idéntico al de header invalido', async () => {
    const res = await request(app.server)
      .delete('/despacho/remito-1/transaccion')
      .send({ usuario: 'jperez', password: 'mala' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('Datos de acceso incorrectos. Vuelva a intentarlo.');
  });

  it('header Authorization Basic con credenciales invalidas -> 401 (mismo comportamiento que body)', async () => {
    const res = await request(app.server)
      .delete('/despacho/remito-1/transaccion')
      .set('Authorization', basicAuthHeader('jperez', 'mala'))
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('credenciales vacias en el body -> 401 (nunca se toma como "no validar")', async () => {
    const res = await request(app.server).delete('/despacho/remito-1/transaccion').send({ usuario: '', password: '' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('credenciales vacias via header Basic (":") -> 401', async () => {
    const res = await request(app.server)
      .delete('/despacho/remito-1/transaccion')
      .set('Authorization', basicAuthHeader('', ''))
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('sin body y sin header -> 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app.server).delete('/despacho/remito-1/transaccion').send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('header malformado (no empieza con "Basic ") se ignora y cae a credenciales vacias -> 401', async () => {
    const res = await request(app.server)
      .delete('/despacho/remito-1/transaccion')
      .set('Authorization', 'Bearer algun-token')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('el body tiene prioridad sobre el header cuando ambos estan presentes', async () => {
    // Body con credenciales INVALIDAS + header con credenciales VALIDAS: segun
    // resolveCredentials, el body gana siempre que usuario/password sean ambos string.
    // Se espera que la peticion falle (se usan las credenciales del body).
    const res = await request(app.server)
      .delete('/despacho/remito-1/transaccion')
      .set('Authorization', basicAuthHeader('jperez', '1234'))
      .send({ usuario: 'jperez', password: 'mala' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
