import { queryPg } from '../../db/postgres.js';
import type { MasterLabelRow } from '../escaneo/types.js';

interface MasterLabelDbRow {
  etiqueta: string | number;
  tipo: string;
  producto_id: string;
  producto_n: string;
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
 * SOBRE LAS COLUMNAS (leido de pg_views contra produccion el 2026-09-16; el DDL no esta en
 * ningun repo). La suposicion de que esta vista tenia las mismas columnas que el maestro MSSQL
 * era incorrecta, y encadenaba tres fallas que se tapaban entre si:
 *
 *   1. NO existe ET.CONTROL_FINAL. La vista expone numero, producto_id, producto_c, producto_n,
 *      tipo, ingreso_stock y fecha_paso_lector, nada mas. Pedirla daba 42703 y el circuito
 *      IMPORT fallaba antes de comparar nada: nunca funciono, no es que dejo de andar.
 *      No se pierde ninguna validacion: el control final es un registro de la linea propia y
 *      estos productos no pasan por ella (validaControlFinal ya estaba en false para los dos
 *      circuitos, asi que el dato se traia y se descartaba). Cocina y termotanque SI lo validan,
 *      contra dbo.etiquetas_expedicion, y eso no cambia.
 *   2. El TIPO que emite es 'IMPORTADO', no 'IMPORT' (ver tipoMaestro en config.ts).
 *   3. `numero` NO es la serie: la vista la trunca a los ultimos 9 digitos
 *      (`right(numero::text, 9)::integer`) y la columna es int4. Las series reales son de 18
 *      digitos, asi que comparar contra `numero` daba 22003 (integer out of range).
 *
 * De ahi que se compare contra NUMERO_COMPLETO, una columna agregada al final de la vista que
 * conserva la serie entera como texto. `numero` queda intacto para el Delphi y todo lo que ya
 * lo lee.
 *
 * Por que la serie completa y no el sufijo de 9: truncar pierde unicidad. Las 10371 series
 * activas son unicas 1 a 1, pero colapsan en 9911 sufijos -- 460 cruces. Cuando dos de esos
 * cruces caen en productos distintos del MISMO remito (p.ej. una cocina electrica y un horno
 * empotrable), el filtro por remito no desambigua y se despacha el producto equivocado.
 */
export async function obtenerEtiquetasMaestroImportados(
  etiqueta: string,
  tipo: string,
): Promise<MasterLabelRow[]> {
  const rows = await queryPg<MasterLabelDbRow>(
    `SELECT
       ET.NUMERO_COMPLETO AS ETIQUETA,
       ET.TIPO,
       ET.PRODUCTO_ID,
       ET.PRODUCTO_N
     FROM vp_etiquetas_con_importados ET
     WHERE ET.NUMERO_COMPLETO = $1
     AND ET.TIPO = $2`,
    [etiqueta, tipo],
  );

  return rows.map((r) => ({
    etiqueta: String(r.etiqueta),
    tipo: r.tipo,
    productoId: r.producto_id,
    productoN: r.producto_n,
    // La vista no expone control final. null y no false: `false` dispararia NO_FINAL_CONTROL
    // si algun circuito futuro prendiera validaControlFinal, afirmando algo que no sabemos.
    controlFinal: null,
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
