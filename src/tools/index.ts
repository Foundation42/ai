import type { Tool, ToolDefinition, ToolCall, ToolResult } from './types';
import { BashTool } from './bash';
import { ReadFileTool } from './read_file';
import { ListFilesTool } from './list_files';
import { EditFileTool } from './edit_file';
import { WebFetchTool } from './web_fetch';
import { FleetQueryTool, FleetListTool, FleetBroadcastTool, FleetUpgradeTool, FleetRestartTool } from './fleet';
import { VersionTool } from './version';
import { MCPAddTool, MCPRemoveTool, MCPUpdateTool, MCPListTool } from './mcp_manage';
import { MemoryWriteTool, MemoryReadTool, MemorySearchTool, MemoryShareTool, MemoryReceiveTool, MemoryAskPeersTool } from './memory';

export type { Tool, ToolDefinition, ToolCall, ToolResult } from './types';

const tools: Map<string, Tool> = new Map();

// Register default tools
tools.set('bash', new BashTool());
tools.set('read_file', new ReadFileTool());
tools.set('list_files', new ListFilesTool());
tools.set('edit_file', new EditFileTool());
tools.set('web_fetch', new WebFetchTool());
tools.set('version', new VersionTool());

// Register fleet tools
tools.set('fleet_query', new FleetQueryTool());
tools.set('fleet_list', new FleetListTool());
tools.set('fleet_broadcast', new FleetBroadcastTool());
tools.set('fleet_upgrade', new FleetUpgradeTool());
tools.set('fleet_restart', new FleetRestartTool());

// Register MCP management tools
tools.set('mcp_add', new MCPAddTool());
tools.set('mcp_remove', new MCPRemoveTool());
tools.set('mcp_update', new MCPUpdateTool());
tools.set('mcp_list', new MCPListTool());

// Register memory tools
tools.set('memory_write', new MemoryWriteTool());
tools.set('memory_read', new MemoryReadTool());
tools.set('memory_search', new MemorySearchTool());
tools.set('memory_share', new MemoryShareTool());
tools.set('memory_receive', new MemoryReceiveTool());
tools.set('memory_ask_peers', new MemoryAskPeersTool());

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(tools.values());
}

export function getToolDefinitions(): ToolDefinition[] {
  return getAllTools().map(t => t.definition);
}

/**
 * Register a new tool dynamically (e.g., MCP tools)
 */
export function registerTool(tool: Tool): void {
  tools.set(tool.definition.name, tool);
}

/**
 * Register multiple tools at once
 */
export function registerTools(newTools: Tool[]): void {
  for (const tool of newTools) {
    tools.set(tool.definition.name, tool);
  }
}

/**
 * Unregister a tool by name
 */
export function unregisterTool(name: string): boolean {
  return tools.delete(name);
}

export async function executeTool(
  call: ToolCall,
  confirmFn?: (tool: Tool, args: Record<string, unknown>) => Promise<boolean>
): Promise<ToolResult> {
  const tool = getTool(call.name);

  if (!tool) {
    return {
      id: call.id,
      name: call.name,
      result: `Unknown tool: ${call.name}`,
      error: true,
    };
  }

  // Check if confirmation is required
  if (tool.requiresConfirmation?.(call.arguments) && confirmFn) {
    const confirmed = await confirmFn(tool, call.arguments);
    if (!confirmed) {
      return {
        id: call.id,
        name: call.name,
        result: 'Command cancelled by user',
        error: true,
      };
    }
  }

  try {
    const result = await tool.execute(call.arguments);
    return {
      id: call.id,
      name: call.name,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: call.id,
      name: call.name,
      result: `Error: ${message}`,
      error: true,
    };
  }
}
