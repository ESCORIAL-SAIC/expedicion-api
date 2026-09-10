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
CREATE TABLE public.v_ud_producto (
  id             uuid PRIMARY KEY,
  descripcionapp text
);

CREATE TABLE public.v_producto (
  id              uuid PRIMARY KEY,
  boextension_id  uuid REFERENCES public.v_ud_producto(id),
  descripcion     text
);

INSERT INTO public.v_ud_producto (id, descripcionapp) VALUES
  ('00000000-0000-0000-0000-0000000000a1', ''),                  -- peabody: sin descripcion corta
  ('00000000-0000-0000-0000-0000000000a2', ''),                  -- importado: idem
  ('00000000-0000-0000-0000-0000000000a3', 'COCINA 4H BLANCA'),  -- cocina: si tiene
  ('00000000-0000-0000-0000-0000000000a4', 'TERMOTANQUE 80L'),   -- termo: si tiene
  ('00000000-0000-0000-0000-0000000000a5', ''),                  -- cocina 6h: sin descripcion corta
  ('00000000-0000-0000-0000-0000000000a6', '');                  -- pava electrica peabody

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
-- Listados de remitos: tabla base + las dos vistas que usa la API.
--   vp_itemremito            -> despacho / devolucion (circuito clasico)
--   ve_items_remito_despacho -> circuitos IMPORT / PEABODY
-- ---------------------------------------------------------------------------
CREATE TABLE public._items_remito_base (
  remito_n          text,
  cliente_n         text,
  remito_id         uuid,
  cliente_id        uuid,
  tipo              text,
  consignacion      boolean,
  permite_despacho  boolean
);

INSERT INTO public._items_remito_base
  (remito_n, cliente_n, remito_id, cliente_id, tipo, consignacion, permite_despacho)
VALUES
  ('0004100000018', 'CASA CENTRAL PEABODY SA',      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'PEABODY',     false, true),
  ('0003500001325', 'DISTRIBUIDORA IMPORTADOS SRL', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'IMPORT',      false, true),
  ('0003400002829', 'ELECTRO HOGAR SA',             '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c3', 'COCINA',      false, true),
  ('0003400002829', 'ELECTRO HOGAR SA',             '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c3', 'TERMOTANQUE', false, true),
  ('0003400002830', 'CADENA BLANCA SRL',            '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c4', 'COCINA',      false, true),
  ('0004100000019', 'SUCURSAL NORTE PEABODY',       '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c5', 'PEABODY',     false, true),
  ('0003400002831', 'MAYORISTA SUR SA',             '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000c6', 'COCINA',      false, true),
  ('0003400002831', 'MAYORISTA SUR SA',             '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000c6', 'TERMOTANQUE', false, true),
  ('0003400002832', 'CLIENTE MINORISTA',            '00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000c7', 'COCINA',      false, true),
  ('0003400002833', 'CADENA NACIONAL SA',           '00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000c8', 'COCINA',      false, true),
  -- Remito en consignacion (la regla consignacion/venta no esta implementada, ni aca ni en el
  -- Delphi: el campo viaja como informativo).
  ('0003500001326', 'IMPORTADORA MIXTA SA',         '00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000c9', 'IMPORT',      true,  true),
  ('0003500001326', 'IMPORTADORA MIXTA SA',         '00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000c9', 'PEABODY',     true,  true),
  -- Devolucion: no aparece en ningun listado de despacho.
  ('0003400002834', 'DEVOLUCIONES SA',              '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000ca', 'COCINA',      false, false);

CREATE VIEW public.vp_itemremito AS
  SELECT remito_n, cliente_n, remito_id, cliente_id, tipo, consignacion, permite_despacho
  FROM public._items_remito_base;

CREATE VIEW public.ve_items_remito_despacho AS
  SELECT remito_n, cliente_n, remito_id, cliente_id, tipo, consignacion, permite_despacho
  FROM public._items_remito_base;

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
  -- PEABODY: un EAN por producto, repetido en todas sus unidades (no hay numero de serie).
  (7791234567890, 'PEABODY', '00000000-0000-0000-0000-000000000011', 'CAFETERA PEABODY PE-CT4201', true, now(), NULL),
  (7791234567891, 'PEABODY', '00000000-0000-0000-0000-000000000016', 'PAVA ELECTRICA PEABODY PE-PE5000', true, now(), NULL),
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
