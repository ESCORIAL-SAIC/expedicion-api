-- ---------------------------------------------------------------------------
-- 001 - Staging aparte para los circuitos nuevos (IMPORT / PEABODY)
--
-- ESTE ARCHIVO NO SE EJECUTA SOLO. Lo corre una persona contra el Postgres ESCORIAL de
-- produccion, leyendo antes las advertencias del final. El compose de local-test no lo mira:
-- la estructura equivalente esta integrada en local-test/init.sql.
--
--
-- QUE PROBLEMA RESUELVE
--
-- `aux_expedicion.etiqueta` es integer (verificado en information_schema el 2026-09-16): tope
-- 2147483647, diez digitos. No entran:
--
--   - EAN de Peabody         13 digitos
--   - DUN de Peabody         14 digitos
--   - serie de importado     18 digitos (10371 filas, min = max = 18)
--
-- El INSERT del escaneo falla con 22003 (value out of range for type integer) y el catch de
-- circuitos/service.ts lo envuelve en scanError(), que le muestra al operario el texto crudo de
-- Postgres en ingles. Hoy, en produccion, NINGUNA lectura de esos dos circuitos se registra.
--
--
-- POR QUE UNA TABLA NUEVA Y NO UN ALTER
--
-- Lo correcto seria `ALTER TABLE aux_expedicion ALTER COLUMN etiqueta TYPE bigint`. No se puede
-- sin mas: la columna tiene SIETE vistas dependientes (pg_depend, 2026-09-22), y Postgres
-- rechaza el cambio de tipo por debajo de una vista (0A000):
--
--   nivel 2   public.vp_etiquetas_con_importados, public.newview
--   nivel 1   web.v_aux_expedicion_udespacho, public.esco_etiquetas,
--             public.vp_migradevolucion_, public.vp_cantidadremito, public.vp_etiquetas
--
-- Habria que dropearlas en orden y recrearlas. Dos razones para no hacerlo ahora:
--
--   1. `vp_etiquetas` es la base del circuito COCINA/TERMOTANQUE, que hoy funciona bien. El
--      cambio es para arreglar Peabody e importados: arriesgar el circuito que anda contra el
--      que no anda es mal negocio.
--   2. `newview` no se sabe que hace ni quien la consulta. Un DROP/CREATE a ciegas sobre algo
--      que nadie puede evaluar no es una operacion controlada.
--
-- Esta tabla tiene la misma estructura con `etiqueta` en bigint, y no toca ningun objeto
-- existente: es puramente aditiva y reversible con dos DROP.
--
--
-- ES UNA SOLUCION PUENTE
--
-- El estado deseable sigue siendo UNA sola tabla. Cuando se puedan auditar las 7 vistas y hacer
-- el ALTER, el camino de vuelta es: migrar estas filas a aux_expedicion, borrar esta tabla y la
-- vista, y revertir el ruteo en el codigo. Mientras tanto, el costo es que hay dos lugares donde
-- vive una lectura y toda query de conteo tiene que mirar los dos.
-- ---------------------------------------------------------------------------

BEGIN;

-- INCLUDING ALL copia defaults, constraints e indices de la original. No hay FKs.
CREATE TABLE public.aux_expedicion_circuitos (
  LIKE public.aux_expedicion INCLUDING ALL
);

-- La unica diferencia con la tabla vieja, y el motivo de todo esto.
ALTER TABLE public.aux_expedicion_circuitos ALTER COLUMN etiqueta TYPE bigint;

-- Indices para los dos accesos de la API: por remito (conteos, borrar transaccion) y por
-- etiqueta (ya despachada, duplicado, borrar la mas reciente). INCLUDING ALL copia los de la
-- tabla vieja, que puede no tener ninguno util para esto.
CREATE INDEX IF NOT EXISTS ix_aux_exp_circ_remito
  ON public.aux_expedicion_circuitos (remito_id, es_despacho);
CREATE INDEX IF NOT EXISTS ix_aux_exp_circ_etiqueta
  ON public.aux_expedicion_circuitos (etiqueta, fechahora DESC);

-- ---------------------------------------------------------------------------
-- Vista de lectura unificada.
--
-- Las queries que CUENTAN tienen que ver las dos tablas: un remito mixto (COCINA + IMPORT, como
-- el 0003500001326) tiene filas en las dos, y si el conteo mira una sola, el avance queda mal y
-- el confirmar no cierra nunca.
--
-- Esas queries (obtenerAvancePorRemito, obtenerVistaTransaccion) NO leen `etiqueta`: hacen
-- COUNT(*) agrupando por remito e item. Por eso alcanza con esta vista y no hace falta tocar su
-- logica, solo el nombre de la tabla.
--
-- UNION ALL y no UNION: son filas de tablas distintas, no hay duplicados que eliminar, y el
-- DISTINCT implicito de UNION costaria un sort sobre todo el staging en cada consulta.
--
-- El cast explicito a bigint documenta la promocion que el UNION ALL haria igual.
-- ---------------------------------------------------------------------------
CREATE VIEW public.v_aux_expedicion_todo AS
  SELECT id, es_despacho, remito_n, etiqueta::bigint AS etiqueta, producto_n,
         remito_id, itemremito_id, producto_id, fechahora, migrado
  FROM public.aux_expedicion
  UNION ALL
  SELECT id, es_despacho, remito_n, etiqueta, producto_n,
         remito_id, itemremito_id, producto_id, fechahora, migrado
  FROM public.aux_expedicion_circuitos;

COMMIT;


-- ===========================================================================
-- ANTES DE DESPLEGAR LA API: EL PROCESO DE MIGRACION AL ERP
--
-- Esto no es un detalle de implementacion, es lo que decide si este enfoque sirve.
--
-- El proceso externo que lleva el staging al ERP lee `aux_expedicion` y marca migrado = true.
-- No conoce `aux_expedicion_circuitos`. Si se despliega la API sin resolver esto, las lecturas
-- de Peabody e importados se van a registrar bien y despues NO VAN A MIGRAR NUNCA -- en
-- silencio, con el operario viendo "confirmado" en la pantalla.
--
-- Eso es PEOR que el bug actual, donde el escaneo falla a la vista de todos.
--
-- Hay que resolver una de las dos, y confirmarla antes del deploy:
--
--   a) Si el proceso consume `web.v_aux_expedicion_udespacho` (el nombre lo sugiere), redefinir
--      esa vista para que lea de v_aux_expedicion_todo en vez de aux_expedicion. El proceso
--      levanta las filas nuevas sin enterarse de nada. Empezar por:
--
--        SELECT definition FROM pg_views WHERE viewname = 'v_aux_expedicion_udespacho';
--
--      Si ademas ESCRIBE el migrado = true a traves de esa vista, la vista tiene que seguir
--      siendo actualizable -- un UNION ALL no lo es, asi que haria falta un trigger
--      INSTEAD OF UPDATE que rutee al lado correcto.
--
--   b) Si lee la tabla directo, hay que tocar ese proceso para que lea las dos (o la vista).
--      Eso vive fuera de este repo.
--
-- Mientras no este resuelto, conviene un chequeo periodico de filas varadas:
--
--   SELECT count(*) FROM public.aux_expedicion_circuitos WHERE migrado = false
--     AND fechahora < now() - interval '1 day';
-- ===========================================================================


-- ===========================================================================
-- ROLLBACK
--
-- Aditivo, asi que se revierte con dos DROP. Si ya se escribieron lecturas, RESCATARLAS PRIMERO:
-- son escaneos reales de mercaderia que salio.
--
--   BEGIN;
--   -- Solo entran las que quepan en integer: las de 13+ digitos NO, que es el bug original.
--   -- Revisar a mano lo que quede afuera antes de borrar nada.
--   SELECT count(*) FROM public.aux_expedicion_circuitos WHERE etiqueta > 2147483647;
--
--   DROP VIEW  public.v_aux_expedicion_todo;
--   DROP TABLE public.aux_expedicion_circuitos;
--   COMMIT;
-- ===========================================================================
