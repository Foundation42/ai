import type { StreamChunk } from '../providers';

/**
 * Filters out <think>...</think> blocks from a stream.
 * Handles tags that may be split across chunks.
 * Passes through tool_call chunks unchanged.
 */
export async function* filterThinking(
  stream: AsyncIterable<StreamChunk>
): AsyncIterable<StreamChunk> {
  let buffer = '';
  let inThinking = false;

  for await (const chunk of stream) {
    // Pass through tool calls unchanged
    if (chunk.type === 'tool_call') {
      yield chunk;
      continue;
    }

    buffer += chunk.content;

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
            yield { type: 'text', content: buffer.slice(0, openIdx) };
          }
          buffer = buffer.slice(openIdx + 7);
          inThinking = true;
        } else {
          // No <think> tag found
          // Keep last 6 chars in buffer in case "<think>" is split across chunks
          if (buffer.length > 6) {
            yield { type: 'text', content: buffer.slice(0, -6) };
            buffer = buffer.slice(-6);
          }
          break;
        }
      }
    }
  }

  // Output any remaining buffer (if not in thinking mode)
  if (!inThinking && buffer.length > 0) {
    yield { type: 'text', content: buffer };
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8').trim();
}
