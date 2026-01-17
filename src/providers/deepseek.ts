import type { Provider, ProviderConfig, StreamOptions, Message, StreamChunk } from './types';

export class DeepSeekProvider implements Provider {
  name = 'deepseek';
  defaultModel = 'deepseek-chat';
  supportsTools = false;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || '';
    if (!this.apiKey) {
      console.warn('DeepSeek API key not configured. Set DEEPSEEK_API_KEY environment variable.');
    }
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<StreamChunk> {
    if (!this.apiKey) {
      throw new Error('DeepSeek API key not configured. Set DEEPSEEK_API_KEY environment variable.');
    }

    const model = options.model || this.defaultModel;

    // Use provided messages or build from prompt
    let messages: Message[] = options.messages || (
      options.systemPrompt
        ? [{ role: 'system', content: options.systemPrompt }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }]
    );

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
      throw new Error(`DeepSeek error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from DeepSeek');
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
    } catch (e) {
      console.error('Error processing stream:', e);
    } finally {
      reader.releaseLock();
    }
  }
}
