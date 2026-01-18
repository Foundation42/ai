import type { Tool, ToolDefinition } from './types';
import {
  loadFleetConfig,
  queryFleetNode,
  queryFleetNodes,
  getFleetHealth,
  upgradeFleetNode,
  restartFleetNode,
  type FleetConfig,
} from '../fleet';

let cachedConfig: FleetConfig | null = null;

function getConfig(): FleetConfig {
  if (!cachedConfig) {
    cachedConfig = loadFleetConfig();
  }
  return cachedConfig;
}

// Track active sessions per node for conversation continuity
// NOTE: Sessions are in-memory and reset when CLI exits. If cross-invocation
// persistence is needed later, we could store session IDs to ~/.config/ai/fleet-sessions.json
const nodeSessions = new Map<string, string>();

export class FleetQueryTool implements Tool {
  definition: ToolDefinition = {
    name: 'fleet_query',
    description: `Query a remote fleet node to execute a prompt with tools on that machine.
Use this to ask remote servers questions, run commands, or gather information.
The remote AI will use its local tools (bash, read_file, etc.) to answer.
Conversations with each node are maintained - follow-up queries continue the same conversation.`,
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
        new_session: {
          type: 'boolean',
          description: 'Start a fresh conversation instead of continuing the previous one (default: false)',
        },
      },
      required: ['node', 'prompt'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const nodeName = String(args.node || '').toLowerCase();
    const prompt = String(args.prompt || '');
    const newSession = Boolean(args.new_session);

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
      // Query all nodes (no session tracking for broadcast)
      const results = await queryFleetNodes(config.nodes, prompt, { fleetTLS: config.tls });
      return results.map(r => {
        if (r.success) {
          let response = `@${r.node}: ${r.response}`;
          if (r.tools_executed?.length) {
            response += `\n[tools used: ${r.tools_executed.map(t => t.name).join(', ')}]`;
          }
          return response;
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

    // Get or clear session for this node
    let sessionId = newSession ? undefined : nodeSessions.get(node.name);

    const result = await queryFleetNode(node, prompt, {
      fleetTLS: config.tls,
      session_id: sessionId,
    });

    if (result.success) {
      // Store session for future queries
      if (result.session_id) {
        nodeSessions.set(node.name, result.session_id);
      }

      let response = result.response || '(no response)';

      // Include tools executed info so the caller knows what actions were taken
      if (result.tools_executed?.length) {
        response += `\n\n[Tools executed: ${result.tools_executed.map(t => t.name).join(', ')}]`;
      } else {
        response += '\n\n[No tools were executed]';
      }

      return response;
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

    const results = await queryFleetNodes(config.nodes, prompt, { fleetTLS: config.tls });

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

export class FleetUpgradeTool implements Tool {
  definition: ToolDefinition = {
    name: 'fleet_upgrade',
    description: 'Check for and perform upgrades on fleet nodes. Use "check" action to see available updates, or "upgrade" to perform the upgrade.',
    parameters: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Name of the fleet node to upgrade, or "all" for all nodes',
        },
        action: {
          type: 'string',
          enum: ['check', 'upgrade'],
          description: 'Action to perform: "check" to see if updates available, "upgrade" to perform upgrade',
        },
      },
      required: ['node', 'action'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const nodeName = String(args.node || '').toLowerCase();
    const action = String(args.action || 'check').toLowerCase();

    if (!nodeName) {
      return 'Error: node name is required';
    }

    const config = getConfig();

    if (config.nodes.length === 0) {
      return 'Error: No fleet nodes configured';
    }

    const nodes = nodeName === 'all'
      ? config.nodes
      : config.nodes.filter(n => n.name.toLowerCase() === nodeName);

    if (nodes.length === 0) {
      const available = config.nodes.map(n => n.name).join(', ');
      return `Error: Unknown node "${nodeName}". Available nodes: ${available}`;
    }

    const results: string[] = [];
    for (const node of nodes) {
      const result = await upgradeFleetNode(node, action === 'upgrade', config.tls);
      results.push(`@${node.name}: ${result.message}`);
    }

    return results.join('\n');
  }
}

export class FleetRestartTool implements Tool {
  definition: ToolDefinition = {
    name: 'fleet_restart',
    description: 'Restart fleet nodes to apply configuration changes or recover from issues. The node will exit gracefully and systemd will restart it.',
    parameters: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Name of the fleet node to restart, or "all" for all nodes',
        },
      },
      required: ['node'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const nodeName = String(args.node || '').toLowerCase();

    if (!nodeName) {
      return 'Error: node name is required';
    }

    const config = getConfig();

    if (config.nodes.length === 0) {
      return 'Error: No fleet nodes configured';
    }

    const nodes = nodeName === 'all'
      ? config.nodes
      : config.nodes.filter(n => n.name.toLowerCase() === nodeName);

    if (nodes.length === 0) {
      const available = config.nodes.map(n => n.name).join(', ');
      return `Error: Unknown node "${nodeName}". Available nodes: ${available}`;
    }

    const results: string[] = [];
    for (const node of nodes) {
      const result = await restartFleetNode(node, config.tls);
      results.push(`@${node.name}: ${result.message}`);
    }

    return results.join('\n');
  }
}
