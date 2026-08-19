import { queryPg } from '../../db/postgres.js';
import { BusinessError } from '../../errors/BusinessError.js';
import { Messages } from '../../errors/messages.js';

export interface EstadoInput {
  tipo: string;
  etiqueta: string;
}

export type EstadoResult =
  | { aborted: true }
  | { available: true; productoN: string }
  | { available: false; clienteN: string; productoN: string; remitoN: string; fechaHora: string };

interface EtiquetaInfoRow {
  producto_n: string;
  expedicion_id: string | null;
  es_despacho: boolean | null;
  cliente_n: string | null;
  remito_n: string | null;
  fechahora: string | null;
}

// Replica QueryEtiquetaInfo (staging mas item remito, el mas reciente).
async function obtenerEtiquetaInfo(tipo: string, etiqueta: string): Promise<EtiquetaInfoRow[]> {
  return queryPg<EtiquetaInfoRow>(
    `SELECT
       ET.NUMERO AS ETIQUETA,
       ET.PRODUCTO_ID,
       ET.PRODUCTO_N,
       EXP.ID AS EXPEDICION_ID,
       IRV.NUMERODOCUMENTO AS REMITO_N,
       IRV.PLACEOWNER_ID AS REMITO_ID,
       IRV.ID AS ITEMREMITO_ID,
       EXP.ES_DESPACHO,
       EXP.ID,
       EXP.FECHAHORA,
       IRV.NOMBREDESTINATARIOTR AS CLIENTE_N
     FROM public.VP_ETIQUETAS ET
     LEFT JOIN public.AUX_EXPEDICION EXP
       ON (ET.NUMERO = EXP.ETIQUETA)
       AND (ET.TIPO = CASE WHEN LEFT(EXP.PRODUCTO_N, 6) = 'COCINA' THEN 'COCINA' ELSE 'TERMOTANQUE' END)
     LEFT JOIN public.V_ITEMEGRESOINVENTARIO IRV ON (IRV.ID = EXP.ITEMREMITO_ID)
     WHERE ET.NUMERO = $1
     AND ET.TIPO = $2
     ORDER BY EXP.FECHAHORA DESC
     LIMIT 1`,
    [etiqueta, tipo],
  );
}

// Replica ButtonInfoClick/EditCocinaKeyUp de UnitInfo.pas.
export async function consultarEstadoEtiqueta(input: EstadoInput): Promise<EstadoResult> {
  // tipo vacio o no provisto: abort silencioso (equivalente a ComboBoxTipo.ItemIndex < 0 -> Abort).
  if (!input.tipo) {
    return { aborted: true };
  }

  if (!input.etiqueta) {
    throw new BusinessError(400, 'EMPTY_CODE', Messages.EMPTY_CODE);
  }

  const rows = await obtenerEtiquetaInfo(input.tipo, input.etiqueta);
  if (rows.length === 0) {
    throw new BusinessError(404, 'LABEL_NOT_FOUND', Messages.labelInfoNotFound(input.etiqueta));
  }

  const row = rows[0];
  const nuncaDespachada = !row.expedicion_id || row.es_despacho === false;
  if (nuncaDespachada) {
    return { available: true, productoN: row.producto_n };
  }

  return {
    available: false,
    clienteN: row.cliente_n ?? '',
    productoN: row.producto_n,
    remitoN: row.remito_n ?? '',
    fechaHora: row.fechahora ?? '',
  };
}
