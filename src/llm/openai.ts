import type { LLMProvider, LLMMessage, LLMResponse, LLMToolDeclaration, ToolCall } from "./adapter.ts";

export class OpenAIProvider implements LLMProvider {
  readonly name = "OpenAI";
  readonly model: string;
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, model: string = "gpt-4o-mini", baseURL: string = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = baseURL;
  }

  async enviar(mensajes: LLMMessage[], herramientas: LLMToolDeclaration[]): Promise<LLMResponse> {
    const url = `${this.baseURL}/chat/completions`;

    const openAiMessages = mensajes.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          content: m.content || "",
          tool_call_id: m.toolCallId || "call_default",
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        };
      }
      return {
        role: m.role,
        content: m.content || "",
      };
    });

    const tools = herramientas.map((h) => ({
      type: "function",
      function: {
        name: h.name,
        description: h.description,
        parameters: h.parameters,
      },
    }));

    const body: any = {
      model: this.model,
      messages: openAiMessages,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Error en API OpenAI (${response.status}): ${err}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls: ToolCall[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {}
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args,
        });
      }
    }

    return {
      text: message?.content || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: choice?.finish_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}
