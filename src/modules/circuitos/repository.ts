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
