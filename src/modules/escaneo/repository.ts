import { randomUUID } from 'node:crypto';
import { queryPg } from '../../db/postgres.js';
import { queryMssql } from '../../db/mssql.js';
import type { MasterLabelRow } from './types.js';

/**
 * Tabla de staging sobre la que opera cada circuito.
 *
 * Hay dos porque `aux_expedicion.etiqueta` es integer y no se puede ampliar: tiene siete vistas
 * dependientes, una de ellas `vp_etiquetas`, base del circuito COCINA/TERMOTANQUE que hoy
 * funciona. El detalle esta en migrations/001-staging-circuitos.sql.
 *
 *   'aux_expedicion'            COCINA / TERMOTANQUE. etiqueta integer, 10 digitos.
 *                               La que lee el Delphi y las siete vistas.
 *   'aux_expedicion_circuitos'  IMPORT / PEABODY. etiqueta bigint: EAN de 13, DUN de 14,
 *                               series de 18.
 *
 * Es un tipo cerrado y no un string libre porque el valor se interpola en el SQL -- el nombre de
 * una tabla no puede ir como parametro. Nunca debe construirse a partir del body de un request.
 */
export type TablaStaging = 'aux_expedicion' | 'aux_expedicion_circuitos';

const TABLA_CLASICA: TablaStaging = 'aux_expedicion';

interface UltimoEstadoRow {
  etiqueta: string;
  es_despacho: boolean;
  remito_n: string;
  fechahora: string;
}

// Replica QueryUltimoEstadoEtiqueta: DISTINCT ON (etiqueta), global (sin filtrar remito), mas reciente por fecha.
/**
 * Ultimo estado de la etiqueta: true si su ultimo movimiento fue un despacho.
 *
 * Con `remitoId` mira solo los movimientos de ESE remito, que es lo que hace falta en devolucion:
 * una etiqueta solo puede devolverse por el remito que la despacho. Sin el filtro, una etiqueta
 * despachada en el remito A se podria devolver por el B --y peor, el DELETE que viene despues
 * tampoco distingue remitos-- asi que se borrarian registros de otro remito.
 *
 * Sin `remitoId` conserva el comportamiento historico (mira el ultimo movimiento global), que es
 * lo que corresponde al despacho: ahi la pregunta es "esta etiqueta ya salio por algun lado".
 */
export async function obtenerUltimoEstadoEtiqueta(
  etiqueta: string,
  remitoId?: string,
  tabla: TablaStaging = TABLA_CLASICA,
): Promise<boolean> {
  const rows = await queryPg<UltimoEstadoRow>(
    `SELECT DISTINCT ON (etiqueta)
       etiqueta, es_despacho, remito_n, fechahora
     FROM ${tabla}
     WHERE etiqueta = $1
     ${remitoId ? 'AND remito_id = $2' : ''}
     ORDER BY etiqueta DESC, fechahora DESC`,
    remitoId ? [etiqueta, remitoId] : [etiqueta],
  );
  // Sin historial previo: nunca fue despachada (equivalente al comportamiento observado
  // en UnitFunciones.pas cuando el dataset no tiene filas).
  return rows.length > 0 ? Boolean(rows[0].es_despacho) : false;
}

interface MasterLabelDbRow {
  ETIQUETA: string | number;
  TIPO: string;
  PRODUCTO_ID: string;
  PRODUCTO_N: string;
  // int en la base (verificado en sys.columns, 2026-09-22), no bit: el driver lo entrega como
  // number, nunca como boolean. Ver normalizarControlFinal.
  CONTROL_FINAL: number | boolean | null;
}

/**
 * Pasa CONTROL_FINAL a boolean.
 *
 * La columna es `int` en SQL Server, asi que el driver mssql devuelve 0, 1 o null -- NUNCA un
 * boolean. El chequeo del service era `controlFinal === false`, que con un 0 da false: la
 * validacion NO_FINAL_CONTROL no disparaba nunca y una cocina sin control final se despachaba
 * igual. No se veia en los tests porque el dataset local declaraba la columna como `bit`, y ahi
 * el driver si devuelve boolean.
 *
 * NULL se normaliza a false, o sea que RECHAZA. Es un desvio deliberado del Delphi, donde el
 * `=== false` estricto lo dejaba pasar: la regla es que cocina y termotanque deben tener control
 * final para despacharse, y "sin dato" no es "lo tiene". Los circuitos IMPORT y PEABODY no
 * validan esto en absoluto (validaControlFinal en config.ts) porque esos productos no pasan por
 * la linea propia.
 */
function normalizarControlFinal(valor: number | boolean | null): boolean {
  if (typeof valor === 'boolean') return valor;
  return valor === 1;
}

// Replica QueryEtiqueta (SQL Server, maestro de etiquetas de Suipacha).
export async function obtenerEtiquetasMaestro(etiqueta: string, tipo: string): Promise<MasterLabelRow[]> {
  const rows = await queryMssql<MasterLabelDbRow>(
    `SELECT
       ET.NUMERO AS ETIQUETA,
       ET.TIPO,
       ET.PRODUCTO_ID,
       ET.PRODUCTO_N,
       Ingreso_stock, Fecha_Paso_lector, CONTROL_FINAL
     FROM dbo.etiquetas_expedicion ET
     WHERE ET.NUMERO = @etiqueta
     AND ET.TIPO = @tipo`,
    { etiqueta, tipo },
  );

  return rows.map((r) => ({
    etiqueta: String(r.ETIQUETA),
    tipo: r.TIPO,
    productoId: r.PRODUCTO_ID,
    productoN: r.PRODUCTO_N,
    controlFinal: normalizarControlFinal(r.CONTROL_FINAL),
  }));
}

// Replica QueryExisteEtiqueta: etiqueta ya presente en staging para ese remito.
export async function existeEtiquetaEnStaging(
  remitoId: string,
  etiqueta: string,
  tabla: TablaStaging = TABLA_CLASICA,
): Promise<boolean> {
  const rows = await queryPg(
    `SELECT EXP.ETIQUETA
     FROM public.${tabla} EXP
     WHERE EXP.REMITO_ID = $1
     AND   EXP.ETIQUETA = $2`,
    [remitoId, etiqueta],
  );
  return rows.length > 0;
}

interface InsertParams {
  esDespacho: boolean;
  remitoN: string;
  etiqueta: string;
  productoN: string;
  remitoId: string;
  itemRemitoId: string | null;
  productoId: string;
  /** Sin especificar, la tabla clasica (COCINA / TERMOTANQUE). */
  tabla?: TablaStaging;
}

// Replica CommandInsert (id generado con crypto.randomUUID en vez del roundtrip QueryNuevoID).
export async function insertarEnStaging(params: InsertParams): Promise<void> {
  await queryPg(
    `INSERT INTO public.${params.tabla ?? TABLA_CLASICA}(
       es_despacho, id, remito_n, etiqueta, producto_n, remito_id, itemremito_id, producto_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      params.esDespacho,
      randomUUID(),
      params.remitoN,
      params.etiqueta,
      params.productoN,
      params.remitoId,
      params.itemRemitoId,
      params.productoId,
    ],
  );
}

// Replica CommandBorrarItem: borra el registro MAS RECIENTE de staging que matchea etiqueta+remito,
// sin filtrar por es_despacho (replica el comportamiento funcional del bug de nombre de parametro
// del Delphi original: el chequeo de pertenencia a es_despacho/remito actual esta deshabilitado).
export async function borrarEtiquetaMasReciente(
  remitoId: string,
  etiqueta: string,
  tabla: TablaStaging = TABLA_CLASICA,
): Promise<void> {
  await queryPg(
    `DELETE FROM ${tabla}
     WHERE ID IN (
       SELECT ID
       FROM ${tabla}
       WHERE ETIQUETA = $1
       AND REMITO_ID = $2
       ORDER BY FECHAHORA DESC
       LIMIT 1
     )`,
    [etiqueta, remitoId],
  );
}

/**
 * Replica CommandBorrarTransaccion: borra todo el staging de ese remito con migrado = false.
 *
 * Borra de LAS DOS tablas, y no de la del circuito que llamo. El alcance de esta operacion
 * siempre fue el remito completo --decision ya tomada y documentada en borrarTransaccionCircuito
 * (circuitos/service.ts)-- y un remito mixto COCINA+IMPORT tiene filas en las dos. Borrar solo
 * una dejaria el remito a medias, que es justo lo que el operario no espera cuando pide
 * "borrar transaccion".
 *
 * No hace falta transaccion explicita: los dos DELETE son independientes y si el segundo fallara,
 * el estado resultante (una tabla limpia y la otra no) es el mismo que ya produce hoy un error a
 * mitad de camino. Reintentar es seguro, el DELETE es idempotente.
 */
export async function borrarTransaccionStaging(remitoId: string, esDespacho: boolean): Promise<void> {
  const sql = (tabla: TablaStaging) =>
    `DELETE FROM ${tabla}
     WHERE ES_DESPACHO = $1
     AND REMITO_ID = $2
     AND MIGRADO = false`;

  await queryPg(sql('aux_expedicion'), [esDespacho, remitoId]);
  await queryPg(sql('aux_expedicion_circuitos'), [esDespacho, remitoId]);
}
