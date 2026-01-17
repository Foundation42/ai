import type { Provider, StreamOptions } from '../providers';

export async function streamToStdout(
  provider: Provider,
  prompt: string,
  options?: StreamOptions
): Promise<void> {
  const stream = provider.stream(prompt, options);

  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }

  // Ensure we end with a newline
  process.stdout.write('\n');
}

/**
 * Filters out <think>...</think> blocks from a stream.
 * Handles tags that may be split across chunks.
 */
export async function* filterThinking(
  stream: AsyncIterable<string>
): AsyncIterable<string> {
  let buffer = '';
  let inThinking = false;

  for await (const chunk of stream) {
    buffer += chunk;

    while (buffer.length > 0) {
      if (inThinking) {
        // Look for closing </think> tag
        const closeIdx = buffer.indexOf('</think>');
        if (closeIdx !== -1) {
          // Skip everything up to and including </think>
          buffer = buffer.slice(closeIdx + 8);
          inThinking = false;
          // Also skip any leading newlines after thinking block
          buffer = buffer.replace(/^\n+/, '');
        } else {
          // Haven't found closing tag yet, keep buffering
          // But keep last 7 chars in case "</think>" is split
          if (buffer.length > 7) {
            buffer = buffer.slice(-7);
          }
          break;
        }
      } else {
        // Look for opening <think> tag
        const openIdx = buffer.indexOf('<think>');
        if (openIdx !== -1) {
          // Output everything before <think>
          if (openIdx > 0) {
            yield buffer.slice(0, openIdx);
          }
          buffer = buffer.slice(openIdx + 7);
          inThinking = true;
        } else {
          // No <think> tag found
          // Keep last 6 chars in buffer in case "<think>" is split across chunks
          if (buffer.length > 6) {
            yield buffer.slice(0, -6);
            buffer = buffer.slice(-6);
          }
          break;
        }
      }
    }
  }

  // Output any remaining buffer (if not in thinking mode)
  if (!inThinking && buffer.length > 0) {
    yield buffer;
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8').trim();
}
