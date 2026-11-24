---
name: registro-contratos
description: "Reglas de negocio, clasificación de contratos, políticas de pólizas y gobierno para Periferia IT Group"
---

# Conocimiento del Proceso: Registro de Contratos Vigentes (Periferia IT Group)

## 1. Contexto y Propósito
El Registro Maestro de Contratos de Periferia IT Group contiene la relación oficial de clientes, compromisos contractuales, vigencias, valores y pólizas requeridas.
Tras un congelamiento del registro al 30 de mayo de 2026, este proceso actúa como buzón único centralizado para garantizar que el 100% de los contratos suscritos ingresen oportunamente, sin importar si requieren o no póliza de seguro.

## 2. Esquema de Datos del Maestro
Cada contrato registrado cuenta con las siguientes columnas normalizadas:

- `id_contrato`: Código oficial del contrato (ej. `CT-2026-015`, `CM-2026-03`). Si no tiene numeración explícita, se genera `AUTO-<año>-<secuencia>`.
- `cliente`: Razón social completa del cliente contratante (ej. `Industrias Delta S.A.S.`).
- `nit_cliente`: Identificación fiscal depurada, sin puntos ni dígito de verificación (ej. `890900111`, `1790012345001`, `20512345678`).
- `pais`: Código ISO del país de ejecución (`CO`, `EC`, `PE`, `PA`, `HN`).
- `objeto`: Descripción suscinta de los servicios contratados (máximo 200 caracteres).
- `valor`: Importe numérico sin separadores decimales ni de miles. Para contratos por demanda o marco sin monto fijo, el valor registrado es `0`.
- `moneda`: Código de divisa oficial (`COP`, `USD`, `PEN`, `PAB`, `HNL`).
- `fecha_inicio`: Fecha de inicio en formato `YYYY-MM-DD`.
- `fecha_fin`: Fecha de vencimiento o terminación en formato `YYYY-MM-DD`. Puede calcularse a partir del plazo acordado.
- `requiere_poliza`: Booleano (`true` / `false`) indicando si el contrato exige constitución de pólizas/garantías.
- `tipo_poliza`: Tipos de pólizas exigidas separadas por punto y coma (ej. `cumplimiento`, `cumplimiento;responsabilidad_civil`). Vacío si no aplica.
- `estado_poliza`: Estado operativo de la garantía (`vigente`, `pendiente`, `vencida`, `no_aplica`). Todo nuevo contrato que requiera póliza ingresa en estado `pendiente` hasta ser constituida por el corredor.
- `comercial`: Nombre completo del comercial responsable, validado contra el maestro comercial (`comerciales.json`).
- `ruta_sharepoint`: Ruta relativa donde queda resguardado el documento en repositorio (`Contratos/<año>/<cliente-slug>/<id_contrato>.<ext>`).
- `fecha_registro`: Fecha en que el contrato es asentado en el maestro (`YYYY-MM-DD`).
- `fuente`: Origen del registro (`buzon`, `manual`, `migracion`).

## 3. Reglas de Negocio (RN)
- **RN1 (Duplicado)**: Si el `id_contrato` ya existe en el maestro y coinciden exactamente `valor`, `fecha_inicio` y `fecha_fin`, se cataloga como duplicado. No se altera el maestro y se notifica al usuario.
- **RN2 (Actualización / Otrosí)**: Si el `id_contrato` existe (o hay coincidencia de `nit_cliente` y similitud de objeto ≥ 0.90) y presenta cambios en valores, fechas o es un Otrosí explícito, se actualiza la fila correspondiente en el maestro y se audita el detalle en `out/sharepoint/historial.jsonl`.
- **RN3 (Nuevo)**: Si el contrato no tiene registro previo ni duplicidad, se inserta una nueva fila en el maestro y se archiva el archivo en SharePoint.
- **RN4 (Rechazado)**: Correos que no contengan contratos (ej. cotizaciones, consultas, facturas sin contrato) o cuyos textos carezcan de partes u objeto identificables se marcan como rechazados con el motivo respectivo.
- **RN5 (Revisión Humana Obligatoria)**: Cualquier campo con índice de confianza inferior a 0.80 (como montos indeterminados o fechas estimadas a partir de referencias relativas) bloquea el registro automático y exige confirmación explícita de la analista.
- **RN6 (Inmutabilidad de Fixtures)**: La plantilla base `fixtures/reto-02/maestro-contratos.csv` es de estricta lectura. El sistema opera sobre `out/sharepoint/maestro-contratos.csv`.
- **RN7 (Trazabilidad y Auditoría)**: Cada invocación de herramienta se registra cronológicamente en `out/log.jsonl`.

## 4. Clasificación y Ciclo de Pólizas
- Contratos con póliza exigida nacen en estado `pendiente` y deben integrarse en los reportes de alertas de riesgo hasta que la aseguradora radique el certificado oficial.
- Contratos sin cláusula de póliza se registran con `estado_poliza = no_aplica` y `tipo_poliza = ""`.

## 5. Reporte de Alertas
El reporte de alertas emitido en `out/alertas.md` agrupa tres dimensiones de control:
1. **Vencimientos próximos (≤ 60 días)**: Contratos cuya `fecha_fin` expira en 60 días o menos respecto a la fecha de corte.
2. **Pólizas pendientes**: Contratos que requieren póliza pero aún no están vigentes.
3. **Cierre de Brecha Histórica**: Contratos radicados desde el 30 de mayo de 2026.
