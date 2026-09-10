export type PgRule = { match: (sql: string) => boolean; handler: (params: unknown[]) => unknown[] };
export type MssqlRule = { match: (sql: string) => boolean; handler: (params: Record<string, unknown>) => unknown[] };

export function makePgDispatcher(rules: PgRule[]) {
  return async (sql: string, params: unknown[] = []) => {
    for (const rule of rules) {
      if (rule.match(sql)) return rule.handler(params);
    }
    throw new Error('Unmocked pg query: ' + sql.slice(0, 120));
  };
}

export function makeMssqlDispatcher(rules: MssqlRule[]) {
  return async (sql: string, params: Record<string, unknown> = {}) => {
    for (const rule of rules) {
      if (rule.match(sql)) return rule.handler(params);
    }
    throw new Error('Unmocked mssql query: ' + sql.slice(0, 120));
  };
}

// Marcadores unicos de cada query (ver src/modules/**/repository.ts y service.ts).
export const Markers = {
  auth: (sql: string) => sql.includes('VP_APLICACIONES_EMPLEADO'),
  remitosDespachoList: (sql: string) => sql.includes('PERMITE_DESPACHO = true'),
  remitosDevolucionList: (sql: string) => sql.includes('PERMITE_DESPACHO = false'),
  vistaTransaccion: (sql: string) => sql.includes('CANTIDAD_RESTANTE'),
  productosRemito: (sql: string) =>
    sql.includes('REFERENCIATIPO_ID AS PRODUCTO_ID') && !sql.includes('CANTIDAD_RESTANTE'),
  ultimoEstadoEtiqueta: (sql: string) => sql.includes('DISTINCT ON (etiqueta)'),
  existeEtiqueta: (sql: string) => sql.includes('EXP.ETIQUETA = $2'),
  insertStaging: (sql: string) => sql.includes('INSERT INTO public.aux_expedicion'),
  borrarItem: (sql: string) => sql.includes('WHERE ID IN ('),
  borrarTransaccion: (sql: string) => sql.includes('MIGRADO = false'),
  estadoInfo: (sql: string) => sql.includes('VP_ETIQUETAS ET'),
  etiquetasMaestro: (sql: string) => sql.includes('dbo.etiquetas_expedicion'),

  // Circuitos IMPORT / PEABODY. Dos avisos para quien toque estos marcadores:
  //
  // 1) remitosCircuitoList va SIEMPRE antes que remitosDespachoList en la lista de reglas:
  //    la query del circuito tambien contiene 'PERMITE_DESPACHO = true' y makePgDispatcher
  //    devuelve la primera regla que matchea.
  // 2) etiquetasMaestroImportados corre en el dispatcher de Postgres (la vista vive en PG,
  //    no en SQL Server como dbo.etiquetas_expedicion). No colisiona con estadoInfo solo
  //    porque includes es case-sensitive: 'VP_ETIQUETAS ET' en mayusculas y con espacio no
  //    matchea 'vp_etiquetas_con_importados ET'. Pasar estos marcadores por toLowerCase()
  //    rompe el ruteo.
  remitosCircuitoList: (sql: string) => sql.includes('ve_items_remito_despacho'),
  etiquetasMaestroImportados: (sql: string) => sql.includes('vp_etiquetas_con_importados'),
};

export const EMPLEADO_VALIDO = { usuario: 'JPEREZ', password: '1234' };
