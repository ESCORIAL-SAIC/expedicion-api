-- Maestro de etiquetas de Suipacha (SQL Server) para el entorno de prueba.
--
-- Los tipos SON los de produccion: leidos de sys.columns el 2026-09-22. La version anterior de
-- este archivo los habia inventado a partir de lo que parecia razonable, y erraba en lo que mas
-- importa (ver CONTROL_FINAL abajo).
--
-- Este maestro es el que usa el circuito viejo (/despacho, /devolucion) para COCINA y
-- TERMOTANQUE. Los circuitos IMPORT / PEABODY leen el suyo de Postgres.
CREATE DATABASE Etiquetas;
GO

USE Etiquetas;
GO

-- TODAS las columnas son varchar(50), incluida NUMERO. No hay tipos numericos ni datetime ni
-- uniqueidentifier: la tabla guarda todo como texto.
--
-- Las dos excepciones son LIBERADO (bit) y CONTROL_FINAL (int), y la segunda importa:
--
--   El driver mssql mapea `int` a number, asi que CONTROL_FINAL llega como 0 / 1 / null, NUNCA
--   como boolean. El chequeo de escaneo/service.ts es `controlFinal === false`, y en JavaScript
--   `0 === false` es false. O sea que en produccion la validacion NO_FINAL_CONTROL no dispara
--   nunca: una cocina sin control final se despacha igual.
--
--   Con `bit` --que es lo que decia este archivo antes-- el driver devuelve boolean, la
--   validacion funciona, y el entorno local mostraba un comportamiento que produccion no tiene.
--
--   Se deja en int a proposito, que es lo real. El fix del chequeo va aparte.
CREATE TABLE dbo.etiquetas_expedicion (
  NUMERO            varchar(50),
  PRODUCTO_ID       varchar(50),
  PRODUCTO_N        varchar(50),
  TIPO              varchar(50),
  PRODUCTO_C        varchar(50),
  Ingreso_stock     varchar(50),
  Fecha_Paso_lector varchar(50),
  CODIGO_CALIPSO    varchar(50),
  LIBERADO          bit,
  CONTROL_FINAL     int
);
GO

-- PRODUCTO_ID es varchar y del lado Postgres es uuid: el service compara los dos como string
-- (productosRemito.productoId === maestro.productoId). Se siembran en minuscula y con guiones,
-- que es como los devuelve Postgres; si en produccion estuvieran en mayuscula o entre llaves
-- --formato Delphi-- ningun escaneo de cocina matchearia, asi que el formato real es este.
INSERT INTO dbo.etiquetas_expedicion
  (NUMERO, PRODUCTO_ID, PRODUCTO_N, TIPO, PRODUCTO_C, Ingreso_stock, Fecha_Paso_lector, CODIGO_CALIPSO, LIBERADO, CONTROL_FINAL)
VALUES
  -- COCINA 4 hornallas: series unicas por unidad, con control final.
  ('100001', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100002', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),

  -- CONTROL_FINAL = 0. En produccion se despacha IGUAL, porque `0 === false` es false en JS.
  -- Es el caso que demuestra que la validacion esta muerta; con el fix, debe dar 422.
  ('100003', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 0),

  -- CONTROL_FINAL NULL: pasa, y eso SI es fidelidad al Delphi (el `=== false` estricto deja
  -- pasar el NULL a proposito).
  ('100004', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, NULL),

  -- Ya escaneadas en el dataset inicial.
  ('100010', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100011', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100030', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100031', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100032', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100033', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100034', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100040', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),

  -- Libres para completar el remito grande.
  ('100035', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100036', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100037', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100038', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),
  ('100039', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 'COCINA', '00013', '1', '20260101120000', NULL, 1, 1),

  -- COCINA 6 hornallas.
  ('100020', '00000000-0000-0000-0000-000000000015', 'COCINA 6 HORNALLAS ACERO 76CM', 'COCINA', '00015', '1', '20260101120000', NULL, 1, 1),
  ('100021', '00000000-0000-0000-0000-000000000015', 'COCINA 6 HORNALLAS ACERO 76CM', 'COCINA', '00015', '1', '20260101120000', NULL, 1, 1),

  -- TERMOTANQUE. 100001 existe en los DOS tipos a proposito: las series son independientes por
  -- tipo y colisionan (en produccion hay ~20287 numeros en ambos). El TIPO desambigua en el
  -- maestro, pero aux_expedicion no tiene columna tipo, asi que el chequeo de "ya despachada"
  -- los confunde. Bug preexistente, visible con este dato.
  ('100001', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 'TERMOTANQUE', '00014', '1', '20260101120000', NULL, 1, 1),
  ('200001', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 'TERMOTANQUE', '00014', '1', '20260101120000', NULL, 1, 1),
  ('200003', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 'TERMOTANQUE', '00014', '1', '20260101120000', NULL, 1, 1),
  ('200020', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 'TERMOTANQUE', '00014', '1', '20260101120000', NULL, 1, 1);
GO
