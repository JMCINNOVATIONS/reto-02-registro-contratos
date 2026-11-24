# Planteamiento de la Solución — Agente "Registro de Contratos Vigentes"

> **Proceso de Selección · Equipo Perxia 2.0 · Periferia IT Group**  
> **Candidato:** José Segundo Molina Cerpa  
> **Fecha:** 24 de noviembre de 2026  
> **Entregable:** Reto Técnico 02

---

## 1. El Problema en una Frase y a Quién le Duele

> **El congelamiento del maestro de contratos de Periferia IT Group desde mayo de 2026 debido a la dependencia de una persona y la ausencia de un canal centralizado dejó a la organización sin visibilidad de vencimientos y expuesta a graves riesgos legales y patrimoniales por pólizas no constituidas.**

### ¿A quién le duele?
1. **A la Gerencia General y Dirección de Operaciones:** No pueden responder con certeza qué contratos vencen en el trimestre, cuál es la cartera contratada activa ni planificar renovaciones o recursos de los proyectos.
2. **A la Analista Administrativa:** Carga con la responsabilidad de custodiar contratos y gestionar pólizas con los corredores de seguros sin tener un canal formal de recepción, recibiendo contratos de forma fragmentada únicamente cuando un comercial recuerda pedir póliza.
3. **A la Dirección Comercial y Clientes:** Riesgo de suspensión de facturación, multas contractuales o pérdida de relaciones corporativas por pólizas vencidas o contratos no regularizados oportunamente.

---

## 2. Arquitectura de la Solución

La solución se construyó siguiendo una estricta **arquitectura en capas desacoplada**, donde el comportamiento conversacional, el conocimiento de negocio y la ejecución determinista están radicalmente separados.

### 2.1 Diagrama de Componentes

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (web/)                                 │
│  - Historial de Chat        - Tarjetas de Tool Calls (CA4)             │
│  - Visor Maestro CSV        - Visor de Alertas (alertas.md)            │
│  - Banner Confirmación (CA3)- Auditoría Historial (historial.jsonl)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP REST / JSON
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     BACKEND EXPRESS (src/server.ts)                   │
│  - Ciclo del Agente (Tope 25 iteraciones)                             │
│  - Sesiones en Memoria y Manejo de Estado                             │
│  - Detección de Confirmación Humana                                   │
└───────────────┬────────────────────────────────────────┬───────────────┘
                │ Invocación                             │ Inferencia
                ▼                                        ▼
┌──────────────────────────────┐        ┌────────────────────────────────┐
│   HERRAMIENTAS (src/tools/)  │        │   ADAPTADOR LLM (src/llm/)     │
│  - contratos_leer_buzon      │        │  - GeminiProvider (Google)     │
│  - contratos_extraer         │        │  - OpenAIProvider (OpenAI)     │
│  - contratos_validar         │        │  - MockAgentProvider (Local)   │
│  - contratos_registrar       │        └────────────────────────────────┘
│  - contratos_alertas         │                         ▲
│  - contratos_leer_pdf        │                         │ Prompt & Reglas
└───────────────┬──────────────┘        ┌────────────────┴───────────────┐
                │                       │  CONOCIMIENTO Y COMPORTAMIENTO │
                │ I/O Archivos          │  - agent/prompt.md             │
                ▼                       │  - src/knowledge/registro.md   │
┌──────────────────────────────┐        └────────────────────────────────┘
│          STORAGE             │
│  fixtures/ (Solo Lectura)    │
│  out/sharepoint/ (Escritura) │
│  out/log.jsonl (Auditoría)   │
└──────────────────────────────┘
```

### 2.2 Separación Estricta de Responsabilidades
- **Comportamiento (`agent/prompt.md`):** Define el rol, restricciones operativas, directrices éticas y el flujo de confirmación humana obligatoria. Modificar la personalidad o estilo del agente no altera ninguna línea de código.
- **Conocimiento del Proceso (`src/knowledge/registro-contratos.md`):** Centraliza las reglas de negocio (RN1 a RN7), ciclo de vida de pólizas y especificaciones del esquema. Si una política comercial cambia, se actualiza la base de conocimiento sin alterar el servidor.
- **Ejecución y Reglas Deterministas (`src/tools/contratos.ts`):** Las herramientas tipadas con `zod` son la **única fuente de verdad autorizada**. El modelo nunca inventa ni calcula cifras; consume y presenta los resultados que las herramientas devuelven.
- **Adaptador de Proveedor LLM (`src/llm/`):** La interfaz común `LLMProvider` abstrae el motor subyacente. Se puede alternar entre Google Gemini, OpenAI o el motor autónomo determinista modificando una variable de entorno en `.env`.

---

## 3. Ciclo del Agente (Agent Loop)

El ciclo conversacional fue implementado en `src/server.ts` bajo cinco reglas cardinales de robustez:

1. **Tope de Iteraciones (CA1):** El bucle `while (iterations < maxIterations)` tiene un límite configurado en 25 iteraciones por turno. Si se alcanza, el agente resume el trabajo efectuado y reporta los pendientes, evitando bloqueos infinitos y costos no controlados.
2. **Veracidad Estricta / Grounding Invariante (CA2):** Las respuestas afirmativas del agente se fundamentan exclusivamente en las salidas de las herramientas. El prompt prohíbe inventar datos y el backend valida esquemas antes de registrar.
3. **Pausa para Confirmación Humana (CA3 / RN5):** Cuando `contratos_validar` detecta campos con índice de confianza < 0.8 (como el contrato marco por demanda `msg-006` con valor 0 y vigencia estimada), el agente **no registra automáticamente**. Detiene el ciclo, expone los campos dudosos y emite una pregunta explícita a la analista. Solo si el usuario responde afirmativamente, se invoca `contratos_registrar` con `confirmado = true`.
4. **Visibilidad Total y Trazabilidad (CA4 / RN7):** Cada invocación de herramienta se renderiza en el chat del usuario con sus argumentos y respuesta resumida, y se persiste de manera asíncrona e inmutable en `out/log.jsonl`.
5. **Tolerancia a Fallos y Aislamiento de Errores (CA5):** Un archivo con formato no contractual (como `msg-005` con cotización) o un remitente no reconocido no interrumpe el lote; se captura el error tipado `{ ok: true, data: { clasificacion: "rechazado", motivo: "..." } }` y el ciclo continúa fluidamente.

---

## 4. Elección del Modelo de Lenguaje

### 4.1 Proveedor y Modelo Seleccionado
- **Recomendado en Producción:** **Google Gemini 2.5 Flash** (`gemini-2.5-flash`).
- **Alternativa Compatible:** **OpenAI GPT-4o-mini** (`gpt-4o-mini`).
- **Motor de Respaldo Incluido:** **Perxia Autonomous Engine (Local / Determinista)**.

### 4.2 Justificación Técnica y de Negocio
- **Capacidades de Function Calling:** Gemini 2.5 Flash posee una tasa de precisión superior al 98% en estructuración de llamadas a herramientas complejas con validación Zod.
- **Ventana de Contexto y Latencia:** Con latencias de primer token inferiores a 600 ms y ventana de 1M tokens, procesa contratos extensos sin truncamiento.
- **Respaldo Local Sin Dependencias:** Para asegurar que la prueba técnica pueda evaluarse en cualquier máquina sin necesidad de configurar claves ni incurrir en costos de tarjeta, el sistema incluye un adaptador autónomo determinista que ejecuta exactamente el mismo flujo conversacional del agente.

### 4.3 Estimación de Costos por Caso Procesado
- **Tokens promedio por contrato:** ~1.200 tokens de entrada (instrucción + fragmentos de texto) y ~250 tokens de salida (llamadas a herramientas y respuestas estructuradas).
- **Tarifa Gemini 2.5 Flash:** \$0,075 por millón de tokens de entrada / \$0,30 por millón de salida.
- **Costo por contrato procesado:** **\$0,000165 USD** (~0.7 pesos colombianos).
- **Costo mensual estimado (100 contratos/mes):** **\$0,016 USD/mes**. Costo insignificante frente al beneficio de mitigar pólizas desiertas de cientos de millones de pesos.

---

## 5. Estrategia de Extracción y Cálculo de Confianza

### 5.1 Pipeline Híbrido de Extracción
La extracción no delega la lectura ciega al LLM (lo cual propicia alucinaciones numéricas). En su lugar, aplica una estrategia de **extracción determinista estructurada (P0)** respaldada por validación de confianza:

```
Texto Contrato (.txt) ──▶ Extracción Heurística Regex ──▶ Asignación de Confianza [0, 1] ──▶ contratos_validar ──▶ Decisión
```

1. **Partes Contractuales y País:**
   - Detección por expresiones regulares de razones sociales (`INDUSTRIAS DELTA`, `DISTRIBUIDORA CARIBE`, etc.).
   - Normalización de identificación fiscal (`nit_cliente`): remoción de puntos y dígito de verificación (`890.900.111-4` ➔ `890900111`).
   - Inferencia de código de país ISO (`CO`, `EC`, `PE`, `PA`, `HN`) según domicilio fiscal, tribunal competente y formato del identificador (RUC vs NIT).
2. **Valores Monetarios y Divisas:**
   - Parser multi-formato (`parseMonto`): maneja montos colombianos con punto de miles (`COP $265.000.000`), montos internacionales con coma y decimales (`USD 120,000.00`, `PEN 520,000.00`).
   - Identificación de contratos por demanda o marco sin cuantía fija: se asigna `valor = 0`, `valor_indeterminado = true` y **confianza = 0.5** (< 0.8).
3. **Plazos y Vigencias:**
   - Parser de fechas en español (`parseSpanishDate`): traduce expresiones jurídicas ("desde el primero (1) de agosto de 2026 hasta el treinta y uno (31) de julio de 2027") a formato ISO `YYYY-MM-DD`.
   - Plazos relativos ("duración de doce (12) meses contados a partir de su firma"): cuando la firma sólo indica el mes ("agosto de 2026"), se vincula a la fecha del correo de radicación (`2026-08-31`) y se marca con **confianza = 0.7** (< 0.8), disparando la revisión humana requerida.
4. **Pólizas y Garantías:**
   - Clasificación según cláusulas de garantías: `cumplimiento`, `responsabilidad_civil`, etc.
   - Contratos nuevos con póliza ingresan con `estado_poliza = "pendiente"`. Contratos sin póliza ingresan con `estado_poliza = "no_aplica"`.

---

## 6. Propuesta de Regla de Gobierno (Documentación Obligatoria)

### Política de Gobierno para la Recepción y Registro Maestro de Contratos
**Objetivo:** Garantizar que el 100% de los compromisos contractuales asumidos por Periferia IT Group ingresen al Registro Maestro dentro de las 24 horas siguientes a su perfeccionamiento, eliminando puntos ciegos operativos y riesgos aseguradores.

#### 1. Canal Único y Responsable
- Se establece el buzón exclusivo **`contratos@periferiaitgroup.com`** como único punto de entrada corporativo válido.
- La administración y custodia del buzón y del maestro en SharePoint queda bajo la titularidad de la **Coordinación Administrativa y Financiera**. Queda prohibido recibir contratos por chats privados o correos personales de colaboradores.

#### 2. Obligación del Equipo Comercial
- Todo Lead Comercial, Key Account Manager (KAM) o Gerente de Cuenta tiene la **obligación contractual y laboral** de radicar en el buzón:
  - Copia íntegra en PDF del contrato con firma de todas las partes.
  - Otrosíes, actas de inicio, adiciones presupuestales, suspensiones y actas de liquidación/terminación.
- **Plazo máximo:** Veinticuatro (24) horas hábiles posteriores a la firma del documento.
- **Formato del Asunto Obligatorio:**
  `[TIPO] - [CLIENTE] - [NÚMERO DE CONTRATO O DESCRIPCIÓN]`  
  *(Ejemplo: `CONTRATO - Industrias Delta S.A.S. - Implementación CRM CT-2026-015`)*.

#### 3. Acuse Automático y Trazabilidad
- Al recibir el correo, el Agente Perxia emitirá en un tiempo no mayor a tres (3) minutos un acuse de recibo automático al comercial remitente indicando:
  - Número de radicación asignado y clasificación (`Nuevo`, `Actualización`, `Duplicado`, `Rechazado`).
  - Extracto de datos registrados (Cliente, Objeto, Valor, Fechas).
  - Estado de requerimiento de pólizas (notificando si se inicia gestión con el corredor de seguros).
  - Alerta de campos dudosos o pendientes de validación si aplica.

#### 4. Excepciones, Inconsistencias y Escalamiento
- **Contratos sin firma o incompletos:** El agente clasifica como `Rechazado`, notifica al comercial con copia al Director de Área y suspende la radicación.
- **Contratos con valor indeterminado / por demanda:** Requieren confirmación obligatoria de la analista administrativa previa consulta con la gerencia de cuenta.
- **Sanción / Control de Facturación:** Contrato que no cuente con registro formal en el Maestro de SharePoint **no podrá ser habilitado en el sistema contable para emisión de órdenes de compra ni facturas de cobro**.

#### 5. Cierre de la Brecha Histórica (Campaña Junio – Agosto 2026)
- Se ejecutará una **Campaña de Amnistía y Saneamiento Contractual** de dos (2) semanas:
  - Cruce masivo automatizado entre las facturas emitidas por Periferia entre el 1 de junio y el 31 de agosto de 2026 contra el maestro congelado.
  - Generación de lista de contratos faltantes y notificación inmediata a cada KAM responsable con fecha perentoria de carga de 5 días hábiles.
  - El Agente procesará el lote retroactivo marcando la fuente como `migracion` con trazabilidad completa en el historial.

#### 6. Indicador de Control Mensual (KPI)
- **Métrica Principal:** `% de Cobertura Contractual en Facturación (CCF)`
  $$\text{CCF} = \left( \frac{\text{Número de facturas emitidas asociadas a un contrato vigente en el maestro}}{\text{Total de facturas emitidas en el mes}} \right) \times 100$$
- **Meta:** $\ge 98\%$.
- **Reporte:** Presentación mensual automática a Junta Directiva y Gerencia General.

---

## 7. Decisiones y Trade-offs

| # | Decisión Adoptada | Alternativa Descartada | Justificación del Trade-off |
|---|---|---|---|
| **1** | **Extracción Híbrida Determinista + Confianza Zod** | Extracción 100% generativa con prompting libre al LLM | La extracción pura con LLM genera alucinaciones en valores numéricos y variaciones en fechas legales. Al usar heurísticas tipadas con fallback de confianza, el 100% de los valores asentados en el maestro provienen de código determinista auditado. |
| **2** | **Frontend Ligero Nativo (HTML5/CSS3/ES6)** | SPA complejo en React/Next.js con bundle Webpack | Next.js añade dependencias pesadas, compilación lenta y posibles fallos de empaquetado en Windows. El front nativo inicia en < 1 segundo, no requiere build previo y es 100% reactivo con diseño profesional. |
| **3** | **Persistencia Inmutable en SharePoint Simulado (`CSV` + `JSONL`)** | Base de datos SQLite / PostgreSQL | El PRD estipula cero bases de datos ("el maestro es un CSV, SharePoint es una carpeta local"). El uso de `maestro-contratos.csv` y `historial.jsonl` asegura cero dependencias externas, total fidelidad al fixture y portabilidad absoluta. |

---

## 8. Supuestos Asumidos

1. **Naturaleza de los Documentos:** Se asumió que los contratos entrantes cuentan con texto nativo legible (`contrato.txt` en fixtures). En producción se integrará OCR para escaneos físicos.
2. **Remitentes Comerciales Desconocidos:** Un remitente que no exista en `comerciales.json` (como Julián Pérez en `msg-006`) se registra como comercial con su nombre/correo y se alerta en el log, pero no bloquea el proceso si los demás datos son válidos.
3. **Inmutabilidad de Fixtures:** El archivo original `fixtures/reto-02/maestro-contratos.csv` es estrictamente de solo lectura; la aplicación opera sobre `out/sharepoint/maestro-contratos.csv` replicándolo en el primer arranque.

---

## 9. Matriz de Cobertura de Requisitos e Historias de Usuario

| ID | Historia de Usuario | Estado | Implementación / Evidencia |
|---|---|---|---|
| **HU-1** | Leer el buzón | **HECHO** | Herramienta `contratos_leer_buzon` clasifica los 6 mensajes de fixtures, detecta adjuntos y rechaza correos sin contrato (`msg-005`). |
| **HU-2** | Extraer datos del contrato | **HECHO** | Herramienta `contratos_extraer` parsea partes, identificaciones fiscales, objeto (≤200 chars), valores y calcula confianza por campo. |
| **HU-3** | Validar y clasificar | **HECHO** | Herramienta `contratos_validar` clasifica exactamente según RN1 a RN4 (`msg-001/002`: nuevo, `msg-003`: actualización, `msg-004`: duplicado, `msg-005`: rechazado, `msg-006`: nuevo con revisión). |
| **HU-4** | Registrar y archivar | **HECHO** | Herramienta `contratos_registrar` asienta filas en CSV, copia documentos a `out/sharepoint/Contratos/<año>/<slug>/...`, audita en `historial.jsonl` y marca procesados. |
| **HU-5** | Alertar sobre riesgos | **HECHO** | Herramienta `contratos_alertas` genera `out/alertas.md` con 2 contratos por vencer (≤ 60 días), 2 pólizas pendientes y 4 contratos recuperados. |
| **HU-6** | Manejo de errores | **HECHO** | Respuestas tipadas `{ ok: false, error }`, sin caídas del proceso ante mensajes anómalos. |
| **BONUS**| Módulo Reutilizable | **HECHO** | Carpeta `modulo/` con `agent.md`, `tools/contratos.ts` y `skill/registro-contratos/SKILL.md` (+10 puntos). |

---

## 10. Declaración de Uso de Asistentes de IA

En cumplimiento con la sección 0 y 9.1 del reto técnico:
- **Asistentes Utilizados:** **Google Antigravity** con **Gemini 3.8 Flash**.
- **Tareas en las que se utilizó:**
  1. Asistencia en generación rápida de estructuras TypeScript tipadas para el adaptador LLM y esquemas Zod.
  2. Co-redacción del frontend interactivo (HTML/CSS) y tableros visuales de SharePoint.
  3. Formulación y estructuración de la propuesta de regla de gobierno corporativo.
- **Propuestas Descartadas y Motivo:**
  - *Descartada:* Se propuso inicialmente usar bibliotecas externas pesadas como LangChain o LlamaIndex para orquestar el agente. Se descartó rotundamente por introducir dependencias frágiles, sobrecosto computacional y perder control fino sobre el bucle determinista de herramientas y el límite de 25 iteraciones.
  - *Descartada:* Se sugirió usar SQLite para almacenar el maestro. Se descartó de inmediato por contradecir el requerimiento de representar SharePoint con archivos planos CSV y JSONL.

---

## 11. Riesgos en Producción y Plan de Mitigación

1. **Riesgo: Documentos escaneados como imagen sin texto (PDF rasterizado)**
   - *Mitigación:* Incorporar en producción un paso previo de OCR con Google Document AI o Tesseract antes de invocar `contratos_extraer`.
2. **Riesgo: Variaciones o ambigüedades jurídicas en contratos no estándar**
   - *Mitigación:* La regla de negocio RN5 y el ciclo CA3 obligan a que cualquier campo con confianza < 0.8 se detenga y solicite confirmación humana explícita antes de tocar el maestro.
3. **Riesgo: Falsos duplicados por razones sociales abreviadas**
   - *Mitigación:* La deduplicación se realiza primordialmente por número de identificación tributaria depurado (`nit_cliente` sin dígito de verificación ni puntos), complementado con similitud semántica en el objeto.
