import type { Provider, ProviderConfig, StreamOptions, Message } from './types';

export class GoogleProvider implements Provider {
  name = 'google';
  defaultModel = 'gemini-2.0-flash';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  private convertMessages(messages: Message[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    // Convert standard messages to Google format, handling system as user+model pair
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Google doesn't have system role, simulate with user+model pair
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] });
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        contents.push({ role, parts: [{ text: msg.content }] });
      }
    }

    return contents;
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new Error('Google API key not configured. Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.');
    }

    const model = options.model || this.defaultModel;

    let contents: Array<{ role: string; parts: Array<{ text: string }> }>;

    if (options.messages) {
      contents = this.convertMessages(options.messages);
    } else {
      contents = [];
      if (options.systemPrompt) {
        contents.push({ role: 'user', parts: [{ text: options.systemPrompt }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] });
      }
      contents.push({ role: 'user', parts: [{ text: prompt }] });
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body from Google');
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
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield text;
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
