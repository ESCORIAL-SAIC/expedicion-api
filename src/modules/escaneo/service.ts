import { BusinessError } from '../../errors/BusinessError.js';
import { Messages } from '../../errors/messages.js';
import {
  obtenerProductosRemito,
  obtenerVistaTransaccion,
  calcularTotalEscaneado,
} from '../remitos/service.js';
import {
  borrarEtiquetaMasReciente,
  borrarTransaccionStaging,
  existeEtiquetaEnStaging,
  insertarEnStaging,
  obtenerEtiquetasMaestro,
  obtenerUltimoEstadoEtiqueta,
} from './repository.js';
import type { MasterLabelRow, ScanResult } from './types.js';

export interface EscanearInput {
  etiqueta: string;
  tipo: string;
  remitoN: string;
}

// Replica AgregarEtiqueta (UnitFunciones.pas), 9 pasos, orden exacto, corta en el primer error.
export async function escanear(esDespacho: boolean, remitoId: string, input: EscanearInput): Promise<ScanResult> {
  try {
    // Paso 1: codigo vacio.
    if (!input.etiqueta) {
      throw new BusinessError(400, 'EMPTY_CODE', Messages.EMPTY_CODE);
    }

    // Paso 2: ultimo estado global de la etiqueta.
    const despachadaPreviamente = await obtenerUltimoEstadoEtiqueta(input.etiqueta);
    if (esDespacho) {
      if (despachadaPreviamente === true) {
        throw new BusinessError(409, 'LABEL_ALREADY_DISPATCHED', Messages.LABEL_ALREADY_DISPATCHED);
      }
    } else {
      if (despachadaPreviamente === false) {
        throw new BusinessError(409, 'LABEL_NOT_ENABLED_FOR_RETURN', Messages.LABEL_NOT_ENABLED_FOR_RETURN);
      }
    }

    // Paso 3: existe en el maestro de etiquetas (SQL Server).
    const maestro = await obtenerEtiquetasMaestro(input.etiqueta, input.tipo);
    if (maestro.length === 0) {
      if (esDespacho) {
        throw new BusinessError(404, 'LABEL_NOT_FOUND', Messages.labelNotFoundDespacho(input.etiqueta));
      }
      throw new BusinessError(404, 'LABEL_INVALID', Messages.labelInvalido(input.etiqueta));
    }

    // Paso 4: duplicado en staging (abort silencioso, commit ab89cab).
    const duplicado = await existeEtiquetaEnStaging(remitoId, input.etiqueta);
    if (duplicado) {
      return { duplicated: true };
    }

    // Paso 5: CONTROL_FINAL (solo despacho), sobre el primer candidato del maestro.
    if (esDespacho && maestro[0].controlFinal === false) {
      throw new BusinessError(422, 'NO_FINAL_CONTROL', Messages.noFinalControl(input.etiqueta));
    }

    // Paso 6 y 7: producto pertenece al remito, con "next candidate" si hay mas de un
    // registro maestro con el mismo numero+tipo y el primero tiene cupo completo.
    const productosRemito = await obtenerProductosRemito(remitoId);
    const vistaTransaccion = await obtenerVistaTransaccion(esDespacho, remitoId);

    const candidatosEnRemito = maestro.filter((m) =>
      productosRemito.some((p) => p.productoId === m.productoId),
    );

    if (candidatosEnRemito.length === 0) {
      throw new BusinessError(422, 'PRODUCT_NOT_IN_REMITO', Messages.productNotInRemito(input.etiqueta));
    }

    let ganador: { candidato: MasterLabelRow; itemRemitoId: string } | null = null;
    for (const candidato of candidatosEnRemito) {
      const productoRemito = productosRemito.find((p) => p.productoId === candidato.productoId);
      if (!productoRemito) continue;
      const vistaItem = vistaTransaccion.find((v) => v.itemRemitoId === productoRemito.itemRemitoId);
      const cupoCompleto = vistaItem ? vistaItem.cantidad === vistaItem.cantidadOriginal : false;
      if (!cupoCompleto) {
        ganador = { candidato, itemRemitoId: productoRemito.itemRemitoId };
        break;
      }
    }

    if (!ganador) {
      throw new BusinessError(422, 'ITEM_QUOTA_REACHED', Messages.ITEM_QUOTA_REACHED);
    }

    // Paso 8: insert en staging.
    await insertarEnStaging({
      esDespacho,
      remitoN: input.remitoN,
      etiqueta: input.etiqueta,
      productoN: ganador.candidato.productoN,
      remitoId,
      itemRemitoId: ganador.itemRemitoId,
      productoId: ganador.candidato.productoId,
    });

    const vistaFinal = await obtenerVistaTransaccion(esDespacho, remitoId);
    const itemFinal = vistaFinal.find((v) => v.itemRemitoId === ganador!.itemRemitoId);
    const totalEscaneado = calcularTotalEscaneado(vistaFinal);

    return {
      success: true,
      productoN: ganador.candidato.productoN,
      cantidadEscaneada: itemFinal?.cantidad ?? 0,
      cantidadRestante: itemFinal?.cantidadRestante ?? 0,
      totalEscaneado,
    };
  } catch (err) {
    // Paso 9: excepcion no controlada.
    if (err instanceof BusinessError) throw err;
    const mensajeTecnico = err instanceof Error ? err.message : String(err);
    throw new BusinessError(500, 'SCAN_ERROR', Messages.scanError(mensajeTecnico));
  }
}

export interface EliminarInput {
  etiqueta: string;
  tipo: string;
}

// Replica EliminarEtiqueta (UnitFunciones.pas).
export async function eliminarEtiqueta(
  esDespacho: boolean,
  remitoId: string,
  input: EliminarInput,
): Promise<{ success: true; totalEscaneado: number }> {
  if (!input.etiqueta) {
    throw new BusinessError(400, 'EMPTY_CODE', Messages.EMPTY_CODE);
  }

  const maestro = await obtenerEtiquetasMaestro(input.etiqueta, input.tipo);
  if (maestro.length === 0) {
    throw new BusinessError(404, 'LABEL_INVALID', Messages.labelInvalido(input.etiqueta));
  }

  await borrarEtiquetaMasReciente(remitoId, input.etiqueta);

  const vista = await obtenerVistaTransaccion(esDespacho, remitoId);
  return { success: true, totalEscaneado: calcularTotalEscaneado(vista) };
}

// Replica BorrarTransaccion (UnitFunciones.pas). La confirmacion irreversible es responsabilidad
// de la UI Android; este endpoint no reconfirma.
export async function borrarTransaccion(esDespacho: boolean, remitoId: string): Promise<{ success: true }> {
  await borrarTransaccionStaging(remitoId, esDespacho);
  return { success: true };
}

// Replica ButtonConfirmarClick de UnitDespacho.pas: valida cantidad == cantidadOriginal en todos los items.
export async function confirmarDespacho(remitoId: string): Promise<{ success: true }> {
  const vista = await obtenerVistaTransaccion(true, remitoId);
  const difiere = vista.some((item) => item.cantidad !== item.cantidadOriginal);
  if (difiere) {
    throw new BusinessError(422, 'QUANTITY_MISMATCH', Messages.QUANTITY_MISMATCH);
  }
  return { success: true };
}

// Replica ButtonConfirmarClick de UnitDevolucion.pas: sin validacion (deshabilitada en el
// original, bloque de codigo comentado). Se replica la ausencia de validacion tal cual.
export async function confirmarDevolucion(_remitoId: string): Promise<{ success: true }> {
  return { success: true };
}
