import type { Provider, ProviderConfig, StreamOptions } from './types';

export class OllamaProvider implements Provider {
  name = 'ollama';
  defaultModel = 'gemma3:4b';
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<string> {
    const model = options.model || this.defaultModel;

    // Use provided messages or build from prompt
    let messages = options.messages;
    if (!messages) {
      messages = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from Ollama');
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
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              yield data.message.content;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
