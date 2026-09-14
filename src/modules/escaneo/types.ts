export interface MasterLabelRow {
  etiqueta: string;
  tipo: string;
  productoId: string;
  productoN: string;
  controlFinal: boolean | null;
  /**
   * Solo en circuitos sin numero de serie (Peabody): el codigo escaneado es el DUN de la caja
   * master y no el EAN de una unidad suelta. Ausente en los maestros de etiquetas, donde cada
   * codigo es siempre una unidad.
   */
  esDun?: boolean;
  /**
   * Unidades que representa el codigo escaneado: UNIDADESPORBULTO si es un DUN, 1 si es un EAN.
   * Ausente (equivale a 1) en los maestros de etiquetas.
   */
  unidades?: number;
}

export interface ScanSuccess {
  success: true;
  productoN: string;
  cantidadEscaneada: number;
  cantidadRestante: number;
  totalEscaneado: number;
}

export interface ScanDuplicated {
  duplicated: true;
}

export type ScanResult = ScanSuccess | ScanDuplicated;
