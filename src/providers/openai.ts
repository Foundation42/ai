import type { Provider, ProviderConfig, StreamOptions, Message } from './types';

export class OpenAIProvider implements Provider {
  name = 'openai';
  defaultModel = 'gpt-4o-mini';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
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
      throw new Error(`OpenAI error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from OpenAI');
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
              yield content;
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
