export interface RemitoListItem {
  remitoN: string;
  clienteN: string;
  remitoId: string;
  clienteId: string;
  tipo: string;
  consignacion?: boolean;
}

export interface VistaTransaccionItem {
  itemRemitoId: string | null;
  productoId: string | null;
  productoN: string;
  cantidad: number;
  cantidadOriginal: number;
  cantidadRestante: number;
}

export interface ProductoValido {
  itemRemitoId: string;
  productoId: string;
}
