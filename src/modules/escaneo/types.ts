export interface MasterLabelRow {
  etiqueta: string;
  tipo: string;
  productoId: string;
  productoN: string;
  controlFinal: boolean | null;
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
