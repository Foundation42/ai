import type { Tool, ToolDefinition } from './types';

const MAX_CONTENT_LENGTH = 100000; // 100KB limit
const TIMEOUT_MS = 30000; // 30 second timeout

export class WebFetchTool implements Tool {
  definition: ToolDefinition = {
    name: 'web_fetch',
    description: `Fetch content from a URL. Supports web pages, APIs, and raw files.
Returns the text content of the response. For HTML pages, returns the raw HTML.
Use this to fetch READMEs, documentation, API responses, or any web content.`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch (must be http:// or https://)',
        },
        headers: {
          type: 'object',
          description: 'Optional headers to include in the request',
        },
      },
      required: ['url'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url || '');
    const headers = args.headers as Record<string, string> | undefined;

    if (!url) {
      return 'Error: URL is required';
    }

    // Validate URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'Error: URL must start with http:// or https://';
    }

    try {
      new URL(url);
    } catch {
      return `Error: Invalid URL: ${url}`;
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ai-cli/1.0',
          ...headers,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';

      // Check content length if available
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_CONTENT_LENGTH) {
        return `Error: Content too large (${contentLength} bytes, max ${MAX_CONTENT_LENGTH})`;
      }

      // Read the response
      const text = await response.text();

      // Truncate if needed
      if (text.length > MAX_CONTENT_LENGTH) {
        return text.slice(0, MAX_CONTENT_LENGTH) + `\n\n[Truncated: content exceeded ${MAX_CONTENT_LENGTH} characters]`;
      }

      return text;
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
          return `Error: Request timed out after ${TIMEOUT_MS / 1000} seconds`;
        }
        return `Error: ${err.message}`;
      }
      return `Error: ${String(err)}`;
    }
  }
}
