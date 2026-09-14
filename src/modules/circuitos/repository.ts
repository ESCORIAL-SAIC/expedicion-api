import { queryPg } from '../../db/postgres.js';
import type { MasterLabelRow } from '../escaneo/types.js';

interface MasterLabelDbRow {
  etiqueta: string | number;
  tipo: string;
  producto_id: string;
  producto_n: string;
  control_final: boolean | null;
}

/**
 * Maestro de etiquetas de los circuitos nuevos. Replica QueryEtiqueta_remoto
 * (UnitModuloDatos.dfm:477-502), que quedo declarado en el Delphi y nunca se cableo.
 *
 * A diferencia de obtenerEtiquetasMaestro (escaneo/repository.ts), que lee
 * dbo.etiquetas_expedicion en SQL Server, esta vista vive en el Postgres ESCORIAL: el
 * FDConnection_WAN del Delphi apunta a la misma base que FDConnection, solo cambia el host
 * (IP publica vs interna), y la API corre del lado servidor. Por eso usa queryPg y no hace
 * falta ninguna conexion nueva.
 *
 * La lista de columnas es identica a la del maestro MSSQL (verificado dfm:480-488 vs
 * :367-375), asi que mapea al mismo MasterLabelRow.
 */
export async function obtenerEtiquetasMaestroImportados(
  etiqueta: string,
  tipo: string,
): Promise<MasterLabelRow[]> {
  const rows = await queryPg<MasterLabelDbRow>(
    `SELECT
       ET.NUMERO AS ETIQUETA,
       ET.TIPO,
       ET.PRODUCTO_ID,
       ET.PRODUCTO_N,
       ET.CONTROL_FINAL
     FROM vp_etiquetas_con_importados ET
     WHERE ET.NUMERO = $1
     AND ET.TIPO = $2`,
    [etiqueta, tipo],
  );

  return rows.map((r) => ({
    etiqueta: String(r.etiqueta),
    tipo: r.tipo,
    productoId: r.producto_id,
    productoN: r.producto_n,
    controlFinal: r.control_final,
  }));
}

interface ProductoPorCodigoRow {
  producto_id: string;
  producto_n: string;
  es_dun: boolean;
  unidades: string | number;
}

/**
 * Resuelve el producto a partir de un EAN o un DUN, para los circuitos que no tienen maestro de
 * etiquetas (Peabody).
 *
 * Estos productos no llevan numero de serie: en V_UD_PRODUCTO tienen un CODIGOGS1 (EAN de la
 * unidad) y un CODIGO_DUN (el de la caja master), y los dos son iguales para todas las unidades
 * del mismo producto. Asi que el codigo escaneado identifica al PRODUCTO, no a la caja, y una
 * misma lectura puede repetirse tantas veces como unidades se despachen.
 *
 * Se aceptan los dos codigos indistintamente porque el operario puede pickear la caja entera o
 * unidades sueltas: si el remito pide 12 y la caja trae 10, se escanea el DUN y despues 2 EAN.
 * El DUN es un GTIN-14 que contiene al EAN, pero no se compara por subcadena: se matchea contra
 * la columna que corresponda, que es exacto y no depende del formato.
 *
 * De ahi que interese COMO matcheo: un DUN vale UNIDADESPORBULTO unidades y un EAN vale 1. Ese
 * dato esta en public.PRODUCTO, no en la vista V_PRODUCTO.
 *
 * Devuelve MasterLabelRow para que el service trate a los dos maestros igual. controlFinal va en
 * null: no aplica (estos productos no pasan por la linea propia) y ademas ningun circuito nuevo
 * lo valida.
 */
export async function obtenerProductoPorCodigo(
  codigo: string,
  tipo: string,
): Promise<MasterLabelRow[]> {
  const rows = await queryPg<ProductoPorCodigoRow>(
    `SELECT
       PRD.ID          AS PRODUCTO_ID,
       PRD.DESCRIPCION AS PRODUCTO_N,
       (UDP.CODIGO_DUN = $1) AS ES_DUN,
       CASE
         WHEN UDP.CODIGO_DUN = $1 THEN GREATEST(COALESCE(P.UNIDADESPORBULTO, 1), 1)
         ELSE 1
       END AS UNIDADES
     FROM public.V_PRODUCTO PRD
     INNER JOIN public.V_UD_PRODUCTO UDP ON PRD.BOEXTENSION_ID = UDP.ID
     LEFT  JOIN public.PRODUCTO P        ON P.ID = PRD.ID
     WHERE (NULLIF(UDP.CODIGOGS1, '') = $1 OR NULLIF(UDP.CODIGO_DUN, '') = $1)`,
    [codigo],
  );

  return rows.map((r) => ({
    etiqueta: codigo,
    tipo,
    productoId: r.producto_id,
    productoN: r.producto_n,
    controlFinal: null,
    esDun: r.es_dun,
    // GREATEST(.., 1) en el SQL evita que un unidadesporbulto en 0 o NULL cargue cero unidades.
    unidades: Math.max(Number(r.unidades) || 1, 1),
  }));
}
