/**
 * MCP stdio Transport
 * Handles spawning MCP servers as subprocesses and communicating via stdin/stdout
 */

import { spawn } from 'bun';
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, MCPServerConfig } from './types';

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface StdioTransport {
  send(message: JsonRpcRequest | JsonRpcNotification): Promise<void>;
  waitForResponse(id: number | string): Promise<JsonRpcResponse>;
  close(): Promise<void>;
  isAlive(): boolean;
}

/**
 * Create a stdio transport by spawning an MCP server process
 */
export async function createStdioTransport(config: MCPServerConfig): Promise<StdioTransport> {
  const proc = spawn({
    cmd: [config.command, ...(config.args || [])],
    cwd: config.cwd,
    env: { ...process.env, ...config.env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Map of request ID -> resolver for pending responses
  const pendingResponses: Map<string | number, (response: JsonRpcResponse) => void> = new Map();

  // Buffer for incomplete messages
  let buffer = '';

  // Bun's stdout is a ReadableStream
  const stdout = proc.stdout;
  const decoder = new TextDecoder();

  // Read stdout in background
  const readLoop = async () => {
    try {
      const reader = stdout.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (newline-delimited JSON)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line);

              // Check if this is a JSON-RPC message
              if (message.jsonrpc === '2.0') {
                // If it has an 'id', it's a response to a request
                if ('id' in message && message.id !== undefined) {
                  const resolver = pendingResponses.get(message.id);
                  if (resolver) {
                    pendingResponses.delete(message.id);
                    resolver(message as JsonRpcResponse);
                  }
                }
                // Otherwise it's a notification - we can ignore or log it
                // Notifications have no 'id' field
              }
            } catch (e) {
              // Not valid JSON - ignore
            }
          }
        }
      }
    } catch (e) {
      // Process ended or error - reject any pending responses
      for (const [id, resolver] of pendingResponses) {
        resolver({
          jsonrpc: '2.0',
          id,
          error: { code: -1, message: 'Transport closed' },
        });
      }
      pendingResponses.clear();
    }
  };

  // Start reading in background
  readLoop();

  // Log stderr for debugging
  const stderrLoop = async () => {
    try {
      const reader = proc.stderr.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        if (text.trim()) {
          console.error(`[MCP stderr] ${text.trim()}`);
        }
      }
    } catch (e) {
      // Ignore
    }
  };
  stderrLoop();

  // Bun's stdin is a FileSink when using 'pipe'
  const stdin = proc.stdin;

  // Give the process a moment to start up
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    async send(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
      const json = JSON.stringify(message) + '\n';
      stdin.write(json);
      stdin.flush();
    },

    async waitForResponse(id: number | string): Promise<JsonRpcResponse> {
      return new Promise((resolve, reject) => {
        // Set up timeout
        const timeout = setTimeout(() => {
          pendingResponses.delete(id);
          reject(new Error(`Timeout waiting for response to request ${id}`));
        }, 30000);

        // Register the resolver
        pendingResponses.set(id, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });
    },

    async close(): Promise<void> {
      try {
        stdin.end();
      } catch (e) {
        // Ignore close errors
      }
      proc.kill();
    },

    isAlive(): boolean {
      return proc.exitCode === null;
    },
  };
}
