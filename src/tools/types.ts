export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  result: string;
  error?: boolean;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
  requiresConfirmation?(args: Record<string, unknown>): boolean;
}
