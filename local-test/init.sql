-- Esquema y dataset de prueba para ejercitar los circuitos de despacho en local.
--
-- ATENCION: esto NO es el esquema real. No existe DDL de las vistas de produccion en el repo,
-- asi que estas definiciones se reconstruyeron a partir de las columnas que piden las queries de
-- la API (src/modules/**). Sirve para validar el SQL y el flujo de punta a punta; no sirve para
-- afirmar que el esquema de produccion sea asi.
--
-- El dataset esta armado como CATALOGO DE CASOS: cada remito cubre una situacion concreta que
-- puede aparecer en produccion. El indice esta al final del archivo.

-- ---------------------------------------------------------------------------
-- Staging (tabla real en produccion, no vista)
-- ---------------------------------------------------------------------------
CREATE TABLE public.aux_expedicion (
  id             uuid PRIMARY KEY,
  es_despacho    boolean,
  remito_n       text,
  -- integer, NO bigint: es lo que hay en produccion (verificado en information_schema el
  -- 2026-09-16, junto con aux_expedicion_error.etiqueta). Tope 2147483647, o sea 10 digitos.
  --
  -- Estaba en bigint y por eso el entorno local no reproducia el bug que motivo todo esto: un
  -- EAN de Peabody (13 digitos) o una serie de importado (18) desbordan la columna y Postgres
  -- tira 22003, que el catch de circuitos/service.ts envuelve en scanError() y le muestra al
  -- operario el texto crudo de Postgres en ingles.
  --
  -- Dejarla en integer es lo que hace que el caso se pueda reproducir con `docker compose up`.
  -- Cuando se amplie en produccion (ALTER ... TYPE bigint, tambien en aux_expedicion_error),
  -- ampliar aca en el mismo commit para que los dos entornos no vuelvan a divergir.
  etiqueta       integer,
  producto_n     text,
  remito_id      uuid,
  itemremito_id  uuid,
  producto_id    uuid,
  fechahora      timestamp NOT NULL DEFAULT now(),
  migrado        boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- Staging de los circuitos nuevos (IMPORT / PEABODY).
--
-- Misma estructura que aux_expedicion pero con `etiqueta` en bigint. Existe porque la columna de
-- la tabla vieja es integer y no se puede ampliar: tiene siete vistas colgando, una de ellas
-- vp_etiquetas, que es la base del circuito COCINA/TERMOTANQUE.
--
-- El DDL de produccion, con el detalle de las siete vistas y las advertencias sobre el proceso
-- de migracion al ERP, esta en migrations/001-staging-circuitos.sql. Aca se replica para que el
-- entorno local tenga la misma forma.
-- ---------------------------------------------------------------------------
CREATE TABLE public.aux_expedicion_circuitos (
  LIKE public.aux_expedicion INCLUDING ALL
);

ALTER TABLE public.aux_expedicion_circuitos ALTER COLUMN etiqueta TYPE bigint;

CREATE INDEX ix_aux_exp_circ_remito
  ON public.aux_expedicion_circuitos (remito_id, es_despacho);
CREATE INDEX ix_aux_exp_circ_etiqueta
  ON public.aux_expedicion_circuitos (etiqueta, fechahora DESC);

-- Lectura unificada: las queries que cuentan (avance por remito, vista de transaccion) tienen
-- que ver las dos tablas, porque un remito mixto tiene filas en ambas. Ninguna de esas lee
-- `etiqueta`: agrupan y hacen COUNT(*).
CREATE VIEW public.v_aux_expedicion_todo AS
  SELECT id, es_despacho, remito_n, etiqueta::bigint AS etiqueta, producto_n,
         remito_id, itemremito_id, producto_id, fechahora, migrado
  FROM public.aux_expedicion
  UNION ALL
  SELECT id, es_despacho, remito_n, etiqueta, producto_n,
         remito_id, itemremito_id, producto_id, fechahora, migrado
  FROM public.aux_expedicion_circuitos;

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------
CREATE TABLE public.vp_aplicaciones_empleado (
  usuario  text,
  password text
);

INSERT INTO public.vp_aplicaciones_empleado (usuario, password) VALUES ('TEST', '1234');

-- ---------------------------------------------------------------------------
-- Productos (V_PRODUCTO + su extension V_UD_PRODUCTO)
--
-- descripcionapp es una descripcion corta que se carga a mano en el ERP y esta vacia ('' , no
-- NULL) en la enorme mayoria de los productos. Se mezclan los dos casos a proposito para
-- verificar el COALESCE de PRODUCTO_N.
-- ---------------------------------------------------------------------------
-- CODIGOGS1 es el EAN de la unidad y CODIGO_DUN el de la caja master. Los dos son del PRODUCTO,
-- no de la unidad fisica: se repiten en todas sus cajas. Es de aca que sale el producto al
-- escanear en el circuito Peabody, que no tiene maestro de etiquetas.
CREATE TABLE public.v_ud_producto (
  id             uuid PRIMARY KEY,
  descripcionapp text,
  codigogs1      text DEFAULT '',
  codigo_dun     text DEFAULT ''
);

CREATE TABLE public.v_producto (
  id              uuid PRIMARY KEY,
  boextension_id  uuid REFERENCES public.v_ud_producto(id),
  descripcion     text
);

-- Solo los Peabody tienen EAN y DUN cargados: es un circuito nuevo y al 2026-09 hay 4 productos
-- asi en produccion. El resto va por maestro de etiquetas y no los necesita.
INSERT INTO public.v_ud_producto (id, descripcionapp, codigogs1, codigo_dun) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '', '7791234567890', '17791234567890'),  -- cafetera peabody
  ('00000000-0000-0000-0000-0000000000a6', '', '7791234567891', '17791234567891'),  -- pava peabody
  ('00000000-0000-0000-0000-0000000000a2', '', '', ''),                  -- importado
  ('00000000-0000-0000-0000-0000000000a3', 'COCINA 4H BLANCA', '', ''),  -- cocina: si tiene desc corta
  ('00000000-0000-0000-0000-0000000000a4', 'TERMOTANQUE 80L', '', ''),   -- termo: idem
  ('00000000-0000-0000-0000-0000000000a5', '', '', ''),                  -- cocina 6h
  ('00000000-0000-0000-0000-0000000000a7', '', '', '');                  -- horno empotrable (import)

-- Tabla base del producto. UNIDADESPORBULTO es cuantas unidades trae la caja master, y es lo que
-- descuenta un escaneo de DUN. Solo aplica a los productos que tienen DUN (Peabody).
CREATE TABLE public.producto (
  id                uuid PRIMARY KEY,
  unidadesporbulto  integer
);

INSERT INTO public.producto (id, unidadesporbulto) VALUES
  ('00000000-0000-0000-0000-000000000011', 3),     -- cafetera: caja de 3
  ('00000000-0000-0000-0000-000000000016', 2),     -- pava: caja de 2
  ('00000000-0000-0000-0000-000000000012', NULL),  -- importado: sin DUN, no aplica
  ('00000000-0000-0000-0000-000000000013', NULL),
  ('00000000-0000-0000-0000-000000000014', NULL),
  ('00000000-0000-0000-0000-000000000015', NULL),
  ('00000000-0000-0000-0000-000000000017', NULL);  -- horno empotrable: sin DUN, no aplica

INSERT INTO public.v_producto (id, boextension_id, descripcion) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1',
   'CAFETERA PEABODY PE-CT4201 1.2L'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000000a2',
   'ANAFE IMPORTADO 2 HORNALLAS 30CM'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-0000000000a3',
   'COCINA 4 HORNALLAS BLANCA 56CM COD-4471'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-0000000000a4',
   'TERMOTANQUE 80 LITROS ELECTRICO COD-8890'),
  ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-0000000000a5',
   'COCINA 6 HORNALLAS ACERO 76CM COD-6620'),
  ('00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-0000000000a6',
   'PAVA ELECTRICA PEABODY PE-PE5000 1.7L'),
  -- Segundo importado: existe para que un remito pueda tener DOS productos IMPORT y se vea el
  -- cruce de sufijos entre productos distintos (remito 0003500001327).
  ('00000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-0000000000a7',
   'HORNO EMPOTRABLE 60CM INOX');

-- ---------------------------------------------------------------------------
-- Items de remito (V_ITEMEGRESOINVENTARIO). PLACEOWNER_ID es el remito.
-- ---------------------------------------------------------------------------
CREATE TABLE public.v_itemegresoinventario (
  id                    uuid PRIMARY KEY,
  placeowner_id         uuid,
  referenciatipo_id     uuid,
  cantidad2_cantidad    numeric,
  numerodocumento       text,
  nombredestinatariotr  text
);

INSERT INTO public.v_itemegresoinventario
  (id, placeowner_id, referenciatipo_id, cantidad2_cantidad, numerodocumento, nombredestinatariotr)
VALUES
  -- R1 (0004100000018) PEABODY vacio: 3 cafeteras, nada escaneado.
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000011', 3, '0004100000018', 'CASA CENTRAL PEABODY SA'),

  -- R2 (0003500001325) IMPORT a medias: 4 anafes, 2 escaneados.
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000012', 4, '0003500001325', 'DISTRIBUIDORA IMPORTADOS SRL'),

  -- R3 (0003400002829) MIXTO cocina+termo, ambos a medias.
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000013', 2, '0003400002829', 'ELECTRO HOGAR SA'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000014', 2, '0003400002829', 'ELECTRO HOGAR SA'),

  -- R4 (0003400002830) COCINA completo: 2 de 2. Debe salir con check y al final.
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000013', 2, '0003400002830', 'CADENA BLANCA SRL'),

  -- R5 (0004100000019) PEABODY completo: 2 de 2, mismo EAN dos veces.
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000016', 2, '0004100000019', 'SUCURSAL NORTE PEABODY'),

  -- R6 (0003400002831) MIXTO cocina+termo, TODO completo. Caso de "borrar transaccion" que
  -- alcanza a los dos tipos.
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000015', 1, '0003400002831', 'MAYORISTA SUR SA'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000014', 1, '0003400002831', 'MAYORISTA SUR SA'),

  -- R7 (0003400002832) remito de una sola unidad: se completa con un solo escaneo.
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000007',
   '00000000-0000-0000-0000-000000000013', 1, '0003400002832', 'CLIENTE MINORISTA'),

  -- R8 (0003400002833) remito grande: 12 cocinas, 5 escaneadas. Ejercita el contador 1..8.
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000013', 12, '0003400002833', 'CADENA NACIONAL SA'),

  -- R9 (0003500001326) IMPORT + PEABODY en el mismo remito. Ojo: los dos van por circuitos
  -- distintos pero comparten remito_id, asi que borrar transaccion desde uno alcanza al otro.
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000012', 2, '0003500001326', 'IMPORTADORA MIXTA SA'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000011', 1, '0003500001326', 'IMPORTADORA MIXTA SA'),

  -- R10 (0003400002834) remito de DEVOLUCION (permite_despacho = false).
  ('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000013', 1, '0003400002834', 'DEVOLUCIONES SA'),

  -- R11 (0003500001327) DOS productos IMPORT en el mismo remito, con series que colisionan en
  -- sus ultimos 9 digitos (...000999001). Es el caso que el filtro por remito NO puede
  -- desambiguar: los dos productos estan en el mismo remito, asi que candidatosEnRemito deja
  -- los dos y escanearCircuito se queda con el primero que tenga cupo.
  ('00000000-0000-0000-0000-000000000114', '00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000012', 1, '0003500001327', 'ELECTRODOMESTICOS DEL SUR SA'),
  ('00000000-0000-0000-0000-000000000115', '00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000017', 1, '0003500001327', 'ELECTRODOMESTICOS DEL SUR SA');

-- ---------------------------------------------------------------------------
-- Listados de remitos.
--
-- Las dos vistas reales son POR ITEM (traen itemremito_id, producto_id, cantidad) y difieren en
-- de donde sacan el TIPO, que es la diferencia que importa:
--
--   vp_itemremito            el tipo sale de la CABECERA del remito
--                            (CASE sobre rv.numerador_id -> 'COCINA' | 'TERMOTANQUE').
--                            Un remito entero es de un solo tipo, y solo puede dar esos dos.
--                            Es la que usa la app Delphi.
--
--   ve_items_remito_despacho el tipo sale del PRODUCTO (coc.tipoproducfiscal), asi que un mismo
--                            remito puede tener items de tipos distintos, y cubre los cuatro.
--                            Es la unica que devuelve IMPORT y PEABODY.
--
-- Aca se replica esa diferencia: la tabla base guarda el tipo por producto y por remito, y cada
-- vista arma el suyo como la real. La version anterior de este archivo tenia un remito con dos
-- tipos sobre el mismo remito_id en las DOS vistas, algo que vp_itemremito no puede producir --
-- y eso hacia que entrar por COCINA mostrara tambien los termotanques.
-- ---------------------------------------------------------------------------

-- Tipo por PRODUCTO (equivalente a ve_productos_despacho.tipoproducfiscal).
CREATE TABLE public.ve_productos_despacho (
  id               uuid PRIMARY KEY,
  tipoproducfiscal text
);

INSERT INTO public.ve_productos_despacho (id, tipoproducfiscal) VALUES
  ('00000000-0000-0000-0000-000000000011', 'PEABODY'),      -- cafetera
  ('00000000-0000-0000-0000-000000000016', 'PEABODY'),      -- pava electrica
  ('00000000-0000-0000-0000-000000000012', 'IMPORT'),       -- anafe importado
  ('00000000-0000-0000-0000-000000000017', 'IMPORT'),       -- horno empotrable
  ('00000000-0000-0000-0000-000000000013', 'COCINA'),       -- cocina 4h
  ('00000000-0000-0000-0000-000000000015', 'COCINA'),       -- cocina 6h
  ('00000000-0000-0000-0000-000000000014', 'TERMOTANQUE');  -- termotanque

-- Cabecera del remito. numerador_tipo emula el CASE sobre rv.numerador_id de vp_itemremito: es el
-- tipo que esa vista le asigna a TODOS los items del remito.
CREATE TABLE public._remito_cabecera (
  remito_id         uuid PRIMARY KEY,
  remito_n          text,
  cliente_n         text,
  cliente_id        uuid,
  numerador_tipo    text,
  consignacion      boolean,
  permite_despacho  boolean
);

INSERT INTO public._remito_cabecera
  (remito_id, remito_n, cliente_n, cliente_id, numerador_tipo, consignacion, permite_despacho)
VALUES
  ('00000000-0000-0000-0000-000000000001', '0004100000018', 'CASA CENTRAL PEABODY SA',      '00000000-0000-0000-0000-0000000000c1', 'TERMOTANQUE', false, true),
  ('00000000-0000-0000-0000-000000000002', '0003500001325', 'DISTRIBUIDORA IMPORTADOS SRL', '00000000-0000-0000-0000-0000000000c2', 'TERMOTANQUE', false, true),
  ('00000000-0000-0000-0000-000000000003', '0003400002829', 'ELECTRO HOGAR SA',             '00000000-0000-0000-0000-0000000000c3', 'COCINA',      false, true),
  ('00000000-0000-0000-0000-000000000004', '0003400002830', 'CADENA BLANCA SRL',            '00000000-0000-0000-0000-0000000000c4', 'COCINA',      false, true),
  ('00000000-0000-0000-0000-000000000005', '0004100000019', 'SUCURSAL NORTE PEABODY',       '00000000-0000-0000-0000-0000000000c5', 'TERMOTANQUE', false, true),
  ('00000000-0000-0000-0000-000000000006', '0003400002831', 'MAYORISTA SUR SA',             '00000000-0000-0000-0000-0000000000c6', 'COCINA',      false, true),
  ('00000000-0000-0000-0000-000000000007', '0003400002832', 'CLIENTE MINORISTA',            '00000000-0000-0000-0000-0000000000c7', 'COCINA',      false, true),
  ('00000000-0000-0000-0000-000000000008', '0003400002833', 'CADENA NACIONAL SA',           '00000000-0000-0000-0000-0000000000c8', 'COCINA',      false, true),
  -- Consignacion: el campo viaja como informativo (la regla consignacion/venta no esta
  -- implementada, ni aca ni en el Delphi). Ojo que ve_items_remito_despacho lo trae fijo en false.
  ('00000000-0000-0000-0000-000000000009', '0003500001326', 'IMPORTADORA MIXTA SA',         '00000000-0000-0000-0000-0000000000c9', 'TERMOTANQUE', true,  true),
  ('00000000-0000-0000-0000-000000000010', '0003400002834', 'DEVOLUCIONES SA',              '00000000-0000-0000-0000-0000000000ca', 'COCINA',      false, false),
  ('00000000-0000-0000-0000-000000000011', '0003500001327', 'ELECTRODOMESTICOS DEL SUR SA', '00000000-0000-0000-0000-0000000000cb', 'TERMOTANQUE', false, true);

-- Tipo de la CABECERA: un remito, un solo tipo. Solo COCINA / TERMOTANQUE.
CREATE VIEW public.vp_itemremito AS
  SELECT
    c.permite_despacho,
    c.remito_n,
    c.remito_id,
    i.id                 AS itemremito_id,
    i.referenciatipo_id  AS producto_id,
    p.descripcion        AS producto_n,
    i.cantidad2_cantidad AS cantidad,
    c.cliente_n,
    c.cliente_id,
    c.numerador_tipo     AS tipo,
    c.consignacion
  FROM public._remito_cabecera c
  JOIN public.v_itemegresoinventario i ON i.placeowner_id = c.remito_id
  JOIN public.v_producto p             ON p.id = i.referenciatipo_id;

-- Tipo del PRODUCTO: un remito puede tener items de varios tipos. Cubre los cuatro.
-- consignacion va fija en false, igual que la vista real.
CREATE VIEW public.ve_items_remito_despacho AS
  SELECT
    true                 AS permite_despacho,
    c.remito_n,
    c.remito_id,
    i.id                 AS itemremito_id,
    i.referenciatipo_id  AS producto_id,
    p.descripcion        AS producto_n,
    i.cantidad2_cantidad AS cantidad,
    c.cliente_n,
    c.cliente_id,
    prod.tipoproducfiscal AS tipo,
    false                AS consignacion
  FROM public._remito_cabecera c
  JOIN public.v_itemegresoinventario i     ON i.placeowner_id = c.remito_id
  JOIN public.v_producto p                 ON p.id = i.referenciatipo_id
  JOIN public.ve_productos_despacho prod   ON prod.id = i.referenciatipo_id
  WHERE c.permite_despacho;

-- ---------------------------------------------------------------------------
-- Maestro de etiquetas de importados (Postgres).
--
-- Esta parte SI esta calcada del DDL real: se leyo de pg_views contra produccion el 2026-09-16
-- (el resto del archivo sigue siendo reconstruido a partir de las queries). La version anterior
-- era una tabla plana con series de 5 digitos y tipo 'IMPORT', y por eso el circuito IMPORT
-- pasaba en local y fallaba en produccion. Lo que cambia, y por que importa cada cosa:
--
--   1. vp_etiquetas_con_importados es una VISTA, no una tabla, y su rama de importados sale de
--      web.etiquetas_maestro_importados -- otro schema.
--   2. La vista TRUNCA la serie a los ultimos 9 digitos: `right(numero::text, 9)::integer`.
--      Las series reales son de 18 digitos EXACTOS (10371 filas, min = max = 18).
--      Consecuencia: el numero completo NUNCA matchea contra la columna `numero`, y ademas
--      tira 22003 (integer out of range) antes de leer una fila, porque la columna es int4.
--   3. El TIPO que emite es 'IMPORTADO', no 'IMPORT'. modules/circuitos/config.ts manda
--      'IMPORT', asi que el `AND ET.TIPO = $2` no matchea nunca. Ojo que son dos vocabularios
--      distintos: ve_productos_despacho.tipoproducfiscal SI dice 'IMPORT' (verificado: devuelve
--      COCINA / IMPORT / PEABODY / TERMO), asi que el listado de remitos esta bien y es solo el
--      maestro el que difiere.
--   4. La vista NO tiene columna control_final, y obtenerEtiquetasMaestroImportados la pide.
--      El dataset viejo la tenia inventada, asi que ese SELECT compilaba en local y en
--      produccion levanta 42703 (column does not exist).
--   5. Truncar a 9 digitos PIERDE UNICIDAD: 10371 series distintas colapsan en 9911 sufijos
--      (460 cruces). Las series completas, en cambio, son unicas 1 a 1. Por eso el fix pasa por
--      comparar la serie entera y no por normalizar el codigo escaneado a 9 digitos.
--
-- Las series de abajo son de 18 digitos como las reales, y hay un par que COLISIONA en sus
-- ultimos 9 digitos entre DOS PRODUCTOS DISTINTOS del mismo remito: es el caso que hace que
-- truncar despache el producto equivocado (el filtro por remito no lo salva si los dos
-- productos estan en el mismo remito).
--
-- PEABODY no esta en ningun maestro de etiquetas: esos productos no tienen numero de serie, su
-- EAN y DUN salen de V_UD_PRODUCTO.
-- ---------------------------------------------------------------------------
CREATE SCHEMA web;

CREATE TABLE web.etiquetas_maestro_importados (
  numero            bigint,
  idproducto        text,
  modelo            text,
  estado            integer,
  fecha             timestamp,
  ingreso_stock     boolean,
  fecha_paso_lector timestamp
);

-- El join de la vista es contra public.producto por CODIGO, no por id.
ALTER TABLE public.producto ADD COLUMN codigo text;
UPDATE public.producto SET codigo = '00012' WHERE id = '00000000-0000-0000-0000-000000000012';
UPDATE public.producto SET codigo = '00017' WHERE id = '00000000-0000-0000-0000-000000000017';

INSERT INTO web.etiquetas_maestro_importados
  (numero, idproducto, modelo, estado, fecha, ingreso_stock, fecha_paso_lector)
VALUES
  -- ANAFE IMPORTADO (producto ...012). Series de 18 digitos.
  (100000000000012345, '00012', 'ANAFE IMPORTADO 2H', 1, '2024-05-10', true, now()),
  (100000000000012346, '00012', 'ANAFE IMPORTADO 2H', 1, '2024-05-10', true, now()),
  (100000000000012347, '00012', 'ANAFE IMPORTADO 2H', 1, '2024-05-10', true, now()),
  (100000000000012348, '00012', 'ANAFE IMPORTADO 2H', 1, '2024-05-10', true, now()),
  (100000000000012349, '00012', 'ANAFE IMPORTADO 2H', 1, '2024-05-10', true, now()),

  -- COLISION DE SUFIJO entre dos productos del MISMO remito (0003500001327).
  -- Los dos terminan en 000999001 y difieren solo en los primeros 9 digitos, asi que la vista
  -- los colapsa en un unico `numero` = 999001 y el maestro devuelve DOS candidatos con
  -- producto_id distinto. escanearCircuito toma el primero que tenga cupo, o sea que se puede
  -- despachar el horno cuando se escaneo la cocina. Con la serie completa no pasa.
  (100000000000999001, '00012', 'ANAFE IMPORTADO 2H',     1, '2024-06-01', true, now()),
  (200000000000999001, '00017', 'HORNO EMPOTRABLE 60CM',  1, '2024-06-01', true, now()),

  -- Producto que no esta en ningun remito: para el 422 PRODUCT_NOT_IN_REMITO.
  (100000000000099999, '00099', 'PRODUCTO HUERFANO', 1, '2024-05-10', true, now()),

  -- Filtradas por la propia vista: estado <> 1 y fecha anterior al corte. No deben aparecer
  -- nunca en el maestro, y por lo tanto dan LABEL_NOT_FOUND.
  (100000000000088881, '00012', 'ANAFE IMPORTADO 2H', 0, '2024-05-10', true, now()),
  (100000000000088882, '00012', 'ANAFE IMPORTADO 2H', 1, '2021-12-31', true, now());

-- Producto huerfano: existe en el maestro pero en ningun remito.
INSERT INTO public.producto (id, unidadesporbulto, codigo)
  VALUES ('00000000-0000-0000-0000-0000000000ff', NULL, '00099');

-- Calcado de produccion (pg_views, 2026-09-16). La rama de vp_etiquetas cubre COCINA/TERMO y
-- aca queda vacia: en el entorno local ese maestro vive en SQL Server (init-mssql.sql).
CREATE TABLE public.vp_etiquetas (
  numero            integer,
  producto_id       uuid,
  producto_c        text,
  producto_n        text,
  tipo              text,
  ingreso_stock     boolean,
  fecha_paso_lector timestamp
);

-- NUMERO_COMPLETO es la unica columna agregada respecto de produccion, y es la que resuelve el
-- circuito IMPORT: `numero` viene truncado a 9 digitos y es int4, asi que comparar una serie de
-- 18 contra el da 22003. El CREATE OR REPLACE que la agrega en produccion esta en
-- migrations/002-numero-completo.sql; `numero` no cambia, el Delphi no se entera.
CREATE VIEW public.vp_etiquetas_con_importados AS
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

-- ---------------------------------------------------------------------------
-- Estado inicial del staging: deja algunos remitos a medias y otros completos.
-- Los itemremito_id son los reales, para que la vista de transaccion cruce bien.
-- ---------------------------------------------------------------------------
INSERT INTO public.aux_expedicion
  (id, es_despacho, remito_n, etiqueta, producto_n, remito_id, itemremito_id, producto_id)
VALUES
  -- R2 IMPORT: sus filas escaneadas van en aux_expedicion_circuitos (mas abajo), porque las
  -- series reales son de 18 digitos y no entran en el integer de esta tabla.
  --
  -- La fila HUERFANA de R2 si se queda aca, y a proposito: es una fila vieja, anterior a la
  -- separacion de tablas, y sirve para verificar que el conteo unificado las sigue viendo.

  -- R3 MIXTO: 1 cocina de 2, 1 termo de 2.
  (gen_random_uuid(), true, '0003400002829', 100001, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000013'),
  (gen_random_uuid(), true, '0003400002829', 200001, 'TERMOTANQUE 80L ELECTRICO',
   '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000014'),

  -- R4 COCINA completo: 2 de 2.
  (gen_random_uuid(), true, '0003400002830', 100010, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000013'),
  (gen_random_uuid(), true, '0003400002830', 100011, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000013'),

  -- R5 PEABODY: sus dos filas NO van aca sino en aux_expedicion_circuitos (mas abajo). El EAN de
  -- la pava tiene 13 digitos y esta tabla sigue teniendo `etiqueta` en integer, igual que
  -- produccion: no entran, el INSERT daria 22003.

  -- R6 MIXTO completo: 1 cocina 6h + 1 termo.
  (gen_random_uuid(), true, '0003400002831', 100020, 'COCINA 6 HORNALLAS ACERO 76CM',
   '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000015'),
  (gen_random_uuid(), true, '0003400002831', 200020, 'TERMOTANQUE 80L ELECTRICO',
   '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000014'),

  -- R8 remito grande: 5 de 12.
  (gen_random_uuid(), true, '0003400002833', 100030, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000013'),
  (gen_random_uuid(), true, '0003400002833', 100031, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000013'),
  (gen_random_uuid(), true, '0003400002833', 100032, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000013'),
  (gen_random_uuid(), true, '0003400002833', 100033, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000013'),
  (gen_random_uuid(), true, '0003400002833', 100034, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000013'),

  -- R2: una fila HUERFANA (itemremito_id NULL). Es la trampa operativa: aparece como N/0 en la
  -- lista de items y bloquea el confirmar para siempre, porque 0 nunca iguala a la cantidad.
  --
  -- La etiqueta queda en 12347 (5 digitos) y no en la serie real de 18: con la columna en
  -- integer es el unico largo que entra, y para este caso el valor es indistinto -- lo que se
  -- ejercita es el itemremito_id NULL. Al ampliar la columna, pasarla a 100000000000012347.
  (gen_random_uuid(), true, '0003500001325', 12347, 'ANAFE IMPORTADO 2H',
   '00000000-0000-0000-0000-000000000002', NULL, '00000000-0000-0000-0000-000000000012'),

  -- R7: una fila ya MIGRADA. "Borrar transaccion" no la toca (filtra migrado = false), asi que
  -- el remito no vuelve a cero.
  (gen_random_uuid(), true, '0003400002832', 100040, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000013');

UPDATE public.aux_expedicion SET migrado = true WHERE remito_n = '0003400002832';

-- ---------------------------------------------------------------------------
-- Staging de los circuitos nuevos. Mismas filas que arriba pero con los codigos REALES, que solo
-- entran aca: EAN de 13 digitos y series de 18.
--
-- El remito 0003500001325 queda repartido entre las dos tablas a proposito (la huerfana arriba,
-- las escaneadas aca): es el caso que verifica que el conteo unificado sume las dos.
-- ---------------------------------------------------------------------------
INSERT INTO public.aux_expedicion_circuitos
  (id, es_despacho, remito_n, etiqueta, producto_n, remito_id, itemremito_id, producto_id)
VALUES
  -- R2 IMPORT: 2 de 4 (mas la huerfana en la tabla vieja = 3 filas para ese remito).
  (gen_random_uuid(), true, '0003500001325', 100000000000012345, 'ANAFE IMPORTADO 2H',
   '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000012'),
  (gen_random_uuid(), true, '0003500001325', 100000000000012346, 'ANAFE IMPORTADO 2H',
   '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000012'),

  -- R5 PEABODY completo: 2 de 2, MISMO EAN dos veces (lo que solo el circuito nuevo permite).
  (gen_random_uuid(), true, '0004100000019', 7791234567891, 'PAVA ELECTRICA PEABODY PE-PE5000',
   '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000016'),
  (gen_random_uuid(), true, '0004100000019', 7791234567891, 'PAVA ELECTRICA PEABODY PE-PE5000',
   '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000016');

-- ---------------------------------------------------------------------------
-- INDICE DE CASOS
--
-- Remito          Tipo(s)              Avance   Que cubre
-- 0004100000018   PEABODY              0/3      vacio; escanear el mismo EAN 3 veces y llenarlo
-- 0003500001325   IMPORT               0/4 (*)  fila HUERFANA (N/0) que bloquea confirmar
-- 0003400002829   COCINA+TERMOTANQUE   2/4      remito mixto, una fila por tipo, ambos a medias
-- 0003400002830   COCINA               2/2      COMPLETO: check verde y al final de la lista
-- 0004100000019   PEABODY              0/2 (*)  deberia estar 2/2 con el mismo EAN repetido
-- 0003400002831   COCINA+TERMOTANQUE   2/2      COMPLETO y mixto: borrar transaccion alcanza a ambos
-- 0003400002832   COCINA               1/1      COMPLETO con la fila ya MIGRADA (borrar no la toca)
-- 0003400002833   COCINA               5/12     remito grande: ejercita el contador 1..8
-- 0003500001326   IMPORT+PEABODY       0/3      mixto entre DOS circuitos nuevos + consignacion
-- 0003400002834   COCINA               -        DEVOLUCION: no debe salir en ningun listado
-- 0003500001327   IMPORT               0/2      DOS productos IMPORT con series que colisionan
--                                               en sus ultimos 9 digitos (ver mas abajo)
--
-- (*) Estos dos remitos tienen menos avance del que deberian, y eso es el bug, no un descuido:
--     sus etiquetas (EAN de 13 digitos, series de 18) NO ENTRAN en `etiqueta integer`. Las
--     filas no se pueden ni sembrar. Al ampliar la columna en produccion, restaurarlas.
--
-- Codigos utiles:
--
--   PEABODY (sin serie: EAN y DUN son del producto, se repiten en todas las unidades)
--     cafetera  EAN 7791234567890   DUN 17791234567890  -> la caja trae 3
--     pava      EAN 7791234567891   DUN 17791234567891  -> la caja trae 2
--     Un DUN descuenta la caja entera; si no entra en lo que falta se rechaza completo.
--
--   IMPORT (una etiqueta por unidad, serie de 18 digitos)
--
--     Estas series NO se pueden despachar hoy, y ese es el punto del dataset. Fallan por tres
--     motivos distintos y encadenados, cada uno tapado por el anterior:
--
--       1. obtenerEtiquetasMaestroImportados pide ET.CONTROL_FINAL, y la vista NO tiene esa
--          columna -> 42703 (column does not exist). Ni siquiera llega a comparar.
--       2. Sacado eso, el TIPO de la vista es 'IMPORTADO' y config.ts manda 'IMPORT' -> 0 filas.
--       3. Y aun con el tipo correcto, `WHERE ET.NUMERO = $1` compara los 18 digitos contra una
--          columna int4 truncada a 9 -> 22003 (integer out of range).
--
--     100000000000012345, ...346, ...347, ...348, ...349   anafe, libres
--     100000000000999001   anafe   \  MISMO sufijo de 9 (000999001), productos DISTINTOS,
--     200000000000999001   horno   /  los dos en el remito 0003500001327.
--                                     Truncando, el maestro devuelve DOS candidatos y se
--                                     despacha el que tenga cupo: se puede cargar el horno
--                                     escaneando la cocina. Con la serie completa, no.
--     100000000000099999   producto que no esta en ningun remito -> 422
--     100000000000088881   estado <> 1     filtrada por la vista -> LABEL_NOT_FOUND
--     100000000000088882   fecha < corte   filtrada por la vista -> LABEL_NOT_FOUND
--
--     Ya no hay caso de CONTROL_FINAL: la vista real no expone esa columna, asi que los
--     circuitos nuevos no pueden validarla ni aunque se quisiera.
--
--   COCINA
--     100002, 100035..100039  libres;  100021  cocina 6H (remito 0003400002831)
--     100003                  CONTROL_FINAL = 0  -> 422 en despacho
--     100004                  CONTROL_FINAL NULL -> PASA (la validacion usa === false estricto)
--     100010, 100011, 100040  ya usadas
--
--   TERMOTANQUE
--     200001, 200003  libres;  200020  remito 0003400002831
--     100001          existe tambien como COCINA: es el caso de series que colisionan
--                     (en produccion hay ~20287 numeros en los dos tipos)
-- ---------------------------------------------------------------------------
