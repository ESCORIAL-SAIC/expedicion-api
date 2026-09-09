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
  obtenerUltimoEstadoEtiqueta,
} from '../escaneo/repository.js';
import type { MasterLabelRow, ScanResult } from '../escaneo/types.js';
import type { CircuitoConfig } from './config.js';
import { obtenerEtiquetasMaestroImportados } from './repository.js';

export interface EscanearCircuitoInput {
  etiqueta: string;
  remitoN: string;
}

/**
 * Escaneo de los circuitos IMPORT / PEABODY.
 *
 * Sigue el mismo orden de pasos que escanear() (escaneo/service.ts), reusando sus
 * repositorios, con tres diferencias que salen de la config del circuito:
 *   - paso 2 (ya despachada) y paso 4 (duplicado en staging) se saltean cuando la etiqueta
 *     no identifica una unidad unica (caso PEABODY),
 *   - paso 3 lee el maestro de importados en Postgres en vez del maestro MSSQL,
 *   - paso 5 (CONTROL_FINAL) no aplica.
 * Los pasos 1, 6, 7, 8 y 9 son identicos al despacho normal.
 *
 * Estos circuitos siempre escriben con es_despacho = true: son despacho, no devolucion.
 */
export async function escanearCircuito(
  circuito: CircuitoConfig,
  remitoId: string,
  input: EscanearCircuitoInput,
): Promise<ScanResult> {
  try {
    // Paso 1: codigo vacio.
    if (!input.etiqueta) {
      throw new BusinessError(400, 'EMPTY_CODE', Messages.EMPTY_CODE);
    }

    // Paso 2: ultimo estado global de la etiqueta (solo si la etiqueta es unica por unidad).
    if (circuito.validaYaDespachada) {
      const despachadaPreviamente = await obtenerUltimoEstadoEtiqueta(input.etiqueta);
      if (despachadaPreviamente === true) {
        throw new BusinessError(409, 'LABEL_ALREADY_DISPATCHED', Messages.LABEL_ALREADY_DISPATCHED);
      }
    }

    // Paso 3: existe en el maestro de etiquetas con importados (Postgres).
    const maestro = await obtenerEtiquetasMaestroImportados(input.etiqueta, circuito.tipo);
    if (maestro.length === 0) {
      throw new BusinessError(404, 'LABEL_NOT_FOUND', Messages.labelNotFoundDespacho(input.etiqueta));
    }

    // Paso 4: duplicado en staging (abort silencioso). Apagado cuando el codigo se repite
    // entre unidades, o la segunda unidad del mismo producto no se podria cargar.
    if (circuito.validaDuplicado) {
      const duplicado = await existeEtiquetaEnStaging(remitoId, input.etiqueta);
      if (duplicado) {
        return { duplicated: true };
      }
    }

    // Paso 5: CONTROL_FINAL. Estos productos no pasan por la linea propia, no aplica.
    if (circuito.validaControlFinal && maestro[0].controlFinal === false) {
      throw new BusinessError(422, 'NO_FINAL_CONTROL', Messages.noFinalControl(input.etiqueta));
    }

    // Paso 6 y 7: producto pertenece al remito, con "next candidate" si hay mas de un
    // registro maestro con el mismo numero+tipo y el primero tiene cupo completo.
    const productosRemito = await obtenerProductosRemito(remitoId);
    const vistaTransaccion = await obtenerVistaTransaccion(true, remitoId);

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
      esDespacho: true,
      remitoN: input.remitoN,
      etiqueta: input.etiqueta,
      productoN: ganador.candidato.productoN,
      remitoId,
      itemRemitoId: ganador.itemRemitoId,
      productoId: ganador.candidato.productoId,
    });

    const vistaFinal = await obtenerVistaTransaccion(true, remitoId);
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

export interface EliminarCircuitoInput {
  etiqueta: string;
}

/**
 * Quita una etiqueta del staging del remito. Igual que eliminarEtiqueta() del despacho
 * normal, pero validando la existencia contra el maestro de importados.
 *
 * Borra el registro mas reciente que matchee etiqueta+remito. Con codigos repetidos
 * (PEABODY) eso significa "descontar una unidad", que es justo lo que se necesita.
 */
export async function eliminarEtiquetaCircuito(
  circuito: CircuitoConfig,
  remitoId: string,
  input: EliminarCircuitoInput,
): Promise<{ success: true; totalEscaneado: number }> {
  if (!input.etiqueta) {
    throw new BusinessError(400, 'EMPTY_CODE', Messages.EMPTY_CODE);
  }

  const maestro = await obtenerEtiquetasMaestroImportados(input.etiqueta, circuito.tipo);
  if (maestro.length === 0) {
    throw new BusinessError(404, 'LABEL_INVALID', Messages.labelInvalido(input.etiqueta));
  }

  await borrarEtiquetaMasReciente(remitoId, input.etiqueta);

  const vista = await obtenerVistaTransaccion(true, remitoId);
  return { success: true, totalEscaneado: calcularTotalEscaneado(vista) };
}

/**
 * Borra todo el staging de despacho no migrado del remito.
 *
 * Alcance decidido con el usuario: TODO el remito, sin filtrar por tipo, igual que el
 * despacho normal. En un remito mixto (cocinas + importados) esto tambien borra los
 * renglones del otro circuito; la confirmacion es responsabilidad de la UI.
 */
export async function borrarTransaccionCircuito(remitoId: string): Promise<{ success: true }> {
  await borrarTransaccionStaging(remitoId, true);
  return { success: true };
}

/**
 * Confirma el despacho: valida que todos los items del remito tengan la cantidad esperada.
 * Misma regla que confirmarDespacho(), y tambien de alcance remito completo.
 */
export async function confirmarCircuito(remitoId: string): Promise<{ success: true }> {
  const vista = await obtenerVistaTransaccion(true, remitoId);
  const difiere = vista.some((item) => item.cantidad !== item.cantidadOriginal);
  if (difiere) {
    throw new BusinessError(422, 'QUANTITY_MISMATCH', Messages.QUANTITY_MISMATCH);
  }
  return { success: true };
}
