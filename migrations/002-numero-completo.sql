-- ---------------------------------------------------------------------------
-- 002 - NUMERO_COMPLETO en vp_etiquetas_con_importados
--
-- ESTE ARCHIVO NO SE EJECUTA SOLO. Lo corre una persona contra el Postgres ESCORIAL.
-- Requiere 001-staging-circuitos.sql aplicado (el orden entre los dos no importa, pero los dos
-- tienen que estar antes de desplegar la API).
--
--
-- QUE PROBLEMA RESUELVE
--
-- La rama de importados de la vista trunca la serie a los ultimos 9 digitos:
--
--     ("right"((eti.numero)::text, 9))::integer AS numero
--
-- Las series reales son de 18 digitos EXACTOS (10371 filas activas, min = max = 18). Comparar
-- `WHERE ET.NUMERO = $1` con la serie entera da 22003 (integer out of range) antes de leer una
-- sola fila, porque la columna resultante es int4.
--
-- Y normalizar el codigo escaneado a 9 digitos NO es alternativa: truncar pierde unicidad. Las
-- 10371 series son unicas 1 a 1, pero sus sufijos de 9 colapsan en 9911 -- 460 cruces. Cuando dos
-- de esos cruces caen en productos distintos del MISMO remito (una cocina electrica y un horno
-- empotrable, por ejemplo), el filtro por remito no desambigua y escanear uno despacharia el
-- otro. Verificado en local-test, que reproduce ese caso en el remito 0003500001327.
--
-- Esta migracion agrega NUMERO_COMPLETO al final de cada rama del UNION, conservando la serie
-- entera como texto. `numero` NO cambia: el Delphi y todo lo que ya lee la vista siguen viendo
-- exactamente lo mismo.
--
--
-- ANTES DE APLICAR: GUARDAR LA DEFINICION ACTUAL. Es el unico rollback.
--
--     SELECT definition FROM pg_views WHERE viewname = 'vp_etiquetas_con_importados';
--
-- Guardarla en un archivo. Para revertir, se vuelve a aplicar con CREATE OR REPLACE VIEW.
--
--
-- SOBRE EL ::text
--
-- Si `web.etiquetas_maestro_importados.numero` resultara ser numeric CON ESCALA, el ::text puede
-- dar '123...000.00' o notacion cientifica en vez de 18 digitos limpios. Con bigint o varchar no
-- hay problema. Verificar despues de aplicar (chequeo 2 mas abajo) y, si hiciera falta, cambiar
-- esa linea por:
--
--     to_char(eti.numero, 'FM999999999999999999') AS numero_completo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vp_etiquetas_con_importados AS
 SELECT vp_etiquetas.numero,
    vp_etiquetas.producto_id,
    vp_etiquetas.producto_c,
    vp_etiquetas.producto_n,
    vp_etiquetas.tipo,
    vp_etiquetas.ingreso_stock,
    vp_etiquetas.fecha_paso_lector,
    (vp_etiquetas.numero)::text AS numero_completo
   FROM vp_etiquetas
UNION
 SELECT ("right"((eti.numero)::text, 9))::integer AS numero,
    coc.id AS producto_id,
    "right"((eti.idproducto)::text, 5) AS producto_c,
    eti.modelo AS producto_n,
    'IMPORTADO'::text AS tipo,
    eti.ingreso_stock,
    eti.fecha_paso_lector,
    (eti.numero)::text AS numero_completo
   FROM (web.etiquetas_maestro_importados eti
     JOIN producto coc ON (((eti.idproducto)::text = (coc.codigo)::text)))
  WHERE ((eti.estado = 1) AND (eti.fecha > '2022-03-01 00:00:00'::timestamp without time zone));


-- ===========================================================================
-- CHEQUEOS DESPUES DE APLICAR
--
-- 1. El UNION dedupe con una columna mas: dos filas que antes colapsaban en una ahora pueden ser
--    dos. Comparar contra el conteo anotado ANTES de aplicar.
--
--      SELECT count(*) FROM vp_etiquetas_con_importados;
--
-- 2. numero_completo tiene que dar 18 digitos limpios (ver la nota sobre ::text arriba).
--
--      SELECT numero_completo, length(numero_completo)
--      FROM vp_etiquetas_con_importados WHERE tipo = 'IMPORTADO' LIMIT 5;
--
-- 3. Unicidad, que es lo que justifica toda la migracion: los dos numeros deben ser iguales.
--
--      SELECT count(*), count(DISTINCT numero_completo)
--      FROM vp_etiquetas_con_importados WHERE tipo = 'IMPORTADO';
--
-- 4. Y para dimensionar lo que se evita, los cruces que produce el truncado:
--
--      SELECT count(*) - count(DISTINCT numero) AS colisiones_por_truncar
--      FROM vp_etiquetas_con_importados WHERE tipo = 'IMPORTADO';
-- ===========================================================================
