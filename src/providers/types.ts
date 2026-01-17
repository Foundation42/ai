import type { ToolDefinition, ToolCall } from '../tools/types';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;  // For tool result messages
}

export interface StreamOptions {
  model?: string;
  systemPrompt?: string;
  messages?: Message[];
  tools?: ToolDefinition[];
}

export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; call: ToolCall };

export interface Provider {
  name: string;
  defaultModel: string;
  stream(prompt: string, options?: StreamOptions): AsyncIterable<StreamChunk>;
  supportsTools?: boolean;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
