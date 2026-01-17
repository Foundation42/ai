import type { Provider, ProviderConfig, StreamOptions, Message } from './types';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  defaultModel = 'claude-sonnet-4-20250514';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured. Set ANTHROPIC_API_KEY environment variable.');
    }

    const model = options.model || this.defaultModel;

    // Build messages and extract system prompt
    let systemPrompt = options.systemPrompt;
    let messages: Message[];

    if (options.messages) {
      // Extract system message if present (Anthropic requires it separate)
      const systemMsg = options.messages.find(m => m.role === 'system');
      if (systemMsg) {
        systemPrompt = systemMsg.content;
      }
      messages = options.messages.filter(m => m.role !== 'system');
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt || undefined,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from Anthropic');
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.text) {
              yield data.delta.text;
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
