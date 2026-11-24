import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDeclaration, ToolCall } from "./adapter.ts";

export class GeminiProvider implements LLMProvider {
  readonly name = "Google Gemini";
  readonly model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string = "gemini-2.5-flash") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async enviar(mensajes: LLMMessage[], herramientas: LLMToolDeclaration[]): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Transformar mensajes al formato Gemini
    const contents: any[] = [];
    let systemInstruction: any = undefined;

    for (const msg of mensajes) {
      if (msg.role === "system") {
        systemInstruction = {
          parts: [{ text: msg.content || "" }],
        };
      } else if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content || "" }],
        });
      } else if (msg.role === "assistant") {
        const parts: any[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.args,
              },
            });
          }
        }
        contents.push({ role: "model", parts });
      } else if (msg.role === "tool") {
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: msg.name || "tool",
                response: {
                  content: msg.content ? JSON.parse(msg.content) : {},
                },
              },
            },
          ],
        });
      }
    }

    // Transformar herramientas
    const functionDeclarations = herramientas.map((h) => ({
      name: h.name,
      description: h.description,
      parameters: h.parameters,
    }));

    const body: any = {
      contents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (functionDeclarations.length > 0) {
      body.tools = [{ functionDeclarations }];
      body.toolConfig = {
        functionCallingConfig: {
          mode: "AUTO",
        },
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error en API Gemini (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return { text: "No se recibió respuesta del modelo." };
    }

    const parts = candidate.content?.parts || [];
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        text += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }

    return {
      text: text.trim() || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: candidate.finishReason,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            completionTokens: data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }
}
