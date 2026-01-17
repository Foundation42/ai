/**
 * MCP Client
 * Implements the Model Context Protocol client lifecycle
 */

import { createStdioTransport, type StdioTransport } from './transport';
import { createHTTPTransport, type HTTPTransport } from './http-transport';
import type {
  MCPServerConfig,
  MCPToolDefinition,
  InitializeParams,
  InitializeResult,
  ToolsListResult,
  ToolCallParams,
  ToolCallResult,
  ServerCapabilities,
  EntityInfo,
  JsonRpcRequest,
  JsonRpcNotification,
  MCP_PROTOCOL_VERSION,
} from './types';

const PROTOCOL_VERSION = '2025-11-25';

// Common transport interface
type Transport = StdioTransport | HTTPTransport;

export interface MCPClient {
  readonly serverInfo: EntityInfo | null;
  readonly capabilities: ServerCapabilities | null;
  readonly tools: MCPToolDefinition[];

  connect(): Promise<void>;
  listTools(): Promise<MCPToolDefinition[]>;
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
  close(): Promise<void>;
  isConnected(): boolean;
}

/**
 * Create an MCP client for a server configuration
 */
export async function createMCPClient(
  name: string,
  config: MCPServerConfig
): Promise<MCPClient> {
  let transport: Transport | null = null;
  const isRemote = !!config.url;
  let requestId = 0;
  let serverInfo: EntityInfo | null = null;
  let capabilities: ServerCapabilities | null = null;
  let tools: MCPToolDefinition[] = [];

  const nextId = () => ++requestId;

  const sendRequest = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    if (!transport || !transport.isAlive()) {
      throw new Error('MCP client not connected');
    }

    const id = nextId();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    // Send request and wait for the specific response by ID
    await transport.send(request);
    const response = await transport.waitForResponse(id);

    if (response.error) {
      throw new Error(`MCP error ${response.error.code}: ${response.error.message}`);
    }

    if (response.result === undefined) {
      throw new Error(`MCP response has no result for ${method}`);
    }

    return response.result as T;
  };

  const sendNotification = async (method: string, params?: Record<string, unknown>): Promise<void> => {
    if (!transport || !transport.isAlive()) {
      throw new Error('MCP client not connected');
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await transport.send(notification);
  };

  return {
    get serverInfo() {
      return serverInfo;
    },

    get capabilities() {
      return capabilities;
    },

    get tools() {
      return tools;
    },

    async connect(): Promise<void> {
      // Connect to the server (local stdio or remote HTTP)
      if (isRemote) {
        transport = await createHTTPTransport({
          url: config.url!,
          headers: config.headers,
        });
      } else if (config.command) {
        transport = await createStdioTransport(config as Required<Pick<MCPServerConfig, 'command'>>);
      } else {
        throw new Error('MCP server config must have either "url" or "command"');
      }

      // Send initialize request
      const initParams: InitializeParams = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          roots: { listChanged: true },
        },
        clientInfo: {
          name: 'ai-cli',
          version: '0.3.0',
        },
      };

      try {
        const result = await sendRequest<InitializeResult>('initialize', initParams);
        serverInfo = result.serverInfo;
        capabilities = result.capabilities;
      } catch (error) {
        throw new Error(`Failed to initialize MCP server: ${error}`);
      }

      // Send initialized notification
      await sendNotification('notifications/initialized');

      // Small delay for server to process initialized notification
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Fetch available tools if server supports them
      if (capabilities?.tools) {
        try {
          tools = await this.listTools();
        } catch (error) {
          console.error(`Warning: Failed to list MCP tools: ${error}`);
          tools = [];
        }
      }
    },

    async listTools(): Promise<MCPToolDefinition[]> {
      const result = await sendRequest<ToolsListResult>('tools/list');

      // Handle pagination if needed
      let allTools = [...result.tools];
      let cursor = result.nextCursor;

      while (cursor) {
        const nextResult = await sendRequest<ToolsListResult>('tools/list', { cursor });
        allTools = [...allTools, ...nextResult.tools];
        cursor = nextResult.nextCursor;
      }

      tools = allTools;
      return tools;
    },

    async callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
      const params: ToolCallParams = {
        name,
        arguments: args,
      };

      return sendRequest<ToolCallResult>('tools/call', params);
    },

    async close(): Promise<void> {
      if (transport) {
        await transport.close();
        transport = null;
      }
      serverInfo = null;
      capabilities = null;
      tools = [];
    },

    isConnected(): boolean {
      return transport !== null && transport.isAlive();
    },
  };
}

/**
 * MCP Client Manager
 * Manages multiple MCP server connections
 */
export class MCPClientManager {
  private clients: Map<string, MCPClient> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();

  /**
   * Register an MCP server configuration
   */
  register(name: string, config: MCPServerConfig): void {
    this.configs.set(name, config);
  }

  /**
   * Connect to a specific MCP server
   */
  async connect(name: string): Promise<MCPClient> {
    // Return existing client if already connected
    const existing = this.clients.get(name);
    if (existing?.isConnected()) {
      return existing;
    }

    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Unknown MCP server: ${name}`);
    }

    const client = await createMCPClient(name, config);
    await client.connect();
    this.clients.set(name, client);

    return client;
  }

  /**
   * Connect to all registered MCP servers
   */
  async connectAll(): Promise<void> {
    const names = Array.from(this.configs.keys());
    await Promise.all(names.map((name) => this.connect(name)));
  }

  /**
   * Get a connected client
   */
  get(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  /**
   * Get all connected clients
   */
  getAll(): Map<string, MCPClient> {
    return new Map(this.clients);
  }

  /**
   * Get all tools from all connected servers
   * Returns tools with server prefix: "server_name:tool_name"
   */
  getAllTools(): Array<{ server: string; tool: MCPToolDefinition }> {
    const allTools: Array<{ server: string; tool: MCPToolDefinition }> = [];

    for (const [serverName, client] of this.clients) {
      for (const tool of client.tools) {
        allTools.push({ server: serverName, tool });
      }
    }

    return allTools;
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    return client.callTool(toolName, args);
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.clients.values()).map((client) => client.close());
    await Promise.all(closePromises);
    this.clients.clear();
  }

  /**
   * List all registered server names
   */
  listServers(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * List connected server names
   */
  listConnected(): string[] {
    return Array.from(this.clients.keys()).filter((name) => {
      const client = this.clients.get(name);
      return client?.isConnected();
    });
  }
}

// Global manager instance
let globalManager: MCPClientManager | null = null;

export function getMCPManager(): MCPClientManager {
  if (!globalManager) {
    globalManager = new MCPClientManager();
  }
  return globalManager;
}
