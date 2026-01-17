import type { Provider, ProviderConfig, StreamOptions, Message, StreamChunk } from './types';
import type { ToolDefinition } from '../tools/types';

export class GoogleProvider implements Provider {
  name = 'google';
  defaultModel = 'gemini-2.0-flash';
  supportsTools = true;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  private convertMessages(messages: Message[]): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

    let i = 0;
    while (i < messages.length) {
      const msg = messages[i]!;

      if (msg.role === 'system') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] });
        i++;
      } else if (msg.role === 'tool') {
        // Batch all consecutive tool results into a single function response
        // Google requires all function responses from one turn to be in one message
        const toolParts: Array<Record<string, unknown>> = [];
        while (i < messages.length && messages[i]!.role === 'tool') {
          const toolMsg = messages[i]!;
          toolParts.push({
            functionResponse: {
              name: toolMsg.tool_call_id,
              response: { result: toolMsg.content },
            },
          });
          i++;
        }
        contents.push({ role: 'function', parts: toolParts });
      } else if (msg.role === 'assistant' && msg.tool_calls?.length) {
        // Assistant with tool calls
        const parts: Array<Record<string, unknown>> = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        for (const call of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: call.name,
              args: call.arguments,
            },
          });
        }
        contents.push({ role: 'model', parts });
        i++;
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        contents.push({ role, parts: [{ text: msg.content }] });
        i++;
      }
    }

    return contents;
  }

  private convertTools(tools: ToolDefinition[]): Array<{ functionDeclarations: Array<Record<string, unknown>> }> {
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }];
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<StreamChunk> {
    if (!this.apiKey) {
      throw new Error('Google API key not configured. Set GOOGLE_API_KEY or GEMINI_API_KEY environment variable.');
    }

    const model = options.model || this.defaultModel;

    let contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;

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

    const body: Record<string, unknown> = { contents };

    if (options.tools?.length) {
      body.tools = this.convertTools(options.tools);
    }

    const response = await fetch(
      `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            const parts = data.candidates?.[0]?.content?.parts || [];

            for (const part of parts) {
              if (part.text) {
                yield { type: 'text', content: part.text };
              }
              if (part.functionCall) {
                yield {
                  type: 'tool_call',
                  call: {
                    id: part.functionCall.name,  // Google doesn't use IDs, use name
                    name: part.functionCall.name,
                    arguments: part.functionCall.args || {},
                  },
                };
              }
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
