import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDeclaration, ToolCall } from "./adapter.ts";

export class MockAgentProvider implements LLMProvider {
  readonly name = "Perxia Autonomous LLM Engine (Local/Deterministic)";
  readonly model = "perxia-agent-v2-deterministic";

  private stepState: Record<string, any> = {};

  async enviar(mensajes: LLMMessage[], herramientas: LLMToolDeclaration[]): Promise<LLMResponse> {
    // Tomar el último mensaje del usuario
    const lastUserMsg = [...mensajes].reverse().find((m) => m.role === "user");
    const userPrompt = lastUserMsg?.content?.toLowerCase() || "";

    // Revisar el último mensaje en la conversación
    const lastMsg = mensajes[mensajes.length - 1];

    // Si el último mensaje fue una llamada a herramienta con respuesta:
    if (lastMsg.role === "tool") {
      const toolName = lastMsg.name;
      let toolData: any = {};
      try {
        const parsed = JSON.parse(lastMsg.content || "{}");
        toolData = parsed.data || {};
      } catch {}

      // Si recién corrió contratos_leer_buzon
      if (toolName === "contratos_leer_buzon") {
        const pendientes = toolData.mensajes || [];
        if (pendientes.length === 0) {
          return {
            text: "No se encontraron mensajes pendientes en el buzón de contratos.",
          };
        }
        // Iniciar procesamiento del primer mensaje pendiente
        const first = pendientes[0];
        this.stepState.pendientes = pendientes.slice(1);
        this.stepState.currentId = first.id;
        return {
          toolCalls: [
            {
              id: `call_${Date.now()}_ext`,
              name: "contratos_extraer",
              args: { mensaje_id: first.id },
            },
          ],
        };
      }

      // Si recién corrió contratos_extraer
      if (toolName === "contratos_extraer") {
        const contrato = toolData;
        this.stepState.currentContract = contrato;
        return {
          toolCalls: [
            {
              id: `call_${Date.now()}_val`,
              name: "contratos_validar",
              args: { mensaje_id: this.stepState.currentId, contrato },
            },
          ],
        };
      }

      // Si recién corrió contratos_validar
      if (toolName === "contratos_validar") {
        const val = toolData;
        const currentId = this.stepState.currentId;
        const contrato = this.stepState.currentContract;

        // Si requiere revisión y no está confirmado (ej. msg-006)
        if (val.requiere_revision && val.requiere_revision.length > 0) {
          // Detener el turno y solicitar confirmación humana (CA3 / RN5)
          this.stepState.waitingConfirmationMsg = currentId;
          this.stepState.waitingContract = contrato;

          const camposRev = val.requiere_revision.join(", ");
          return {
            text: `⚠️ **Atención: Se requiere confirmación humana para registrar el contrato [${currentId}]**\n\n` +
              `El contrato **${contrato.id_contrato}** para el cliente **${contrato.cliente}** presenta campos con nivel de confianza menor al 80% (confianza < 0.8):\n` +
              `- **Campos bajo revisión**: \`${camposRev}\`\n` +
              `- **Valor propuesto**: ${contrato.valor === 0 ? "$0 (Contrato marco / Por demanda)" : contrato.valor}\n` +
              `- **Vigencia calculada**: Desde ${contrato.fecha_inicio} hasta ${contrato.fecha_fin} (Plazo estimado en 12 meses)\n` +
              `- **Remitente**: ${contrato.comercial} (No registrado en directorio comercial)\n\n` +
              `> Por favor confirma si apruebas registrar este contrato con **valor 0** y fecha de vencimiento **${contrato.fecha_fin}** para proceder.`,
          };
        }

        // Si no requiere revisión o es rechazado/duplicado/limpio: registrar
        return {
          toolCalls: [
            {
              id: `call_${Date.now()}_reg`,
              name: "contratos_registrar",
              args: { mensaje_id: currentId, contrato, confirmado: false },
            },
          ],
        };
      }

      // Si recién corrió contratos_registrar
      if (toolName === "contratos_registrar") {
        const pendientes = this.stepState.pendientes || [];
        if (pendientes.length > 0) {
          const next = pendientes[0];
          this.stepState.pendientes = pendientes.slice(1);
          this.stepState.currentId = next.id;
          return {
            toolCalls: [
              {
                id: `call_${Date.now()}_ext`,
                name: "contratos_extraer",
                args: { mensaje_id: next.id },
              },
            ],
          };
        } else {
          // Ya no hay más pendientes en este lote, ejecutar reporte de alertas
          return {
            toolCalls: [
              {
                id: `call_${Date.now()}_alt`,
                name: "contratos_alertas",
                args: { hoy: "2026-09-03" },
              },
            ],
          };
        }
      }

      // Si recién corrió contratos_alertas
      if (toolName === "contratos_alertas") {
        const data = toolData;
        const vencen = data.vencen || [];
        const polizas = data.polizas_pendientes || [];
        const gap = data.registrados_desde_corte || [];

        let summary = `### ✅ Proceso de Registro de Contratos Finalizado con Éxito\n\n` +
          `Se procesaron todos los mensajes del buzón respetando las reglas de gobierno y de negocio.\n\n` +
          `#### 📊 Resumen Ejecutivo del Reporte de Alertas (\`out/alertas.md\`):\n` +
          `- **Contratos que vencen en ≤ 60 días (${vencen.length})**:\n`;

        for (const v of vencen) {
          summary += `  - **${v.id_contrato}** (${v.cliente}): vence el **${v.fecha_fin}** (**${v.dias_restantes} días restantes**). Comercial: ${v.comercial}\n`;
        }

        summary += `- **Pólizas requeridas pendientes de constitución (${polizas.length})**:\n`;
        for (const p of polizas) {
          summary += `  - **${p.id_contrato}** (${p.cliente}): tipo \`${p.tipo_poliza}\` en estado **${p.estado_poliza.toUpperCase()}**.\n`;
        }

        summary += `- **Contratos registrados o actualizados desde el corte 2026-05-30 (${gap.length})**:\n`;
        for (const g of gap) {
          summary += `  - **${g.id_contrato}** (${g.cliente}): ${g.moneda} ${Number(g.valor).toLocaleString()} (Registrado: ${g.fecha_registro})\n`;
        }

        summary += `\n*El maestro oficial de SharePoint (\`out/sharepoint/maestro-contratos.csv\`) y el historial de auditoría (\`out/sharepoint/historial.jsonl\`) han sido actualizados satisfactoriamente.*`;

        return { text: summary };
      }
    }

    // Si el usuario confirma el mensaje en revisión (ej. "confirmo el valor 0...")
    if (
      userPrompt.includes("confirmo") ||
      userPrompt.includes("confirmar") ||
      userPrompt.includes("proceder") ||
      userPrompt.includes("si") ||
      userPrompt.includes("sí")
    ) {
      if (this.stepState.waitingConfirmationMsg && this.stepState.waitingContract) {
        const msgId = this.stepState.waitingConfirmationMsg;
        const contrato = this.stepState.waitingContract;
        this.stepState.waitingConfirmationMsg = null;
        this.stepState.waitingContract = null;

        return {
          toolCalls: [
            {
              id: `call_${Date.now()}_conf_reg`,
              name: "contratos_registrar",
              args: { mensaje_id: msgId, contrato, confirmado: true },
            },
          ],
        };
      }
    }

    // Comando principal: procesar buzón
    if (
      userPrompt.includes("procesa") ||
      userPrompt.includes("procesar") ||
      userPrompt.includes("buzon") ||
      userPrompt.includes("buzón") ||
      userPrompt.includes("iniciar")
    ) {
      return {
        toolCalls: [
          {
            id: `call_${Date.now()}_buzon`,
            name: "contratos_leer_buzon",
            args: {},
          },
        ],
      };
    }

    // Comando para solo alertas
    if (userPrompt.includes("alerta") || userPrompt.includes("reporte")) {
      return {
        toolCalls: [
          {
            id: `call_${Date.now()}_alertas`,
            name: "contratos_alertas",
            args: { hoy: "2026-09-03" },
          },
        ],
      };
    }

    // Saludo o ayuda general
    return {
      text: "¡Hola! Soy el **Agente de Registro de Contratos Vigentes** de Periferia IT Group.\n\n" +
        "Puedo asistirte en:\n" +
        "1. **Procesar el buzón de entrada**: Leo los contratos entrantes, extraigo datos, clasifico duplicados/otrosíes y actualizo el maestro en SharePoint.\n" +
        "2. **Validar campos dudosos**: Si un contrato tiene baja confianza (como valores indeterminados), detendré el proceso para pedir tu autorización.\n" +
        "3. **Generar reporte de alertas**: Identifico contratos próximos a vencer (≤ 60 días) y pólizas pendientes de constitución.\n\n" +
        "Escribe **'Procesa el buzón de contratos con fecha de hoy 2026-09-03'** para comenzar.",
    };
  }
}
