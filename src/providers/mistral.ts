import type { Provider, ProviderConfig, StreamOptions, Message, StreamChunk } from './types';

export class MistralProvider implements Provider {
  name = 'mistral';
  defaultModel = 'mistral-small-latest';
  supportsTools = false;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.MISTRAL_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.mistral.ai/v1';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<StreamChunk> {
    if (!this.apiKey) {
      throw new Error('Mistral API key not configured. Set MISTRAL_API_KEY environment variable.');
    }

    const model = options.model || this.defaultModel;

    // Use provided messages or build from prompt
    let messages: Message[] = options.messages || [];
    if (!options.messages) {
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mistral error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from Mistral');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              yield { type: 'text', content };
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
