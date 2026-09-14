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
  etiqueta       bigint,
  producto_n     text,
  remito_id      uuid,
  itemremito_id  uuid,
  producto_id    uuid,
  fechahora      timestamp NOT NULL DEFAULT now(),
  migrado        boolean NOT NULL DEFAULT false
);

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
  ('00000000-0000-0000-0000-0000000000a5', '', '', '');                  -- cocina 6h

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
   'PAVA ELECTRICA PEABODY PE-PE5000 1.7L');

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
   '00000000-0000-0000-0000-000000000013', 1, '0003400002834', 'DEVOLUCIONES SA');

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
  ('00000000-0000-0000-0000-000000000010', '0003400002834', 'DEVOLUCIONES SA',              '00000000-0000-0000-0000-0000000000ca', 'COCINA',      false, false);

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
-- Maestro de etiquetas de importados y Peabody (Postgres).
-- Mismas columnas que dbo.etiquetas_expedicion en SQL Server.
-- ---------------------------------------------------------------------------
CREATE TABLE public.vp_etiquetas_con_importados (
  numero            bigint,
  tipo              text,
  producto_id       uuid,
  producto_n        text,
  ingreso_stock     boolean,
  fecha_paso_lector timestamp,
  control_final     boolean
);

INSERT INTO public.vp_etiquetas_con_importados
  (numero, tipo, producto_id, producto_n, ingreso_stock, fecha_paso_lector, control_final)
VALUES
  -- PEABODY NO esta aca: esos productos no tienen numero de serie ni maestro de etiquetas, su
  -- EAN y DUN salen de V_UD_PRODUCTO. Tenerlos en esta vista era una suposicion equivocada.
  -- IMPORT: una etiqueta por unidad.
  (12345, 'IMPORT', '00000000-0000-0000-0000-000000000012', 'ANAFE IMPORTADO 2H', true, now(), true),
  (12346, 'IMPORT', '00000000-0000-0000-0000-000000000012', 'ANAFE IMPORTADO 2H', true, now(), true),
  (12347, 'IMPORT', '00000000-0000-0000-0000-000000000012', 'ANAFE IMPORTADO 2H', true, now(), true),
  (12348, 'IMPORT', '00000000-0000-0000-0000-000000000012', 'ANAFE IMPORTADO 2H', true, now(), true),
  (12349, 'IMPORT', '00000000-0000-0000-0000-000000000012', 'ANAFE IMPORTADO 2H', true, now(), true),
  -- Etiqueta cuyo producto no esta en ningun remito: para el 422 PRODUCT_NOT_IN_REMITO.
  (99999, 'IMPORT', '00000000-0000-0000-0000-0000000000ff', 'PRODUCTO HUERFANO', true, now(), true),
  -- Importado con CONTROL_FINAL en false: los circuitos nuevos NO lo validan, asi que debe
  -- poder despacharse igual.
  (12350, 'IMPORT', '00000000-0000-0000-0000-000000000012', 'ANAFE IMPORTADO 2H', true, now(), false);

-- ---------------------------------------------------------------------------
-- Estado inicial del staging: deja algunos remitos a medias y otros completos.
-- Los itemremito_id son los reales, para que la vista de transaccion cruce bien.
-- ---------------------------------------------------------------------------
INSERT INTO public.aux_expedicion
  (id, es_despacho, remito_n, etiqueta, producto_n, remito_id, itemremito_id, producto_id)
VALUES
  -- R2 IMPORT: 2 de 4.
  (gen_random_uuid(), true, '0003500001325', 12345, 'ANAFE IMPORTADO 2H',
   '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000012'),
  (gen_random_uuid(), true, '0003500001325', 12346, 'ANAFE IMPORTADO 2H',
   '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000012'),

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

  -- R5 PEABODY completo: 2 de 2, MISMO EAN dos veces (lo que solo el circuito nuevo permite).
  (gen_random_uuid(), true, '0004100000019', 7791234567891, 'PAVA ELECTRICA PEABODY PE-PE5000',
   '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000016'),
  (gen_random_uuid(), true, '0004100000019', 7791234567891, 'PAVA ELECTRICA PEABODY PE-PE5000',
   '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000016'),

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
  (gen_random_uuid(), true, '0003500001325', 12347, 'ANAFE IMPORTADO 2H',
   '00000000-0000-0000-0000-000000000002', NULL, '00000000-0000-0000-0000-000000000012'),

  -- R7: una fila ya MIGRADA. "Borrar transaccion" no la toca (filtra migrado = false), asi que
  -- el remito no vuelve a cero.
  (gen_random_uuid(), true, '0003400002832', 100040, 'COCINA 4H BLANCA 56CM',
   '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000013');

UPDATE public.aux_expedicion SET migrado = true WHERE remito_n = '0003400002832';

-- ---------------------------------------------------------------------------
-- INDICE DE CASOS
--
-- Remito          Tipo(s)              Avance   Que cubre
-- 0004100000018   PEABODY              0/3      vacio; escanear el mismo EAN 3 veces y llenarlo
-- 0003500001325   IMPORT               3/4      a medias + fila HUERFANA (N/0) que bloquea confirmar
-- 0003400002829   COCINA+TERMOTANQUE   2/4      remito mixto, una fila por tipo, ambos a medias
-- 0003400002830   COCINA               2/2      COMPLETO: check verde y al final de la lista
-- 0004100000019   PEABODY              2/2      COMPLETO con el mismo EAN repetido
-- 0003400002831   COCINA+TERMOTANQUE   2/2      COMPLETO y mixto: borrar transaccion alcanza a ambos
-- 0003400002832   COCINA               1/1      COMPLETO con la fila ya MIGRADA (borrar no la toca)
-- 0003400002833   COCINA               5/12     remito grande: ejercita el contador 1..8
-- 0003500001326   IMPORT+PEABODY       0/3      mixto entre DOS circuitos nuevos + consignacion
-- 0003400002834   COCINA               -        DEVOLUCION: no debe salir en ningun listado
--
-- Etiquetas utiles:
--   PEABODY  7791234567890  cafetera (remito 0004100000018)
--   PEABODY  7791234567891  pava (remito 0004100000019 y 0003500001326)
--   IMPORT   12347..12349   anafes libres para cargar
--   IMPORT   12350          CONTROL_FINAL = false: los circuitos nuevos lo permiten igual
--   IMPORT   99999          producto que no esta en ningun remito -> 422
--   COCINA   100001..100003 (100003 sin control final -> 422 en despacho)
--   TERMO    100001, 200002 (100001 colisiona con cocina: mismo numero, otro tipo)
-- ---------------------------------------------------------------------------
