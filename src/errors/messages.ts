/**
 * Mensajes exactos de la especificacion funcional (fuente de verdad: analista-requisitos).
 * Unico punto de edicion para auditar 1 a 1 contra la spec.
 *
 * Nota de fidelidad: el Delphi original tiene un typo ("Exiten items...") en QUANTITY_MISMATCH;
 * la spec ya trae el texto corregido ("Existen items...") y es el que se usa aqui (decision de
 * calidad ya validada, unico punto donde no se replica el texto legado byte a byte).
 */
export const Messages = {
  EMPTY_CODE: 'No se ha ingresado un código. Reintente nuevamente.',

  // Login (texto tomado de UnitIngreso.pas, unico punto donde la spec de alto nivel no
  // transcribe el mensaje completo, solo el nombre del codigo de error).
  INVALID_CREDENTIALS:
    'Datos de acceso incorrectos. Vuelva a intentarlo.',

  DB_UNAVAILABLE:
    'No se pudo establecer conexión con la Base de Datos. Cierre la aplicación, revise su configuración de red y vuelva a intentar abrir la aplicación.',

  LABEL_ALREADY_DISPATCHED:
    'Esta etiqueta ha sido despachada previamente y no puede ser despachada nuevamente.',

  LABEL_NOT_ENABLED_FOR_RETURN:
    'Esta etiqueta no se encuentra habilitada para devolución.',

  labelNotFoundDespacho: (etiqueta: string) =>
    `El código ${etiqueta} no existe en la base de datos de etiquetas. Si es correcto, informe a sistemas.`,

  labelInvalido: (etiqueta: string) =>
    `El código ${etiqueta} no es válido. Reintente nuevamente.`,

  noFinalControl: (etiqueta: string) => `El código ${etiqueta} NO TIENE CONTROL FINAL.`,

  productNotInRemito: (etiqueta: string) =>
    `El código ${etiqueta} no pertenece a un producto del remito.`,

  ITEM_QUOTA_REACHED: 'Se ha alcanzado el total del item a remitir.',

  scanError: (mensajeTecnico: string) =>
    `Se ha producido un error al momento de registrar lectura. Reintente nuevamente.  ${mensajeTecnico}`,

  QUANTITY_MISMATCH:
    'Existen items que difieren de la cantidad original a remitir. Proceso cancelado.',

  labelInfoNotFound: (etiqueta: string) =>
    `El código ${etiqueta} no existe en la base de datos.`,

  INTERNAL_ERROR: 'Ha ocurrido un error interno. Reintente nuevamente.',
} as const;
