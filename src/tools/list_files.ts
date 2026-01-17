import type { Tool, ToolDefinition } from './types';
import { readdir, stat } from 'fs/promises';
import { resolve, join } from 'path';

export class ListFilesTool implements Tool {
  definition: ToolDefinition = {
    name: 'list_files',
    description: 'List files and directories in a given path. Use this to explore the structure of a project or find files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list (defaults to current directory)',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const path = String(args.path || '.');
    const resolvedPath = resolve(path);

    try {
      const entries = await readdir(resolvedPath);
      const results: string[] = [];

      for (const entry of entries.sort()) {
        try {
          const entryPath = join(resolvedPath, entry);
          const stats = await stat(entryPath);
          const suffix = stats.isDirectory() ? '/' : '';
          results.push(`${entry}${suffix}`);
        } catch {
          results.push(entry);
        }
      }

      return results.join('\n') || '(empty directory)';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Directory not found: ${path}`);
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        throw new Error(`Path is not a directory: ${path}`);
      }
      throw error;
    }
  }
}
