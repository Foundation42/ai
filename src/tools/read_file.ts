import type { Tool, ToolDefinition } from './types';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

export class ReadFileTool implements Tool {
  definition: ToolDefinition = {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to examine source code, configuration files, or any text file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to read (relative or absolute)',
        },
      },
      required: ['path'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const path = String(args.path || '');

    if (!path) {
      throw new Error('Path is required');
    }

    const resolvedPath = resolve(path);

    try {
      const content = await readFile(resolvedPath, 'utf-8');
      return content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${path}`);
      }
      if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
        throw new Error(`Path is a directory, not a file: ${path}`);
      }
      throw error;
    }
  }
}
