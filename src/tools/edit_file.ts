import type { Tool, ToolDefinition } from './types';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

export class EditFileTool implements Tool {
  definition: ToolDefinition = {
    name: 'edit_file',
    description: 'Edit a file by replacing a specific string with a new string. The old_string must be unique in the file and must match exactly (including whitespace and indentation). Use read_file first to see the exact content you want to replace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find and replace (must be unique in the file)',
        },
        new_string: {
          type: 'string',
          description: 'The string to replace it with',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };

  requiresConfirmation(args: Record<string, unknown>): boolean {
    // Always require confirmation for file edits
    return true;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const path = String(args.path || '');
    const oldString = String(args.old_string || '');
    const newString = String(args.new_string ?? '');

    if (!path) {
      throw new Error('Path is required');
    }
    if (!oldString) {
      throw new Error('old_string is required');
    }
    if (oldString === newString) {
      throw new Error('old_string and new_string are identical');
    }

    const resolvedPath = resolve(path);

    // Read the file
    let content: string;
    try {
      content = await readFile(resolvedPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`File not found: ${path}`);
      }
      throw error;
    }

    // Check if old_string exists
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      throw new Error(`String not found in file. Make sure you're matching the exact content including whitespace.`);
    }
    if (occurrences > 1) {
      throw new Error(`String found ${occurrences} times in file. It must be unique. Include more surrounding context to make it unique.`);
    }

    // Perform the replacement
    const newContent = content.replace(oldString, newString);

    // Write the file
    await writeFile(resolvedPath, newContent, 'utf-8');

    // Generate a simple diff-like output
    const oldLines = oldString.split('\n').length;
    const newLines = newString.split('\n').length;
    const lineDiff = newLines - oldLines;
    const diffInfo = lineDiff === 0
      ? `${oldLines} line(s) modified`
      : lineDiff > 0
        ? `${oldLines} line(s) → ${newLines} line(s) (+${lineDiff})`
        : `${oldLines} line(s) → ${newLines} line(s) (${lineDiff})`;

    return `Successfully edited ${path}: ${diffInfo}`;
  }
}
