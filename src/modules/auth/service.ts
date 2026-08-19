import { queryPg } from '../../db/postgres.js';

/**
 * Replica QueryEmpleado: SELECT * FROM VP_APLICACIONES_EMPLEADO
 * WHERE USUARIO = UPPER(:usuario) AND PASSWORD = :password (comparacion exacta, texto plano).
 * Valido si y solo si hay exactamente 1 fila (igual que UsuarioValido en UnitFunciones.pas).
 */
export async function validarCredenciales(usuario: string, password: string): Promise<boolean> {
  const rows = await queryPg(
    'SELECT * FROM VP_APLICACIONES_EMPLEADO WHERE USUARIO = UPPER($1) AND PASSWORD = $2',
    [usuario, password],
  );
  return rows.length === 1;
}
