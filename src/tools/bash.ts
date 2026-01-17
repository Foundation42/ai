import type { Tool, ToolDefinition } from './types';

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[rf]+\s+)?[\/~]/i,  // rm with paths
  /\bsudo\b/i,
  /\bsystemctl\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bmkfs\b/i,
  /\bdd\b.*\bof=/i,
  />\s*\/dev\//i,
  /\bchmod\s+777\b/i,
  /\bchown\b.*\broot\b/i,
  /\b:(){ :|:& };:/,  // Fork bomb
];

export class BashTool implements Tool {
  definition: ToolDefinition = {
    name: 'bash',
    description: 'Execute a bash command on the local system. Use this to run shell commands, check system status, read files, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
      },
      required: ['command'],
    },
  };

  requiresConfirmation(args: Record<string, unknown>): boolean {
    const command = String(args.command || '');
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = String(args.command || '');

    if (!command.trim()) {
      return 'Error: No command provided';
    }

    try {
      const proc = Bun.spawn(['bash', '-c', command], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;

      let result = '';
      if (stdout.trim()) {
        result += stdout;
      }
      if (stderr.trim()) {
        result += (result ? '\n' : '') + `stderr: ${stderr}`;
      }
      if (exitCode !== 0) {
        result += (result ? '\n' : '') + `Exit code: ${exitCode}`;
      }

      return result || '(no output)';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error executing command: ${message}`;
    }
  }
}
