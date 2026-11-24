export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LLMToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LLMResponse {
  text?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  enviar(mensajes: LLMMessage[], herramientas: LLMToolDeclaration[]): Promise<LLMResponse>;
}
