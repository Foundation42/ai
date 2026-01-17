/**
 * MCP (Model Context Protocol) Type Definitions
 * Based on specification: https://modelcontextprotocol.io/specification/2025-11-25
 */

// JSON-RPC 2.0 base types
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// MCP Client/Server Info
export interface EntityInfo {
  name: string;
  version: string;
  title?: string;
  description?: string;
}

// MCP Capabilities
export interface ClientCapabilities {
  roots?: { listChanged?: boolean };
  sampling?: Record<string, unknown>;
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
}

// Initialize request/response
export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: EntityInfo;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: EntityInfo;
  instructions?: string;
}

// Tool definitions
export interface MCPToolDefinition {
  name: string;
  description?: string;
  title?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
    additionalProperties?: boolean;
  };
  outputSchema?: Record<string, unknown>;
}

// Tool list response
export interface ToolsListResult {
  tools: MCPToolDefinition[];
  nextCursor?: string;
}

// Tool call request/response
export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolCallResult {
  content: ToolContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

// MCP Server configuration
export interface MCPServerConfig {
  command: string;           // Command to run (e.g., "npx", "python")
  args?: string[];           // Arguments to pass
  env?: Record<string, string>;  // Environment variables
  cwd?: string;              // Working directory
  description?: string;      // Human-readable description
}

// Protocol version
export const MCP_PROTOCOL_VERSION = '2025-11-25';
