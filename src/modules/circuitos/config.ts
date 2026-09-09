/**
 * Circuitos de despacho de productos que no se fabrican en la linea de Escorial.
 *
 * Se modelan aparte de despacho/devolucion porque el maestro de etiquetas es otro
 * (vp_etiquetas_con_importados, en Postgres) y porque las reglas de unicidad de etiqueta no
 * son las mismas: PEABODY no maneja numeros de serie, tiene EANs que se repiten entre
 * unidades del mismo producto. Los flags viven en datos y no como `if`s en el service para
 * que ajustar un circuito sea cambiar una linea de esta tabla.
 */
export interface CircuitoConfig {
  /** Segmento literal de la ruta HTTP (/importado/..., /peabody/...). */
  slug: string;
  /** Valor de TIPO en la base. Sale de aca y nunca del body del request. */
  tipo: string;
  /**
   * Paso 2: consulta el ultimo estado global de la etiqueta y rechaza si ya fue despachada.
   * Solo tiene sentido cuando la etiqueta identifica una unidad fisica unica.
   */
  validaYaDespachada: boolean;
  /**
   * Paso 4: rechaza (en silencio, 200) si la etiqueta ya esta en el staging del remito.
   * Con codigos repetidos entre unidades esta validacion bloquea la segunda unidad, asi que
   * queda apagada en PEABODY.
   */
  validaDuplicado: boolean;
  /**
   * Paso 5: exige CONTROL_FINAL en el maestro. Apagado en ambos circuitos: el control final
   * es un registro de la linea de produccion propia, y estos productos no pasan por ella.
   */
  validaControlFinal: boolean;
}

/**
 * Importados. Conserva las validaciones de unicidad porque todavia no se confirmo si sus
 * etiquetas son unicas por unidad; es la opcion conservadora (si se repiten, el sintoma es
 * un alta que no ocurre, no un dato mal cargado). Para cambiarlo alcanza con poner
 * validaYaDespachada y validaDuplicado en false.
 */
export const CIRCUITO_IMPORTADO: CircuitoConfig = {
  slug: 'importado',
  tipo: 'IMPORT',
  validaYaDespachada: true,
  validaDuplicado: true,
  validaControlFinal: false,
};

/**
 * Peabody. Sin numeros de serie: el mismo EAN llega en todas las unidades del producto, por
 * lo que los pasos 2 y 4 quedan apagados y el unico tope de cantidad es el cupo del item
 * contra CANTIDAD_ORIGINAL (paso 7).
 */
export const CIRCUITO_PEABODY: CircuitoConfig = {
  slug: 'peabody',
  tipo: 'PEABODY',
  validaYaDespachada: false,
  validaDuplicado: false,
  validaControlFinal: false,
};

export const CIRCUITOS: readonly CircuitoConfig[] = [CIRCUITO_IMPORTADO, CIRCUITO_PEABODY];
