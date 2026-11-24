import type { LLMProvider } from "./adapter.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAIProvider } from "./openai.ts";
import { MockAgentProvider } from "./mock.ts";

export function getLLMProvider(): LLMProvider {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const providerPref = (process.env.LLM_PROVIDER || "").toLowerCase();

  if (providerPref === "gemini" && geminiKey) {
    return new GeminiProvider(geminiKey, process.env.GEMINI_MODEL || "gemini-2.5-flash");
  }

  if (providerPref === "openai" && openAiKey) {
    return new OpenAIProvider(openAiKey, process.env.OPENAI_MODEL || "gpt-4o-mini");
  }

  // Auto-detección por llaves presentes
  if (geminiKey) {
    return new GeminiProvider(geminiKey, process.env.GEMINI_MODEL || "gemini-2.5-flash");
  }

  if (openAiKey) {
    return new OpenAIProvider(openAiKey, process.env.OPENAI_MODEL || "gpt-4o-mini");
  }

  // Fallback por defecto: Mock autónomo determinista (sin costo, 100% confiable y sin fallos de cuota)
  return new MockAgentProvider();
}
