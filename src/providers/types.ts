export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  model?: string;
  systemPrompt?: string;
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
