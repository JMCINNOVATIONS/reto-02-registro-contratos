import express from "express";
import type { Request, Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";

import type { LLMMessage, LLMToolDeclaration, ToolCall } from "./llm/adapter.ts";
import { getLLMProvider } from "./llm/factory.ts";
import {
  leer_buzon,
  extraer,
  validar,
  registrar,
  alertas,
  leer_pdf,
} from "./tools/contratos.ts";
import type { ToolContext } from "./tools/contratos.ts";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ROOT_DIR = process.cwd();

// Cargar System Prompt desde agent/prompt.md (Requisito Sec. 6.1)
const promptPath = path.join(ROOT_DIR, "agent", "prompt.md");
let SYSTEM_PROMPT = "Eres un asistente de registro de contratos.";
if (fs.existsSync(promptPath)) {
  SYSTEM_PROMPT = fs.readFileSync(promptPath, "utf-8");
}

// Cargar Conocimiento adicional si existe
const knowledgePath = path.join(ROOT_DIR, "src", "knowledge", "registro-contratos.md");
if (fs.existsSync(knowledgePath)) {
  SYSTEM_PROMPT += "\n\n" + fs.readFileSync(knowledgePath, "utf-8");
}

// Registro de herramientas obligatorias (Sec. 6.2)
const toolsRegistry: Record<string, any> = {
  contratos_leer_buzon: leer_buzon,
  contratos_extraer: extraer,
  contratos_validar: validar,
  contratos_registrar: registrar,
  contratos_alertas: alertas,
  contratos_leer_pdf: leer_pdf,
};

// Declaraciones de herramientas para el LLM
const toolDeclarations: LLMToolDeclaration[] = [
  {
    name: "contratos_leer_buzon",
    description: leer_buzon.description,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "contratos_extraer",
    description: extraer.description,
    parameters: {
      type: "object",
      properties: {
        mensaje_id: { type: "string", description: "ID del mensaje (ej. msg-001)" },
      },
      required: ["mensaje_id"],
    },
  },
  {
    name: "contratos_validar",
    description: validar.description,
    parameters: {
      type: "object",
      properties: {
        mensaje_id: { type: "string", description: "ID del mensaje" },
        contrato: { type: "object", description: "Objeto contrato extraído" },
      },
      required: ["mensaje_id", "contrato"],
    },
  },
  {
    name: "contratos_registrar",
    description: registrar.description,
    parameters: {
      type: "object",
      properties: {
        mensaje_id: { type: "string", description: "ID del mensaje" },
        contrato: { type: "object", description: "Objeto contrato a registrar" },
        confirmado: {
          type: "boolean",
          description: "True para confirmar registro en campos con baja confianza o advertencias",
        },
      },
      required: ["mensaje_id", "contrato"],
    },
  },
  {
    name: "contratos_alertas",
    description: alertas.description,
    parameters: {
      type: "object",
      properties: {
        hoy: { type: "string", description: "Fecha de corte YYYY-MM-DD (ej. 2026-09-03)" },
      },
      required: ["hoy"],
    },
  },
  {
    name: "contratos_leer_pdf",
    description: leer_pdf.description,
    parameters: {
      type: "object",
      properties: {
        ruta: { type: "string", description: "Ruta del PDF" },
      },
      required: ["ruta"],
    },
  },
];

// Estructura de Sesiones en Memoria
interface SessionData {
  id: string;
  messages: LLMMessage[];
  toolCallsHistory: Array<{
    tool: string;
    args: any;
    result: any;
    ts: string;
  }>;
  needsConfirmation: boolean;
  pendingContract?: any;
}

const sessions = new Map<string, SessionData>();

function getOrCreateSession(id: string): SessionData {
  let session = sessions.get(id);
  if (!session) {
    session = {
      id,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      toolCallsHistory: [],
      needsConfirmation: false,
    };
    sessions.set(id, session);
  }
  return session;
}

// -------------------------------------------------------------
// Rutas de API (Requisito Sec. 6.4)
// -------------------------------------------------------------

// GET /api/health
app.get("/api/health", (_req: Request, res: Response) => {
  const llm = getLLMProvider();
  res.json({
    ok: true,
    provider: llm.name,
    model: llm.model,
    system: "Perxia 2.0 - Registro de Contratos Vigentes",
    timestamp: new Date().toISOString(),
  });
});

// GET /api/sessions/:id
app.get("/api/sessions/:id", (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ ok: false, error: "Sesión no encontrada" });
  }
  res.json({
    ok: true,
    id: session.id,
    messages: session.messages,
    toolCallsHistory: session.toolCallsHistory,
    needsConfirmation: session.needsConfirmation,
  });
});

// POST /api/chat - Ciclo conversacional del agente con tope de 25 iteraciones
app.post("/api/chat", async (req: Request, res: Response) => {
  try {
    const { sessionId = "default", message } = req.body;
    if (!message) {
      return res.status(400).json({ ok: false, error: "El campo 'message' es requerido." });
    }

    const session = getOrCreateSession(sessionId);
    const llm = getLLMProvider();
    const ctx: ToolContext = { directory: ROOT_DIR, sessionId };

    // Agregar mensaje del usuario a la historia
    session.messages.push({ role: "user", content: message });

    let iterations = 0;
    const maxIterations = 25; // CA1: Tope de 25 iteraciones
    const turnToolCalls: Array<{ tool: string; args: any; result: any }> = [];
    let finalReply = "";

    while (iterations < maxIterations) {
      iterations++;

      // Invocación al proveedor LLM
      const response = await llm.enviar(session.messages, toolDeclarations);

      // Si el modelo retorna llamadas a herramientas
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Registrar llamadas en el historial del agente
        session.messages.push({
          role: "assistant",
          content: response.text || undefined,
          toolCalls: response.toolCalls,
        });

        for (const tc of response.toolCalls) {
          const tool = toolsRegistry[tc.name];
          let toolResultStr = "";
          let parsedResult: any = {};

          if (!tool) {
            toolResultStr = JSON.stringify({ ok: false, error: `Herramienta ${tc.name} no reconocida.` });
          } else {
            try {
              toolResultStr = await tool.execute(tc.args || {}, ctx);
              parsedResult = JSON.parse(toolResultStr);
            } catch (err: any) {
              toolResultStr = JSON.stringify({ ok: false, error: err.message || "Error de ejecución" });
              parsedResult = { ok: false, error: err.message };
            }
          }

          // Guardar en auditoría visible
          const entry = {
            tool: tc.name,
            args: tc.args,
            result: parsedResult,
            ts: new Date().toISOString(),
          };
          turnToolCalls.push(entry);
          session.toolCallsHistory.push(entry);

          // Agregar respuesta de herramienta a la conversación
          session.messages.push({
            role: "tool",
            name: tc.name,
            toolCallId: tc.id,
            content: toolResultStr,
          });

          // Si una validación arrojó campos que requieren revisión (RN5 / CA3)
          if (tc.name === "contratos_validar" && parsedResult.data?.requiere_revision?.length > 0) {
            session.needsConfirmation = true;
            session.pendingContract = tc.args.contrato;
          }
        }
      } else if (response.text) {
        // El modelo produjo respuesta textual final del turno
        finalReply = response.text;
        session.messages.push({ role: "assistant", content: finalReply });

        // Evaluar si solicita confirmación humana
        if (
          finalReply.includes("confirmación") ||
          finalReply.includes("confirmar") ||
          finalReply.includes("¿Confirmas") ||
          finalReply.includes("revisión humana")
        ) {
          session.needsConfirmation = true;
        } else {
          session.needsConfirmation = false;
        }

        break;
      } else {
        finalReply = "Proceso ejecutado sin texto de salida.";
        break;
      }
    }

    if (iterations >= maxIterations && !finalReply) {
      finalReply = "Se alcanzó el tope de 25 iteraciones del ciclo. El estado actual ha sido guardado.";
    }

    res.json({
      ok: true,
      reply: finalReply,
      toolCalls: turnToolCalls,
      needsConfirmation: session.needsConfirmation,
      iterations,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || "Error interno en el ciclo del agente" });
  }
});

// GET /api/files/alertas
app.get("/api/files/alertas", (_req: Request, res: Response) => {
  const alertasPath = path.join(ROOT_DIR, "out", "alertas.md");
  if (!fs.existsSync(alertasPath)) {
    return res.status(404).json({ ok: false, error: "Reporte de alertas no generado aún." });
  }
  const content = fs.readFileSync(alertasPath, "utf-8");
  res.json({ ok: true, content });
});

// GET /api/files/maestro
app.get("/api/files/maestro", (_req: Request, res: Response) => {
  const maestroPath = path.join(ROOT_DIR, "out", "sharepoint", "maestro-contratos.csv");
  if (!fs.existsSync(maestroPath)) {
    return res.status(404).json({ ok: false, error: "Maestro de contratos no inicializado." });
  }
  const content = fs.readFileSync(maestroPath, "utf-8");
  res.json({ ok: true, content });
});

// GET /api/files/historial
app.get("/api/files/historial", (_req: Request, res: Response) => {
  const histPath = path.join(ROOT_DIR, "out", "sharepoint", "historial.jsonl");
  if (!fs.existsSync(histPath)) {
    return res.json({ ok: true, content: "" });
  }
  const content = fs.readFileSync(histPath, "utf-8");
  res.json({ ok: true, content });
});

// POST /api/reset - Restablecer out/ a estado inicial
app.post("/api/reset", (_req: Request, res: Response) => {
  try {
    const outDir = path.join(ROOT_DIR, "out");
    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    sessions.clear();
    res.json({ ok: true, message: "Directorio out/ y sesiones restablecidas correctamente." });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Servir estáticos de la interfaz web en web/
const webDir = path.join(ROOT_DIR, "web");
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(webDir, "index.html"));
  });
}

export { app };

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`=============================================================`);
    console.log(`🤖 Agente Registro de Contratos (Perxia 2.0) corriendo en:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`=============================================================`);
  });
}
