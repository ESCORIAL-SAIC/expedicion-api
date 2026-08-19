import { randomUUID } from 'node:crypto';
import { queryPg } from '../../db/postgres.js';
import { queryMssql } from '../../db/mssql.js';
import type { MasterLabelRow } from './types.js';

interface UltimoEstadoRow {
  etiqueta: string;
  es_despacho: boolean;
  remito_n: string;
  fechahora: string;
}

// Replica QueryUltimoEstadoEtiqueta: DISTINCT ON (etiqueta), global (sin filtrar remito), mas reciente por fecha.
export async function obtenerUltimoEstadoEtiqueta(etiqueta: string): Promise<boolean> {
  const rows = await queryPg<UltimoEstadoRow>(
    `SELECT DISTINCT ON (etiqueta)
       etiqueta, es_despacho, remito_n, fechahora
     FROM aux_expedicion
     WHERE etiqueta = $1
     ORDER BY etiqueta DESC, fechahora DESC`,
    [etiqueta],
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
  CONTROL_FINAL: boolean | null;
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
    controlFinal: r.CONTROL_FINAL,
  }));
}

// Replica QueryExisteEtiqueta: etiqueta ya presente en staging para ese remito.
export async function existeEtiquetaEnStaging(remitoId: string, etiqueta: string): Promise<boolean> {
  const rows = await queryPg(
    `SELECT EXP.ETIQUETA
     FROM public.AUX_EXPEDICION EXP
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
}

// Replica CommandInsert (id generado con crypto.randomUUID en vez del roundtrip QueryNuevoID).
export async function insertarEnStaging(params: InsertParams): Promise<void> {
  await queryPg(
    `INSERT INTO public.aux_expedicion(
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
export async function borrarEtiquetaMasReciente(remitoId: string, etiqueta: string): Promise<void> {
  await queryPg(
    `DELETE FROM AUX_EXPEDICION
     WHERE ID IN (
       SELECT ID
       FROM AUX_EXPEDICION
       WHERE ETIQUETA = $1
       AND REMITO_ID = $2
       ORDER BY FECHAHORA DESC
       LIMIT 1
     )`,
    [etiqueta, remitoId],
  );
}

// Replica CommandBorrarTransaccion: borra todo el staging de ese remito+tipo con migrado=false.
export async function borrarTransaccionStaging(remitoId: string, esDespacho: boolean): Promise<void> {
  await queryPg(
    `DELETE FROM AUX_EXPEDICION
     WHERE ES_DESPACHO = $1
     AND REMITO_ID = $2
     AND MIGRADO = false`,
    [esDespacho, remitoId],
  );
}
