-- Maestro de etiquetas de Suipacha (SQL Server) para el entorno de prueba.
--
-- ATENCION: reconstruido a partir de las columnas que pide obtenerEtiquetasMaestro
-- (src/modules/escaneo/repository.ts:37-58). NO es el esquema real de produccion.
--
-- Este maestro es el que usa el circuito viejo (/despacho, /devolucion) para COCINA y
-- TERMOTANQUE. Los circuitos IMPORT / PEABODY leen el suyo de Postgres.
CREATE DATABASE Etiquetas;
GO

USE Etiquetas;
GO

CREATE TABLE dbo.etiquetas_expedicion (
  NUMERO            bigint,
  TIPO              nvarchar(50),
  PRODUCTO_ID       uniqueidentifier,
  PRODUCTO_N        nvarchar(200),
  Ingreso_stock     bit,
  Fecha_Paso_lector datetime,
  CONTROL_FINAL     bit
);
GO

INSERT INTO dbo.etiquetas_expedicion
  (NUMERO, TIPO, PRODUCTO_ID, PRODUCTO_N, Ingreso_stock, Fecha_Paso_lector, CONTROL_FINAL)
VALUES
  -- COCINA 4 hornallas: series unicas por unidad, con control final.
  (100001, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100002, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  -- Sin control final: /despacho debe rechazarla (422 NO_FINAL_CONTROL).
  (100003, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 0),
  -- CONTROL_FINAL NULL: la validacion usa `=== false` estricto, asi que NULL PASA. Es fidelidad
  -- al Delphi, y conviene tenerlo cubierto para que el comportamiento quede visible.
  (100004, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), NULL),
  -- Ya escaneadas en el dataset inicial (remitos 0003400002829, 0003400002830, 0003400002833).
  (100010, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100011, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100030, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100031, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100032, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100033, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100034, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100040, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  -- Libres para cargar en el remito grande 0003400002833 (le faltan 7).
  (100035, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100036, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100037, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100038, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  (100039, 'COCINA', '00000000-0000-0000-0000-000000000013', 'COCINA 4H BLANCA 56CM', 1, GETDATE(), 1),
  -- COCINA 6 hornallas (remito 0003400002831).
  (100020, 'COCINA', '00000000-0000-0000-0000-000000000015', 'COCINA 6 HORNALLAS ACERO 76CM', 1, GETDATE(), 1),
  (100021, 'COCINA', '00000000-0000-0000-0000-000000000015', 'COCINA 6 HORNALLAS ACERO 76CM', 1, GETDATE(), 1),

  -- TERMOTANQUE. Ojo: 100001 existe en COCINA y en TERMOTANQUE a proposito -- las series de
  -- los dos tipos son independientes y colisionan (en produccion, 20287 numeros estan en ambos).
  -- El TIPO desambigua en el maestro, pero aux_expedicion NO tiene columna tipo, asi que el
  -- chequeo de "ya despachada" confunde los dos. Bug preexistente, visible con este dato.
  (100001, 'TERMOTANQUE', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 1, GETDATE(), 1),
  (200001, 'TERMOTANQUE', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 1, GETDATE(), 1),
  (200002, 'TERMOTANQUE', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 1, GETDATE(), 1),
  (200003, 'TERMOTANQUE', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 1, GETDATE(), 1),
  (200020, 'TERMOTANQUE', '00000000-0000-0000-0000-000000000014', 'TERMOTANQUE 80L ELECTRICO', 1, GETDATE(), 1);
GO
