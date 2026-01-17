import type { Provider, ProviderConfig, StreamOptions, Message, StreamChunk } from './types';
import type { ToolDefinition } from '../tools/types';

export class OpenAIProvider implements Provider {
  name = 'openai';
  defaultModel = 'gpt-4o-mini';
  supportsTools = true;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  private convertTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private convertMessages(messages: Message[]): Array<Record<string, unknown>> {
    return messages.map(msg => {
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        // Assistant message with tool calls
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.tool_calls.map(call => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        };
      } else if (msg.role === 'tool') {
        // Tool result message
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        };
      } else {
        // Regular message
        return {
          role: msg.role,
          content: msg.content,
        };
      }
    });
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<StreamChunk> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
    }

    const model = options.model || this.defaultModel;

    // Use provided messages or build from prompt
    let messages: Array<Record<string, unknown>>;
    if (options.messages) {
      messages = this.convertMessages(options.messages);
    } else {
      messages = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };

    if (options.tools?.length) {
      body.tools = this.convertTools(options.tools);
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
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

    // Track tool calls being built (OpenAI can stream multiple tool calls)
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

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
            const delta = data.choices?.[0]?.delta;
            const finishReason = data.choices?.[0]?.finish_reason;

            // Handle text content
            if (delta?.content) {
              yield { type: 'text', content: delta.content };
            }

            // Handle tool calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index;

                if (!toolCalls.has(index)) {
                  // New tool call
                  toolCalls.set(index, {
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    arguments: '',
                  });
                }

                const call = toolCalls.get(index)!;

                // Update with any new data
                if (tc.id) call.id = tc.id;
                if (tc.function?.name) call.name = tc.function.name;
                if (tc.function?.arguments) call.arguments += tc.function.arguments;
              }
            }

            // Emit tool calls when finished
            if (finishReason === 'tool_calls' || finishReason === 'stop') {
              for (const [, call] of toolCalls) {
                if (call.id && call.name) {
                  try {
                    const args = call.arguments ? JSON.parse(call.arguments) : {};
                    yield {
                      type: 'tool_call',
                      call: {
                        id: call.id,
                        name: call.name,
                        arguments: args,
                      },
                    };
                  } catch {
                    // If JSON parsing fails, emit with empty args
                    yield {
                      type: 'tool_call',
                      call: {
                        id: call.id,
                        name: call.name,
                        arguments: {},
                      },
                    };
                  }
                }
              }
              toolCalls.clear();
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
