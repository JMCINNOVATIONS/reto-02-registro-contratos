# Agente Conversacional: Registro de Contratos Vigentes

> **Equipo Perxia 2.0 · Periferia IT Group**  
> **Reto Técnico 02** · Candidato: José Segundo Molina Cerpa

Este proyecto implementa un **agente conversacional autónomo de extremo a extremo** para centralizar la recepción, extracción, clasificación y registro de contratos comerciales en Periferia IT Group, garantizando la integridad del maestro en SharePoint, el control de pólizas exigidas y la emisión de alertas tempranas de vencimiento.

---

## 🚀 Inicio Rápido en Local (Un Solo Comando)

### Prerrequisitos
- **Node.js 20+** (probado y optimizado en Node v26) o **Bun**.

### 1. Clonar o Abrir el Proyecto
```bash
cd reto-02
```

### 2. Instalar Dependencias
```bash
npm install --ignore-scripts
```

### 3. Ejecutar la Demo Determinista (Sin Modelo ni Claves)
Procesa en orden los 6 mensajes del buzón, detiene `msg-006` en la primera pasada por baja confianza, lo confirma en la segunda y genera `out/alertas.md`:
```bash
npm run demo
# O directamente:
node demo.ts
```

### 4. Iniciar el Servidor con la Interfaz Web de Chat
```bash
npm start
# O en modo desarrollo con auto-recarga:
npm run dev
```

Abre tu navegador en:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## ⚙️ Variables de Entorno (`.env`)

Copia la plantilla `.env.example` si deseas conectar un modelo comercial:
```bash
cp .env.example .env
```

| Variable | Descripción | Valor por Defecto |
|---|---|---|
| `PORT` | Puerto HTTP del servidor | `3000` |
| `LLM_PROVIDER` | Proveedor a utilizar (`mock`, `gemini`, `openai`) | `mock` (Auto-determinado) |
| `GEMINI_API_KEY` | Clave API de Google Gemini (Opcional) | _Vacío_ |
| `GEMINI_MODEL` | Modelo de Gemini a invocar | `gemini-2.5-flash` |
| `OPENAI_API_KEY` | Clave API de OpenAI (Opcional) | _Vacío_ |
| `OPENAI_MODEL` | Modelo de OpenAI a invocar | `gpt-4o-mini` |

> 💡 **Nota de Evaluación:** Si no configuras ninguna clave de API, el sistema arranca automáticamente con el **Perxia Autonomous Engine (Local / Determinista)**, permitiendo probar la aplicación completa, el chat conversacional y la confirmación humana sin costos ni configuraciones de credenciales.

---

## 💬 Demostración en el Chat Web

1. Abre `http://localhost:3000`.
2. Presiona el botón de acción rápida **"🚀 Procesar Buzón"** (o escribe en el chat:  
   `Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.`).
3. El agente procesará los correos y detendrá el flujo al llegar a `msg-006` (Contrato marco por demanda de Distribuidora Caribe).
4. Aparecerá en pantalla el banner interactivo de **Confirmación Humana**. Presiona **"✅ Confirmar y Registrar"**.
5. El agente registrará el contrato marco y emitirá el resumen ejecutivo junto con el reporte de alertas de riesgo.
6. Navega en la barra lateral entre:
   - **Maestro SharePoint:** Visualiza la tabla en vivo de `out/sharepoint/maestro-contratos.csv`.
   - **Alertas & Riesgos:** Renderiza `out/alertas.md` con los contratos que vencen en ≤ 60 días y pólizas pendientes.
   - **Auditoría / Historial:** Revisa la línea de tiempo inmutable de cambios en `out/sharepoint/historial.jsonl`.

---

## 📁 Estructura del Repositorio

```
reto-02/
├── agent/
│   └── prompt.md                        # System Prompt con reglas CA1 - CA5
├── src/
│   ├── server.ts                        # API HTTP Express y ciclo conversacional
│   ├── llm/
│   │   ├── adapter.ts                   # Interfaz común de proveedor LLM
│   │   ├── gemini.ts                    # Adaptador oficial Google Gemini
│   │   ├── openai.ts                    # Adaptador OpenAI
│   │   ├── mock.ts                      # Motor autónomo determinista local
│   │   └── factory.ts                   # Inyector de dependencias LLM
│   ├── tools/
│   │   └── contratos.ts                 # Herramientas tipadas con Zod (RN1 - RN7)
│   └── knowledge/
│       └── registro-contratos.md        # Base de conocimiento del proceso
├── web/                                 # Frontend web interactivo
│   ├── index.html                       # Layout de chat y explorador SharePoint
│   ├── style.css                        # Estilos profesionales responsivos
│   └── app.js                           # Lógica cliente y visor de datos
├── fixtures/reto-02/                    # Fixtures oficiales (Solo Lectura)
│   ├── buzon/                           # Mensajes msg-001 a msg-006
│   ├── maestro-contratos.csv            # Maestro congelado al 2026-05-30
│   └── comerciales.json                 # Directorio de comerciales
├── out/                                 # Artefactos generados en ejecución
│   ├── sharepoint/                      # Maestro actualizado, contratos y log
│   ├── alertas.md                       # Informe de riesgos generado
│   ├── log.jsonl                        # Trazabilidad técnica
│   └── procesados.json                  # Control de mensajes leídos
├── modulo/                              # BONUS (+10): Módulo reutilizable
│   ├── agent.md                         # Definición portátil de agente
│   ├── tools/contratos.ts               # Herramientas independientes
│   └── skill/registro-contratos/SKILL.md# Habilidad portable
├── demo.ts                              # Verificación determinista sin modelo
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── SOLUCION.md                          # Planteamiento técnico y regla de gobierno
```

---

## 🛠️ Herramientas Expuestas al Modelo

| Herramienta | Entrada | Salida Principal | Prioridad |
|---|---|---|---|
| `contratos_leer_buzon` | `{}` | `{ total_pendientes, mensajes[] }` | P0 |
| `contratos_extraer` | `{ mensaje_id }` | `Contrato` con confianza `[0, 1]` por campo | P0 |
| `contratos_validar` | `{ mensaje_id, contrato }` | `{ clasificacion, requiere_revision[], diferencias }` | P0 |
| `contratos_registrar` | `{ mensaje_id, contrato, confirmado? }` | `{ id_contrato, accion, ruta_archivo }` | P0 |
| `contratos_alertas` | `{ hoy: "YYYY-MM-DD" }` | `{ ruta, vencen[], polizas_pendientes[], registrados }` | P0 |
| `contratos_leer_pdf` | `{ ruta }` | `{ texto }` | P1 |

---

## 📡 API REST

- `POST /api/chat`: Procesa mensajes en la sesión `{ sessionId, message }` y ejecuta el ciclo de herramientas.
- `GET /api/sessions/:id`: Devuelve el historial y tool calls de una sesión.
- `GET /api/health`: Estado del servicio y modelo activo (sin exponer credenciales).
- `GET /api/files/alertas`: Retorna el contenido del archivo `out/alertas.md`.
- `GET /api/files/maestro`: Retorna el CSV `out/sharepoint/maestro-contratos.csv`.
- `GET /api/files/historial`: Retorna las líneas de `out/sharepoint/historial.jsonl`.
- `POST /api/reset`: Restablece el directorio `out/` a su estado inicial.
