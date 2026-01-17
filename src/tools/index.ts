import type { Tool, ToolDefinition, ToolCall, ToolResult } from './types';
import { BashTool } from './bash';
import { ReadFileTool } from './read_file';
import { ListFilesTool } from './list_files';
import { EditFileTool } from './edit_file';

export type { Tool, ToolDefinition, ToolCall, ToolResult } from './types';

const tools: Map<string, Tool> = new Map();

// Register default tools
tools.set('bash', new BashTool());
tools.set('read_file', new ReadFileTool());
tools.set('list_files', new ListFilesTool());
tools.set('edit_file', new EditFileTool());

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(tools.values());
}

export function getToolDefinitions(): ToolDefinition[] {
  return getAllTools().map(t => t.definition);
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
