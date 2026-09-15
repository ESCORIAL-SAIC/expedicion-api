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
 * CANTIDAD2_CANTIDAD es numeric sin tope: en produccion hay al menos una fila con un valor que no
 * entra en int4 y tumbaba el listado entero con "integer out of range" (22003). Las queries ya no
 * castean a INTEGER, asi que ese valor ahora llega hasta aca en vez de romper la query.
 *
 * El tope es INT32_MAX y no Number.MAX_SAFE_INTEGER: el cliente declara estos campos como Int de
 * Kotlin (ResponseDtos.kt), que es de 32 bits, asi que un valor mayor no sobrevive el viaje aunque
 * en JS sea un entero perfectamente valido. Es ademas el mismo rango que aceptaba el CAST que
 * estaba antes, asi que ningun dato sano cambia de valor.
 *
 * Fuera de ese rango no es una cantidad: se reporta como 0, que en el cliente significa "sin avance
 * conocido" y no cuenta como completo. Preferimos perder el indicador de UN remito antes que
 * devolver 500 para TODOS.
 */
const INT32_MAX = 2147483647;

function cantidadSegura(valor: string | number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 && n <= INT32_MAX ? n : 0;
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
       -- ROUND y no CAST(... AS INTEGER): el cast redondea igual pero desborda si el valor no
       -- entra en int4, y una sola fila basura en cualquier remito historico tumbaba el listado
       -- completo (esta query no filtra por remito: agrega toda la vista). ROUND devuelve numeric,
       -- que no puede desbordar; el valor absurdo se neutraliza despues en cantidadSegura().
       COALESCE(SUM(ROUND(IRV.CANTIDAD2_CANTIDAD)), 0) AS CANTIDAD_PEDIDA,
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
      escaneada: cantidadSegura(r.cantidad_escaneada),
      pedida: cantidadSegura(r.cantidad_pedida),
    });
  }
  return avance;
}

/**
 * Listado de remitos a despachar, de los CUATRO tipos.
 *
 * Lee ve_items_remito_despacho y no vp_itemremito (que es la que usa el Delphi) por dos razones:
 *
 *   1. vp_itemremito solo puede devolver COCINA o TERMOTANQUE -- su TIPO sale de un CASE sobre
 *      rv.numerador_id, la cabecera del remito -- asi que los remitos de importados y Peabody no
 *      aparecerian en ningun lado y sus circuitos quedarian inalcanzables.
 *   2. Aca el TIPO sale del producto (coc.tipoproducfiscal), asi que un remito puede tener items
 *      de tipos distintos y el par (remito, tipo) identifica un pedazo real y filtrable.
 *
 * Consecuencia de (2): un remito mixto devuelve una fila por tipo, y cada una lleva SOLO a sus
 * items (ver obtenerVistaTransaccion con tipo). En vp_itemremito eso no aplica: el remito entero
 * es de un tipo.
 *
 * Nota: esta vista trae consignacion fija en false, a diferencia de vp_itemremito. El campo hoy
 * es informativo -- la regla consignacion/venta no esta implementada ni aca ni en el Delphi.
 */
export async function listarRemitosDespacho(
  remitoN: string,
): Promise<{ exactMatch: RemitoListItem | null; items: RemitoListItem[] }> {
  const rows = await queryPg<RemitoDespachoRow>(
    `SELECT REMITO_N, CLIENTE_N, REMITO_ID, CLIENTE_ID, TIPO, CONSIGNACION
     FROM public.ve_items_remito_despacho
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
  // numeric, no int: pg los entrega como string. El Number() de abajo ya los normalizaba.
  cantidad_original: string | number;
  cantidad_restante: string | number;
}

/**
 * Replica QueryVistaTransaccion (staging vs esperado por producto, incluye cantidad restante).
 *
 * Con `tipo` filtra los items a los productos de ese tipo, segun ve_items_remito_despacho. Sin
 * `tipo` devuelve el remito completo, que es el comportamiento historico y el que corresponde a
 * los remitos de vp_itemremito, donde el tipo es del remito entero y filtrar no tendria sentido.
 *
 * El filtro deja pasar las filas huerfanas (ITEMREMITO_ID NULL): son escaneos que no se pudieron
 * imputar a ningun item, no tienen tipo, y esconderlas seria peor -- son las que bloquean el
 * confirmar y hay que poder verlas.
 */
export async function obtenerVistaTransaccion(
  esDespacho: boolean,
  remitoId: string,
  tipo?: string,
): Promise<VistaTransaccionItem[]> {
  const filtroTipo = tipo
    ? `WHERE Q1.ITEMREMITO_ID IS NULL OR Q1.PRODUCTO_ID IN (
         SELECT PRODUCTO_ID FROM public.ve_items_remito_despacho
         WHERE REMITO_ID = $2 AND TIPO = $3
       )`
    : '';

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
           -- Mismo motivo que en obtenerAvancePorRemito: CAST(... AS INTEGER) desborda con los
           -- valores fuera de rango que hay en la vista. ROUND redondea igual (al mas cercano) y
           -- devuelve numeric, asi que CANTIDAD_ORIGINAL vale lo mismo que antes para todo dato
           -- sano. Ojo: no se puede sacar el redondeo y devolver el numeric crudo -- un decimal
           -- haria que cantidad !== cantidadOriginal nunca sea igual y NINGUN remito se podria
           -- confirmar (ver confirmarDespacho / confirmarCircuito).
           ROUND(IRV.CANTIDAD2_CANTIDAD) AS CANTIDAD_ORIGINAL
         FROM public.V_ITEMEGRESOINVENTARIO IRV
         INNER JOIN public.V_PRODUCTO PRD      ON IRV.REFERENCIATIPO_ID = PRD.ID
         INNER JOIN public.V_UD_PRODUCTO EAPRD ON PRD.BOEXTENSION_ID = EAPRD.ID
         LEFT JOIN public.AUX_EXPEDICION EXP   ON (IRV.ID = EXP.ITEMREMITO_ID) AND (EXP.ES_DESPACHO = $1)
         WHERE IRV.PLACEOWNER_ID = $2
         GROUP BY IRV.PLACEOWNER_ID, IRV.ID, IRV.REFERENCIATIPO_ID,
                  COALESCE(NULLIF(EAPRD.DESCRIPCIONAPP, ''), PRD.DESCRIPCION), IRV.CANTIDAD2_CANTIDAD
       ) Q
     ) Q1
     ${filtroTipo}
     ORDER BY CASE WHEN Q1.ITEMREMITO_ID IS NULL THEN 0 ELSE 1 END DESC, Q1.PRODUCTO_N, Q1.CANTIDAD_RESTANTE DESC`,
    tipo ? [esDespacho, remitoId, tipo] : [esDespacho, remitoId],
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
