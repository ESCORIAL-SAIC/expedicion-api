export interface RemitoListItem {
  remitoN: string;
  clienteN: string;
  remitoId: string;
  clienteId: string;
  tipo: string;
  consignacion?: boolean;
  /**
   * Avance del remito: unidades ya escaneadas en staging y unidades que pide el remito, para
   * poder marcar los completos en el listado.
   *
   * La vista de remitos no sabe nada del avance -- solo filtra por PERMITE_DESPACHO, que lo
   * maneja el ERP y no baja al completarse -- asi que estos dos numeros se calculan aparte
   * cruzando V_ITEMEGRESOINVENTARIO con AUX_EXPEDICION.
   */
  cantidadEscaneada: number;
  cantidadPedida: number;
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
