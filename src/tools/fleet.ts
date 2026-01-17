import type { Tool, ToolDefinition } from './types';
import {
  loadFleetConfig,
  queryFleetNode,
  queryFleetNodes,
  getFleetHealth,
  type FleetConfig,
} from '../fleet';

let cachedConfig: FleetConfig | null = null;

function getConfig(): FleetConfig {
  if (!cachedConfig) {
    cachedConfig = loadFleetConfig();
  }
  return cachedConfig;
}

export class FleetQueryTool implements Tool {
  definition: ToolDefinition = {
    name: 'fleet_query',
    description: `Query a remote fleet node to execute a prompt with tools on that machine.
Use this to ask remote servers questions, run commands, or gather information.
The remote AI will use its local tools (bash, read_file, etc.) to answer.`,
    parameters: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Name of the fleet node to query (or "all" for all nodes)',
        },
        prompt: {
          type: 'string',
          description: 'The prompt/question to send to the remote node',
        },
      },
      required: ['node', 'prompt'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const nodeName = String(args.node || '').toLowerCase();
    const prompt = String(args.prompt || '');

    if (!nodeName) {
      return 'Error: node name is required';
    }
    if (!prompt) {
      return 'Error: prompt is required';
    }

    const config = getConfig();

    if (config.nodes.length === 0) {
      return 'Error: No fleet nodes configured. Set AI_FLEET_NODES in ~/.aiconfig';
    }

    if (nodeName === 'all') {
      // Query all nodes
      const results = await queryFleetNodes(config.nodes, prompt);
      return results.map(r => {
        if (r.success) {
          return `@${r.node}: ${r.response}`;
        } else {
          return `@${r.node}: Error - ${r.error}`;
        }
      }).join('\n\n');
    }

    // Find specific node
    const node = config.nodes.find(n => n.name.toLowerCase() === nodeName);
    if (!node) {
      const available = config.nodes.map(n => n.name).join(', ');
      return `Error: Unknown node "${nodeName}". Available nodes: ${available || 'none'}`;
    }

    const result = await queryFleetNode(node, prompt);
    if (result.success) {
      return result.response || '(no response)';
    } else {
      return `Error: ${result.error}`;
    }
  }
}

export class FleetListTool implements Tool {
  definition: ToolDefinition = {
    name: 'fleet_list',
    description: 'List all configured fleet nodes and their health status',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  async execute(): Promise<string> {
    const config = getConfig();

    if (config.nodes.length === 0) {
      return 'No fleet nodes configured. Set AI_FLEET_NODES in ~/.aiconfig\nFormat: AI_FLEET_NODES=name1:http://host1:port,name2:http://host2:port';
    }

    const health = await getFleetHealth(config);

    const lines = ['Fleet Nodes:', ''];
    for (const h of health) {
      const status = h.healthy ? '✓ healthy' : '✗ offline';
      const info = h.info ? ` (${(h.info as { hostname?: string }).hostname || 'unknown'})` : '';
      lines.push(`  ${h.node}: ${status}${info}`);
    }

    return lines.join('\n');
  }
}

export class FleetBroadcastTool implements Tool {
  definition: ToolDefinition = {
    name: 'fleet_broadcast',
    description: 'Send a prompt to ALL fleet nodes and aggregate the responses. Use for fleet-wide queries like "check disk space on all servers".',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt/question to send to all fleet nodes',
        },
      },
      required: ['prompt'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const prompt = String(args.prompt || '');

    if (!prompt) {
      return 'Error: prompt is required';
    }

    const config = getConfig();

    if (config.nodes.length === 0) {
      return 'Error: No fleet nodes configured. Set AI_FLEET_NODES in ~/.aiconfig';
    }

    const results = await queryFleetNodes(config.nodes, prompt);

    const lines = [`Broadcast to ${results.length} nodes:`, ''];
    for (const r of results) {
      lines.push(`--- @${r.node} ---`);
      if (r.success) {
        lines.push(r.response || '(no response)');
      } else {
        lines.push(`Error: ${r.error}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
