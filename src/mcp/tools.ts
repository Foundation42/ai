/**
 * MCP Tool Wrapper
 * Converts MCP tools to the internal Tool interface
 */

import type { Tool, ToolDefinition } from '../tools/types';
import type { MCPToolDefinition, ToolCallResult, ToolContent } from './types';
import { getMCPManager, type MCPClient } from './client';

/**
 * Create a Tool wrapper for an MCP tool
 */
export function createMCPToolWrapper(
  serverName: string,
  mcpTool: MCPToolDefinition
): Tool {
  // Create unique tool name with server prefix
  const toolName = `mcp_${serverName}_${mcpTool.name}`;

  // Convert MCP inputSchema to our ToolDefinition parameters format
  const properties: Record<string, { type: string; description: string; enum?: string[] }> = {};

  if (mcpTool.inputSchema.properties) {
    for (const [key, value] of Object.entries(mcpTool.inputSchema.properties)) {
      properties[key] = {
        type: value.type,
        description: value.description || '',
        enum: value.enum,
      };
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
