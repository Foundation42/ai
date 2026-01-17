import type { Tool, ToolDefinition } from './types';
import { hostname, platform, arch, uptime, loadavg, totalmem, freemem, cpus } from 'os';

// Version is injected at build time via --define
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.1.0-dev';

export class VersionTool implements Tool {
  definition: ToolDefinition = {
    name: 'version',
    description: 'Get the current version and system information of this AI instance. Use this to check what version is running and basic system health.',
    parameters: {
      type: 'object',
      properties: {
        detailed: {
          type: 'boolean',
          description: 'Include detailed system information (memory, CPU, load)',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const detailed = Boolean(args.detailed);

    const info: Record<string, unknown> = {
      version: VERSION,
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      uptime: formatUptime(uptime()),
    };

    if (detailed) {
      const totalMem = totalmem();
      const freeMem = freemem();
      info.memory = {
        total: formatBytes(totalMem),
        free: formatBytes(freeMem),
        used: formatBytes(totalMem - freeMem),
        usedPercent: ((totalMem - freeMem) / totalMem * 100).toFixed(1) + '%',
      };
      info.cpus = cpus().length;
      info.load = loadavg().map(l => l.toFixed(2));
    }

    return JSON.stringify(info, null, 2);
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${mins}m`;
  } else if (hours > 0) {
    return `${hours}h ${mins}m`;
  } else {
    return `${mins}m`;
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}
