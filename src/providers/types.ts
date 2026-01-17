export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  model?: string;
  systemPrompt?: string;
  messages?: Message[];  // For multi-turn conversations (overrides prompt if provided)
}

export interface Provider {
  name: string;
  defaultModel: string;
  stream(prompt: string, options?: StreamOptions): AsyncIterable<string>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}
