import { queryPg } from '../../db/postgres.js';
import type { ProductoValido, RemitoListItem, VistaTransaccionItem } from './types.js';

interface RemitoDespachoRow {
  remito_n: string;
  cliente_n: string;
  remito_id: string;
  cliente_id: string;
  tipo: string;
  consignacion: boolean;
}

interface RemitoDevolucionRow {
  remito_n: string;
  cliente_n: string;
  remito_id: string;
  cliente_id: string;
  tipo: string;
}

interface AvanceRow {
  remito_id: string;
  cantidad_escaneada: string | number;
  cantidad_pedida: string | number;
}

/**
 * Avance de todos los remitos en una sola query -- no una por remito -- indexado por remito_id.
 *
 * La granularidad es el REMITO COMPLETO, no el tipo. Seria mas fino mostrarlo por tipo (un remito
 * mixto son dos pedazos que se despachan por separado), pero no se puede con las vistas que hay:
 * el TIPO vive en vp_itemremito, que no expone producto_id, y V_ITEMEGRESOINVENTARIO tiene el
 * producto pero no el tipo. Sin una columna que los cruce no hay forma de repartir el avance.
 *
 * Por eso el numero se muestra UNA vez por remito, en la cabecera del grupo, y no repetido en cada
 * fila de tipo: ahi diria lo mismo dos veces y se leeria como el avance de ese tipo, que no es.
 *
 * Va aparte del listado y no como JOIN porque ese SELECT ya agrupa por TIPO y meter el staging en
 * el mismo GROUP BY multiplicaria los conteos.
 *
 * El COUNT sale de un subselect correlacionado y no de un LEFT JOIN porque un remito con varios
 * items del mismo producto duplicaria las filas de staging al cruzarse.
 */
async function obtenerAvancePorRemito(esDespacho: boolean): Promise<Map<string, { escaneada: number; pedida: number }>> {
  const rows = await queryPg<AvanceRow>(
    `SELECT
       IRV.PLACEOWNER_ID AS REMITO_ID,
       COALESCE(SUM(CAST(IRV.CANTIDAD2_CANTIDAD AS INTEGER)), 0) AS CANTIDAD_PEDIDA,
       COALESCE((
         SELECT COUNT(*)
         FROM public.AUX_EXPEDICION EXP
         WHERE EXP.REMITO_ID = IRV.PLACEOWNER_ID
         AND   EXP.ES_DESPACHO = $1
       ), 0) AS CANTIDAD_ESCANEADA
     FROM public.V_ITEMEGRESOINVENTARIO IRV
     GROUP BY IRV.PLACEOWNER_ID`,
    [esDespacho],
  );

  const avance = new Map<string, { escaneada: number; pedida: number }>();
  for (const r of rows) {
    avance.set(r.remito_id, {
      escaneada: Number(r.cantidad_escaneada),
      pedida: Number(r.cantidad_pedida),
    });
  }
  return avance;
}

// Replica QueryRemitoDespacho.
export async function listarRemitosDespacho(
  remitoN: string,
): Promise<{ exactMatch: RemitoListItem | null; items: RemitoListItem[] }> {
  const rows = await queryPg<RemitoDespachoRow>(
    `SELECT REMITO_N, CLIENTE_N, REMITO_ID, CLIENTE_ID, TIPO, CONSIGNACION
     FROM public.vp_itemremito
     WHERE PERMITE_DESPACHO = true
     GROUP BY REMITO_N, CLIENTE_N, REMITO_ID, CLIENTE_ID, TIPO, CONSIGNACION
     ORDER BY REMITO_N`,
  );

  const avance = await obtenerAvancePorRemito(true);

  const items: RemitoListItem[] = rows.map((r) => ({
    remitoN: r.remito_n,
    clienteN: r.cliente_n,
    remitoId: r.remito_id,
    clienteId: r.cliente_id,
    tipo: r.tipo,
    consignacion: r.consignacion,
    cantidadEscaneada: avance.get(r.remito_id)?.escaneada ?? 0,
    cantidadPedida: avance.get(r.remito_id)?.pedida ?? 0,
  }));

  const exactMatch = items.find((i) => i.remitoN === remitoN) ?? null;
  return { exactMatch, items };
}

// Replica QueryRemitoDevolucion.
export async function listarRemitosDevolucion(
  remitoN: string,
): Promise<{ exactMatch: RemitoListItem | null; items: RemitoListItem[] }> {
  const rows = await queryPg<RemitoDevolucionRow>(
    `SELECT REMITO_N, CLIENTE_N, REMITO_ID, CLIENTE_ID, TIPO
     FROM public.vp_itemremito
     WHERE PERMITE_DESPACHO = false
     GROUP BY REMITO_N, CLIENTE_N, REMITO_ID, CLIENTE_ID, TIPO
     ORDER BY REMITO_N`,
  );

  const avance = await obtenerAvancePorRemito(false);

  const items: RemitoListItem[] = rows.map((r) => ({
    remitoN: r.remito_n,
    clienteN: r.cliente_n,
    remitoId: r.remito_id,
    clienteId: r.cliente_id,
    tipo: r.tipo,
    cantidadEscaneada: avance.get(r.remito_id)?.escaneada ?? 0,
    cantidadPedida: avance.get(r.remito_id)?.pedida ?? 0,
  }));

  const exactMatch = items.find((i) => i.remitoN === remitoN) ?? null;
  return { exactMatch, items };
}

interface VistaTransaccionRow {
  itemremito_id: string | null;
  producto_id: string | null;
  producto_n: string;
  cantidad: number;
  cantidad_original: number;
  cantidad_restante: number;
}

// Replica QueryVistaTransaccion (staging vs esperado por producto, incluye cantidad restante).
export async function obtenerVistaTransaccion(
  esDespacho: boolean,
  remitoId: string,
): Promise<VistaTransaccionItem[]> {
  const rows = await queryPg<VistaTransaccionRow>(
    `SELECT * FROM (
       SELECT
         Q.*,
         Q.CANTIDAD_ORIGINAL - Q.CANTIDAD AS CANTIDAD_RESTANTE
       FROM (
         SELECT
           IRV.ID AS ITEMREMITO_ID,
           IRV.REFERENCIATIPO_ID AS PRODUCTO_ID,
           EXP.PRODUCTO_N,
           COUNT(EXP.*) AS CANTIDAD,
           0 AS CANTIDAD_ORIGINAL
         FROM public.AUX_EXPEDICION EXP
         LEFT JOIN public.V_ITEMEGRESOINVENTARIO IRV ON (IRV.ID = EXP.ITEMREMITO_ID) AND (EXP.ES_DESPACHO = $1)
         WHERE EXP.REMITO_ID = $2
         AND   EXP.ITEMREMITO_ID IS NULL
         GROUP BY IRV.PLACEOWNER_ID, IRV.ID, IRV.REFERENCIATIPO_ID, EXP.PRODUCTO_N, IRV.CANTIDAD2_CANTIDAD

         UNION

         SELECT
           IRV.ID AS ITEMREMITO_ID,
           IRV.REFERENCIATIPO_ID AS PRODUCTO_ID,
           -- DESCRIPCIONAPP es una descripcion corta cargada a mano en el ERP y esta vacia ('' , no
           -- NULL) para la enorme mayoria de los productos (al 2026-09: 3484 de 3550), entre ellos
           -- los importados y Peabody, que aparecian sin descripcion en el listado. Se cae a
           -- V_PRODUCTO.DESCRIPCION, que siempre tiene dato aunque sea mas larga (incluye medidas y
           -- codigo interno).
           COALESCE(NULLIF(EAPRD.DESCRIPCIONAPP, ''), PRD.DESCRIPCION) AS PRODUCTO_N,
           COUNT(EXP.*) AS CANTIDAD,
           CAST(IRV.CANTIDAD2_CANTIDAD AS INTEGER) AS CANTIDAD_ORIGINAL
         FROM public.V_ITEMEGRESOINVENTARIO IRV
         INNER JOIN public.V_PRODUCTO PRD      ON IRV.REFERENCIATIPO_ID = PRD.ID
         INNER JOIN public.V_UD_PRODUCTO EAPRD ON PRD.BOEXTENSION_ID = EAPRD.ID
         LEFT JOIN public.AUX_EXPEDICION EXP   ON (IRV.ID = EXP.ITEMREMITO_ID) AND (EXP.ES_DESPACHO = $1)
         WHERE IRV.PLACEOWNER_ID = $2
         GROUP BY IRV.PLACEOWNER_ID, IRV.ID, IRV.REFERENCIATIPO_ID,
                  COALESCE(NULLIF(EAPRD.DESCRIPCIONAPP, ''), PRD.DESCRIPCION), IRV.CANTIDAD2_CANTIDAD
       ) Q
     ) Q1
     ORDER BY CASE WHEN Q1.ITEMREMITO_ID IS NULL THEN 0 ELSE 1 END DESC, Q1.PRODUCTO_N, Q1.CANTIDAD_RESTANTE DESC`,
    [esDespacho, remitoId],
  );

  return rows.map((r) => ({
    itemRemitoId: r.itemremito_id,
    productoId: r.producto_id,
    productoN: r.producto_n,
    cantidad: Number(r.cantidad),
    cantidadOriginal: Number(r.cantidad_original),
    cantidadRestante: Number(r.cantidad_restante),
  }));
}

interface ProductoRemitoRow {
  itemremito_id: string;
  producto_id: string;
}

// Replica QueryProductosRemito.
export async function obtenerProductosRemito(remitoId: string): Promise<ProductoValido[]> {
  const rows = await queryPg<ProductoRemitoRow>(
    `SELECT IRV.ID AS ITEMREMITO_ID, IRV.REFERENCIATIPO_ID AS PRODUCTO_ID
     FROM public.V_ITEMEGRESOINVENTARIO IRV
     WHERE IRV.PLACEOWNER_ID = $1`,
    [remitoId],
  );
  return rows.map((r) => ({ itemRemitoId: r.itemremito_id, productoId: r.producto_id }));
}

export function calcularTotalEscaneado(items: VistaTransaccionItem[]): number {
  return items.reduce((total, item) => total + item.cantidad, 0);
}

/**
 * Listado de remitos de un circuito nuevo (IMPORT / PEABODY), filtrado por TIPO.
 *
 * Usa ve_items_remito_despacho y no vp_itemremito: son las vistas propias de expedicion,
 * que traen los remitos de estos productos. listarRemitosDespacho/listarRemitosDevolucion
 * siguen leyendo vp_itemremito, igual que el Delphi, y no se ven afectadas.
 */
export async function listarRemitosPorTipo(
  tipo: string,
  remitoN: string,
): Promise<{ exactMatch: RemitoListItem | null; items: RemitoListItem[] }> {
  const rows = await queryPg<RemitoDespachoRow>(
    `SELECT REMITO_N, CLIENTE_N, REMITO_ID, CLIENTE_ID, TIPO, CONSIGNACION
     FROM public.ve_items_remito_despacho
     WHERE PERMITE_DESPACHO = true
     AND   TIPO = $1
     GROUP BY REMITO_N, CLIENTE_N, REMITO_ID, CLIENTE_ID, TIPO, CONSIGNACION
     ORDER BY REMITO_N`,
    [tipo],
  );

  const avance = await obtenerAvancePorRemito(true);

  const items: RemitoListItem[] = rows.map((r) => ({
    remitoN: r.remito_n,
    clienteN: r.cliente_n,
    remitoId: r.remito_id,
    clienteId: r.cliente_id,
    tipo: r.tipo,
    consignacion: r.consignacion,
    cantidadEscaneada: avance.get(r.remito_id)?.escaneada ?? 0,
    cantidadPedida: avance.get(r.remito_id)?.pedida ?? 0,
  }));

  const exactMatch = items.find((i) => i.remitoN === remitoN) ?? null;
  return { exactMatch, items };
}
