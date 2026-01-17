// JSON Schema property - allows full schema structure for complex types
export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;  // For arrays
  properties?: Record<string, JsonSchemaProperty>;  // For objects
  required?: string[];
  default?: unknown;
  [key: string]: unknown;  // Allow other JSON Schema properties
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
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
