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

  const items: RemitoListItem[] = rows.map((r) => ({
    remitoN: r.remito_n,
    clienteN: r.cliente_n,
    remitoId: r.remito_id,
    clienteId: r.cliente_id,
    tipo: r.tipo,
    consignacion: r.consignacion,
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

  const items: RemitoListItem[] = rows.map((r) => ({
    remitoN: r.remito_n,
    clienteN: r.cliente_n,
    remitoId: r.remito_id,
    clienteId: r.cliente_id,
    tipo: r.tipo,
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
           EAPRD.DESCRIPCIONAPP AS PRODUCTO_N,
           COUNT(EXP.*) AS CANTIDAD,
           CAST(IRV.CANTIDAD2_CANTIDAD AS INTEGER) AS CANTIDAD_ORIGINAL
         FROM public.V_ITEMEGRESOINVENTARIO IRV
         INNER JOIN public.V_PRODUCTO PRD      ON IRV.REFERENCIATIPO_ID = PRD.ID
         INNER JOIN public.V_UD_PRODUCTO EAPRD ON PRD.BOEXTENSION_ID = EAPRD.ID
         LEFT JOIN public.AUX_EXPEDICION EXP   ON (IRV.ID = EXP.ITEMREMITO_ID) AND (EXP.ES_DESPACHO = $1)
         WHERE IRV.PLACEOWNER_ID = $2
         GROUP BY IRV.PLACEOWNER_ID, IRV.ID, IRV.REFERENCIATIPO_ID, EAPRD.DESCRIPCIONAPP, IRV.CANTIDAD2_CANTIDAD
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
