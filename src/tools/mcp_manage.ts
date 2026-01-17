/**
 * MCP Server Management Tools
 * Add, remove, and update MCP servers conversationally
 */

import type { Tool, ToolDefinition } from './types';
import { loadConfig, saveConfig, type MCPServerConfig } from '../config';
import { getMCPManager, createMCPClient } from '../mcp/client';
import { createMCPToolWrapper } from '../mcp/tools';
import { registerTools, unregisterTool } from './index';

/**
 * Add a new MCP server
 */
export class MCPAddTool implements Tool {
  definition: ToolDefinition = {
    name: 'mcp_add',
    description: 'Add a new MCP server connection. Connects immediately and saves to config for future sessions.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique name for this MCP server (e.g., "filesystem", "github")',
        },
        url: {
          type: 'string',
          description: 'URL for remote MCP server (e.g., "https://mcp.example.com/sse")',
        },
        command: {
          type: 'string',
          description: 'Command for local MCP server (e.g., "npx", "python")',
        },
        args: {
          type: 'string',
          description: 'Space-separated arguments for local server command',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what this server provides',
        },
      },
      required: ['name'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = args.name as string;
    const url = args.url as string | undefined;
    const command = args.command as string | undefined;
    const argsStr = args.args as string | undefined;
    const description = args.description as string | undefined;

    if (!url && !command) {
      return 'Error: Must provide either "url" (for remote server) or "command" (for local server)';
    }

    // Build the server config
    const serverConfig: MCPServerConfig = {};
    if (url) {
      serverConfig.url = url;
    }
    if (command) {
      serverConfig.command = command;
      if (argsStr) {
        serverConfig.args = argsStr.split(' ').filter(a => a.length > 0);
      }
    }
    if (description) {
      serverConfig.description = description;
    }

    // Load current config and add the server
    const config = loadConfig();
    if (!config.mcp) {
      config.mcp = { servers: {} };
    }
    if (!config.mcp.servers) {
      config.mcp.servers = {};
    }

    if (config.mcp.servers[name]) {
      return `Error: MCP server "${name}" already exists. Use mcp_update to modify it.`;
    }

    config.mcp.servers[name] = serverConfig;

    // Try to connect
    const manager = getMCPManager();
    manager.register(name, serverConfig);

    try {
      const client = await manager.connect(name);
      const tools = client.tools;

      if (tools.length > 0) {
        // Register the new tools
        const wrappedTools = tools.map(t => createMCPToolWrapper(name, t));
        registerTools(wrappedTools);
      }

      // Save config only after successful connection
      saveConfig(config);

      const toolNames = tools.map(t => t.name).join(', ');
      return `Successfully added MCP server "${name}".\n` +
        `Connected and loaded ${tools.length} tool(s): ${toolNames || '(none)'}\n` +
        `Configuration saved for future sessions.`;
    } catch (error) {
      // Remove from manager on failure
      return `Error connecting to MCP server: ${error}`;
    }
  }

  requiresConfirmation(): boolean {
    return false;
  }
}

/**
 * Remove an MCP server
 */
export class MCPRemoveTool implements Tool {
  definition: ToolDefinition = {
    name: 'mcp_remove',
    description: 'Remove an MCP server connection and unregister its tools.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP server to remove',
        },
      },
      required: ['name'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = args.name as string;

    const config = loadConfig();
    if (!config.mcp?.servers?.[name]) {
      return `Error: MCP server "${name}" not found in configuration.`;
    }

    // Get the client to find its tools before disconnecting
    const manager = getMCPManager();
    const client = manager.get(name);
    const toolNames: string[] = [];

    if (client) {
      // Unregister all tools from this server
      for (const tool of client.tools) {
        const fullName = `mcp_${name}_${tool.name}`;
        unregisterTool(fullName);
        toolNames.push(tool.name);
      }

      // Close the connection
      await client.close();
    }

    // Remove from config
    delete config.mcp.servers[name];
    saveConfig(config);

    return `Removed MCP server "${name}".\n` +
      `Unregistered ${toolNames.length} tool(s): ${toolNames.join(', ') || '(none)'}\n` +
      `Configuration updated.`;
  }

  requiresConfirmation(): boolean {
    return false;
  }
}

/**
 * Update an MCP server
 */
export class MCPUpdateTool implements Tool {
  definition: ToolDefinition = {
    name: 'mcp_update',
    description: 'Update an existing MCP server configuration and reconnect.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP server to update',
        },
        url: {
          type: 'string',
          description: 'New URL for remote MCP server',
        },
        command: {
          type: 'string',
          description: 'New command for local MCP server',
        },
        args: {
          type: 'string',
          description: 'New space-separated arguments for local server command',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
      },
      required: ['name'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = args.name as string;
    const url = args.url as string | undefined;
    const command = args.command as string | undefined;
    const argsStr = args.args as string | undefined;
    const description = args.description as string | undefined;

    const config = loadConfig();
    if (!config.mcp?.servers?.[name]) {
      return `Error: MCP server "${name}" not found. Use mcp_add to create it.`;
    }

    const serverConfig = config.mcp.servers[name];

    // Update fields that were provided
    if (url !== undefined) {
      serverConfig.url = url;
      delete serverConfig.command;
      delete serverConfig.args;
    }
    if (command !== undefined) {
      serverConfig.command = command;
      delete serverConfig.url;
    }
    if (argsStr !== undefined) {
      serverConfig.args = argsStr.split(' ').filter(a => a.length > 0);
    }
    if (description !== undefined) {
      serverConfig.description = description;
    }

    // Close existing connection and unregister tools
    const manager = getMCPManager();
    const existingClient = manager.get(name);
    if (existingClient) {
      for (const tool of existingClient.tools) {
        unregisterTool(`mcp_${name}_${tool.name}`);
      }
      await existingClient.close();
    }

    // Reconnect with new config
    manager.register(name, serverConfig);

    try {
      const client = await manager.connect(name);
      const tools = client.tools;

      if (tools.length > 0) {
        const wrappedTools = tools.map(t => createMCPToolWrapper(name, t));
        registerTools(wrappedTools);
      }

      // Save config after successful reconnection
      saveConfig(config);

      const toolNames = tools.map(t => t.name).join(', ');
      return `Updated MCP server "${name}".\n` +
        `Reconnected and loaded ${tools.length} tool(s): ${toolNames || '(none)'}\n` +
        `Configuration saved.`;
    } catch (error) {
      return `Error reconnecting to MCP server: ${error}`;
    }
  }

  requiresConfirmation(): boolean {
    return false;
  }
}

/**
 * List configured MCP servers
 */
export class MCPListTool implements Tool {
  definition: ToolDefinition = {
    name: 'mcp_list',
    description: 'List all configured MCP servers and their connection status.',
    parameters: {
      type: 'object',
      properties: {},
    },
  };

  async execute(): Promise<string> {
    const config = loadConfig();
    const servers = config.mcp?.servers || {};
    const serverNames = Object.keys(servers);

    if (serverNames.length === 0) {
      return 'No MCP servers configured.\n\nUse mcp_add to add a server.';
    }

    const manager = getMCPManager();
    const lines: string[] = [`MCP Servers (${serverNames.length}):\n`];

    for (const name of serverNames) {
      const serverConfig = servers[name]!;
      const client = manager.get(name);
      const connected = client?.isConnected() ?? false;
      const status = connected ? '✓ connected' : '○ not connected';

      lines.push(`  ${name}: ${status}`);
      if (serverConfig.url) {
        lines.push(`    URL: ${serverConfig.url}`);
      }
      if (serverConfig.command) {
        const args = serverConfig.args?.join(' ') || '';
        lines.push(`    Command: ${serverConfig.command} ${args}`);
      }
      if (serverConfig.description) {
        lines.push(`    Description: ${serverConfig.description}`);
      }
      if (connected && client) {
        lines.push(`    Tools: ${client.tools.length}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  requiresConfirmation(): boolean {
    return false;
  }
}
