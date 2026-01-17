import type { Provider, ProviderConfig, StreamOptions, Message, StreamChunk } from './types';
import type { ToolDefinition } from '../tools/types';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  defaultModel = 'claude-sonnet-4-20250514';
  supportsTools = true;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    if (config.model) {
      this.defaultModel = config.model;
    }
  }

  private convertTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  private convertMessages(messages: Message[]): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // System messages are handled separately in Anthropic
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        // Assistant message with tool calls
        const content: Array<Record<string, unknown>> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const call of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        result.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        // Tool result - Anthropic wants these as user messages with tool_result content
        // Check if we can merge with previous user message containing tool results
        const lastMsg = result[result.length - 1];
        const toolResult = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        };

        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          // Merge with previous tool results
          (lastMsg.content as Array<Record<string, unknown>>).push(toolResult);
        } else {
          result.push({ role: 'user', content: [toolResult] });
        }
      } else {
        // Regular user or assistant message
        result.push({ role: msg.role, content: msg.content });
      }
    }

    return result;
  }

  async *stream(prompt: string, options: StreamOptions = {}): AsyncIterable<StreamChunk> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured. Set ANTHROPIC_API_KEY environment variable.');
    }

    const model = options.model || this.defaultModel;

    // Build messages and extract system prompt
    let systemPrompt = options.systemPrompt;
    let messages: Array<Record<string, unknown>>;

    if (options.messages) {
      // Extract system message if present (Anthropic requires it separate)
      const systemMsg = options.messages.find(m => m.role === 'system');
      if (systemMsg) {
        systemPrompt = systemMsg.content;
      }
      messages = this.convertMessages(options.messages);
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages,
      stream: true,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (options.tools?.length) {
      body.tools = this.convertTools(options.tools);
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
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

    // Track current tool call being built
    let currentToolId = '';
    let currentToolName = '';
    let currentToolInput = '';

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

            // Handle text content
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
              yield { type: 'text', content: data.delta.text };
            }

            // Handle tool use start
            if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
              currentToolId = data.content_block.id;
              currentToolName = data.content_block.name;
              currentToolInput = '';
            }

            // Handle tool use input streaming
            if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
              currentToolInput += data.delta.partial_json;
            }

            // Handle content block stop - emit tool call if we were building one
            if (data.type === 'content_block_stop' && currentToolId) {
              try {
                const args = currentToolInput ? JSON.parse(currentToolInput) : {};
                yield {
                  type: 'tool_call',
                  call: {
                    id: currentToolId,
                    name: currentToolName,
                    arguments: args,
                  },
                };
              } catch {
                // If JSON parsing fails, emit with empty args
                yield {
                  type: 'tool_call',
                  call: {
                    id: currentToolId,
                    name: currentToolName,
                    arguments: {},
                  },
                };
              }
              currentToolId = '';
              currentToolName = '';
              currentToolInput = '';
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
