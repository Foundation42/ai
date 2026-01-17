/**
 * MCP HTTP Transport (Streamable HTTP)
 * Supports both modern (2025) and legacy (2024) MCP HTTP transports
 */

import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './types';

export interface HTTPTransport {
  send(message: JsonRpcRequest | JsonRpcNotification): Promise<void>;
  waitForResponse(id: number | string): Promise<JsonRpcResponse>;
  close(): Promise<void>;
  isAlive(): boolean;
}

export interface HTTPTransportConfig {
  url: string;  // MCP endpoint URL
  headers?: Record<string, string>;  // Optional headers (e.g., auth)
}

const PROTOCOL_VERSION = '2025-11-25';

/**
 * Create an HTTP transport for MCP
 */
export async function createHTTPTransport(config: HTTPTransportConfig): Promise<HTTPTransport> {
  let sessionId: string | null = null;
  let postEndpoint: string = config.url;
  let connected = true;
  let closed = false;  // Flag to signal readLoop to exit
  let sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let sseAbortController: AbortController | null = null;

  // Map of request ID -> resolver for pending responses
  const pendingResponses: Map<string | number, (response: JsonRpcResponse) => void> = new Map();

  // For legacy transport: try to open SSE connection to get endpoint
  let receivedEndpoint = false;

  const tryLegacySSE = async (): Promise<boolean> => {
    try {
      sseAbortController = new AbortController();
      const response = await fetch(config.url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          ...config.headers,
        },
        signal: sseAbortController.signal,
      });

      if (!response.ok || !response.body) {
        return false;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        return false;
      }

      // Parse SSE stream for endpoint event
      sseReader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const readLoop = async () => {
        if (!sseReader || closed) return;

        try {
          while (!closed) {
            const { done, value } = await sseReader.read();
            if (done || closed) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            let eventType = '';
            let eventData = '';

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                eventData += line.slice(5).trim();
              } else if (line === '' && eventData) {
                // Process event
                if (eventType === 'endpoint') {
                  // Legacy: server tells us where to POST
                  try {
                    const data = JSON.parse(eventData);
                    if (data.uri || data.endpoint || data.url) {
                      const endpoint = data.uri || data.endpoint || data.url;
                      postEndpoint = endpoint.startsWith('http')
                        ? endpoint
                        : new URL(endpoint, config.url).toString();
                      receivedEndpoint = true;
                    }
                  } catch (e) {
                    // Try as plain text endpoint
                    if (eventData.startsWith('/') || eventData.startsWith('http')) {
                      postEndpoint = eventData.startsWith('http')
                        ? eventData
                        : new URL(eventData, config.url).toString();
                      receivedEndpoint = true;
                    }
                  }
                } else if (eventType === 'message' || eventType === '') {
                  // JSON-RPC message from server
                  try {
                    const message = JSON.parse(eventData);
                            if (message.jsonrpc === '2.0' && 'id' in message && message.id !== undefined) {
                      const resolver = pendingResponses.get(message.id);
                      if (resolver) {
                        pendingResponses.delete(message.id);
                        resolver(message as JsonRpcResponse);
                      }
                    }
                  } catch (e) {
                    // Failed to parse SSE data
                  }
                }
                eventType = '';
                eventData = '';
              }
            }
          }
        } catch (e) {
          // Stream ended
        }
      };

      // Read SSE until we get the endpoint (or timeout)
      // We don't keep the SSE stream open for responses since modern servers
      // return JSON responses directly from POST requests
      const endpointPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 2000);
        const checkEndpoint = () => {
          if (receivedEndpoint) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(checkEndpoint, 50);
          }
        };
        checkEndpoint();
      });

      // Start reading for endpoint discovery
      readLoop();

      // Wait for endpoint (up to 2 seconds)
      await endpointPromise;

      // Close the SSE connection - we'll use POST responses, not SSE
      closed = true;
      if (sseAbortController) {
        sseAbortController.abort();
        sseAbortController = null;
      }
      if (sseReader) {
        try {
          await sseReader.cancel();
        } catch (e) {
          // Ignore
        }
        sseReader = null;
      }

      return receivedEndpoint;
    } catch (e) {
      return false;
    }
  };

  // Try legacy SSE first to get endpoint
  const gotEndpoint = await tryLegacySSE();

  // Reset closed flag (it was set during endpoint discovery cleanup)
  closed = false;

  // If we got an endpoint from SSE, we're good
  // Otherwise, for modern transport, the POST endpoint is the same as the URL
  if (!gotEndpoint) {
    postEndpoint = config.url;
  }

  // Queue to store responses that arrive before waitForResponse is called
  const earlyResponses: Map<string | number, JsonRpcResponse> = new Map();

  const transport: HTTPTransport = {
    async send(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        ...config.headers,
      };

      if (sessionId) {
        headers['MCP-Session-Id'] = sessionId;
      }

      const response = await fetch(postEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });

      const contentType = response.headers.get('content-type') || '';

      // Helper to handle a received response
      const handleResponse = (jsonResponse: JsonRpcResponse) => {
        const id = jsonResponse.id;
        const resolver = pendingResponses.get(id);
        if (resolver) {
          pendingResponses.delete(id);
          resolver(jsonResponse);
        } else {
          // Store for later pickup by waitForResponse
          earlyResponses.set(id, jsonResponse);
        }
      };

      // Check for session ID in response
      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId) {
        sessionId = newSessionId;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
      }

      // Handle response based on content type
      if (contentType.includes('application/json')) {
        // Direct JSON response
        const text = await response.text();
        if (text) {
          try {
            const jsonResponse = JSON.parse(text);
            if (jsonResponse.jsonrpc === '2.0' && 'id' in jsonResponse) {
              handleResponse(jsonResponse as JsonRpcResponse);
            }
          } catch (e) {
            // Not valid JSON
          }
        }
      } else if (contentType.includes('text/event-stream') && response.body) {
        // SSE stream response - read it for the response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventData = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data:')) {
                eventData += line.slice(5).trim();
              } else if (line === '' && eventData) {
                try {
                  const message = JSON.parse(eventData);
                  if (message.jsonrpc === '2.0' && 'id' in message && message.id !== undefined) {
                    handleResponse(message as JsonRpcResponse);
                  }
                } catch (e) {
                  // Ignore
                }
                eventData = '';
              }
            }
          }
        } catch (e) {
          // Stream ended
        }
      } else {
        // Unknown content type - try to read body anyway
        const text = await response.text();
        if (text) {
          try {
            const jsonResponse = JSON.parse(text);
            if (jsonResponse.jsonrpc === '2.0' && 'id' in jsonResponse) {
              handleResponse(jsonResponse as JsonRpcResponse);
            }
          } catch (e) {
            // Not valid JSON
          }
        }
      }
    },

    async waitForResponse(id: number | string): Promise<JsonRpcResponse> {
      // Check if response already arrived before we started waiting
      const early = earlyResponses.get(id);
      if (early) {
        earlyResponses.delete(id);
        return early;
      }

      // Otherwise wait for it
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingResponses.delete(id);
          reject(new Error(`Timeout waiting for response to request ${id}`));
        }, 30000);

        pendingResponses.set(id, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });
    },

    async close(): Promise<void> {
      connected = false;
      closed = true;  // Signal readLoop to exit
      if (sseAbortController) {
        sseAbortController.abort();
        sseAbortController = null;
      }
      if (sseReader) {
        try {
          await sseReader.cancel();
        } catch (e) {
          // Ignore
        }
        sseReader = null;
      }

      // Send DELETE to terminate session if we have one
      if (sessionId) {
        try {
          await fetch(postEndpoint, {
            method: 'DELETE',
            headers: {
              'MCP-Session-Id': sessionId,
              ...config.headers,
            },
          });
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    },

    isAlive(): boolean {
      return connected;
    },
  };

  return transport;
}
