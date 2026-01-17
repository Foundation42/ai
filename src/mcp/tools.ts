/**
 * MCP Tool Wrapper
 * Converts MCP tools to the internal Tool interface
 */

import type { Tool, ToolDefinition, JsonSchemaProperty } from '../tools/types';
import type { MCPToolDefinition, ToolCallResult, ToolContent } from './types';
import { getMCPManager, type MCPClient } from './client';

/**
 * Fields that Google's Gemini API doesn't support in function schemas
 * These need to be stripped out to avoid INVALID_ARGUMENT errors
 */
const UNSUPPORTED_SCHEMA_FIELDS = new Set([
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  'definitions',
  '$defs',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'patternProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentMediaType',
  'contentEncoding',
  'examples',
]);

/**
 * Recursively sanitize JSON Schema for Google's Gemini API:
 * - Ensure arrays have items defined
 * - Remove unsupported JSON Schema keywords
 */
function sanitizeSchema(schema: Record<string, unknown>): JsonSchemaProperty {
  const result: JsonSchemaProperty = {};

  for (const [key, value] of Object.entries(schema)) {
    // Skip unsupported fields
    if (UNSUPPORTED_SCHEMA_FIELDS.has(key)) {
      continue;
    }

    if (key === 'properties' && typeof value === 'object' && value !== null) {
      // Recursively sanitize nested properties
      const props: Record<string, JsonSchemaProperty> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof propValue === 'object' && propValue !== null) {
          props[propKey] = sanitizeSchema(propValue as Record<string, unknown>);
        }
      }
      result.properties = props;
    } else if (key === 'items' && typeof value === 'object' && value !== null) {
      // Recursively sanitize array items schema
      result.items = sanitizeSchema(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  // If type is array but no items defined, add a default items schema
  if (result.type === 'array' && !result.items) {
    result.items = { type: 'string' };
  }

  return result;
}

/**
 * Create a Tool wrapper for an MCP tool
 */
export function createMCPToolWrapper(
  serverName: string,
  mcpTool: MCPToolDefinition
): Tool {
  // Create unique tool name with server prefix
  const toolName = `mcp_${serverName}_${mcpTool.name}`;

  // Sanitize and preserve the full inputSchema structure
  const properties: Record<string, JsonSchemaProperty> = {};

  if (mcpTool.inputSchema.properties) {
    for (const [key, value] of Object.entries(mcpTool.inputSchema.properties)) {
      properties[key] = sanitizeSchema(value as Record<string, unknown>);
    }
  }

  const definition: ToolDefinition = {
    name: toolName,
    description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
    parameters: {
      type: 'object',
      properties,
      required: mcpTool.inputSchema.required,
    },
  };

  return {
    definition,

    async execute(args: Record<string, unknown>): Promise<string> {
      const manager = getMCPManager();
      const result = await manager.callTool(serverName, mcpTool.name, args);

      return formatToolResult(result);
    },

    // MCP tools don't require local confirmation by default
    // (the MCP server may have its own confirmation mechanisms)
    requiresConfirmation(): boolean {
      return false;
    },
  };
}

/**
 * Format MCP tool result content to string
 */
function formatToolResult(result: ToolCallResult): string {
  if (result.isError) {
    const errorText = result.content
      .filter((c): c is ToolContent & { type: 'text' } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return `Error: ${errorText}`;
  }

  const parts: string[] = [];

  for (const content of result.content) {
    if (content.type === 'text' && content.text) {
      parts.push(content.text);
    } else if (content.type === 'image') {
      parts.push(`[Image: ${content.mimeType || 'unknown type'}]`);
    } else if (content.type === 'resource') {
      parts.push(`[Resource]`);
    }
  }

  // If structured content is available, prefer it for data
  if (result.structuredContent) {
    return JSON.stringify(result.structuredContent, null, 2);
  }

  return parts.join('\n') || '(no output)';
}

/**
 * Get all MCP tools as Tool wrappers
 */
export function getAllMCPTools(): Tool[] {
  const manager = getMCPManager();
  const tools: Tool[] = [];

  for (const { server, tool } of manager.getAllTools()) {
    tools.push(createMCPToolWrapper(server, tool));
  }

  return tools;
}

/**
 * Initialize MCP tools from configuration and return wrapped tools
 */
export async function initializeMCPTools(
  servers: Record<string, { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }>
): Promise<Tool[]> {
  const manager = getMCPManager();

  // Register all servers
  for (const [name, config] of Object.entries(servers)) {
    manager.register(name, config);
  }

  // Connect to all servers
  try {
    await manager.connectAll();
  } catch (error) {
    console.error('Failed to connect to some MCP servers:', error);
  }

  // Return wrapped tools
  return getAllMCPTools();
}

/**
 * Cleanup MCP connections
 */
export async function cleanupMCP(): Promise<void> {
  const manager = getMCPManager();
  await manager.closeAll();
}
