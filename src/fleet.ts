import pc from 'picocolors';

export interface FleetNode {
  name: string;
  url: string;
  token?: string;
}

export interface FleetConfig {
  nodes: FleetNode[];
  defaultToken?: string;
}

export interface FleetQueryResult {
  node: string;
  success: boolean;
  response?: string;
  tools_executed?: Array<{ name: string; result: string }>;
  error?: string;
}

/**
 * Parse fleet configuration from environment/config
 * Format in ~/.aiconfig:
 *   AI_FLEET_NODES=name1:url1,name2:url2
 *   AI_FLEET_TOKEN=default-token
 *   AI_FLEET_TOKEN_name1=specific-token
 */
export function loadFleetConfig(): FleetConfig {
  const nodes: FleetNode[] = [];
  const defaultToken = process.env.AI_FLEET_TOKEN;

  // Parse AI_FLEET_NODES=name:url,name:url
  const nodesEnv = process.env.AI_FLEET_NODES || '';
  for (const entry of nodesEnv.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const name = trimmed.slice(0, colonIdx).trim();
    const url = trimmed.slice(colonIdx + 1).trim();

    if (name && url) {
      // Check for node-specific token
      const nodeToken = process.env[`AI_FLEET_TOKEN_${name.replace(/-/g, '_').toUpperCase()}`];
      nodes.push({
        name,
        url: url.startsWith('http') ? url : `http://${url}`,
        token: nodeToken || defaultToken,
      });
    }
  }

  return { nodes, defaultToken };
}

/**
 * Parse @ mentions from a prompt
 * Returns: { mentions: ['node1', 'node2'], cleanPrompt: 'prompt without mentions' }
 */
export function parseMentions(prompt: string): { mentions: string[]; cleanPrompt: string } {
  const mentionRegex = /@([\w-]+)/g;
  const mentions: string[] = [];
  let match;

  while ((match = mentionRegex.exec(prompt)) !== null) {
    mentions.push(match[1]!.toLowerCase());
  }

  const cleanPrompt = prompt.replace(mentionRegex, '').replace(/\s+/g, ' ').trim();

  return { mentions, cleanPrompt };
}

/**
 * Resolve mentions to fleet nodes
 * Supports: @all, @node-name, @node-* (wildcard)
 */
export function resolveMentions(mentions: string[], config: FleetConfig): FleetNode[] {
  const resolved: FleetNode[] = [];

  for (const mention of mentions) {
    if (mention === 'all') {
      // @all - return all nodes
      return config.nodes;
    }

    if (mention.includes('*')) {
      // Wildcard matching
      const pattern = new RegExp('^' + mention.replace(/\*/g, '.*') + '$');
      for (const node of config.nodes) {
        if (pattern.test(node.name) && !resolved.includes(node)) {
          resolved.push(node);
        }
      }
    } else {
      // Exact match
      const node = config.nodes.find(n => n.name.toLowerCase() === mention);
      if (node && !resolved.includes(node)) {
        resolved.push(node);
      }
    }
  }

  return resolved;
}

/**
 * Query a single fleet node
 */
export async function queryFleetNode(
  node: FleetNode,
  prompt: string,
  options: { model?: string; system?: string } = {}
): Promise<FleetQueryResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (node.token) {
      headers['Authorization'] = `Bearer ${node.token}`;
    }

    const response = await fetch(`${node.url}/v1/fleet/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        model: options.model,
        system: options.system,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        node: node.name,
        success: false,
        error: `HTTP ${response.status}: ${error}`,
      };
    }

    const data = await response.json() as {
      success: boolean;
      response: string;
      tools_executed?: Array<{ name: string; result: string }>;
      error?: { message: string };
    };

    if (data.success) {
      return {
        node: node.name,
        success: true,
        response: data.response,
        tools_executed: data.tools_executed,
      };
    } else {
      return {
        node: node.name,
        success: false,
        error: data.error?.message || 'Unknown error',
      };
    }
  } catch (err) {
    return {
      node: node.name,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Query multiple fleet nodes in parallel
 */
export async function queryFleetNodes(
  nodes: FleetNode[],
  prompt: string,
  options: { model?: string; system?: string; verbose?: boolean } = {}
): Promise<FleetQueryResult[]> {
  if (options.verbose) {
    console.error(pc.dim(`\n📡 Querying ${nodes.length} fleet node(s): ${nodes.map(n => n.name).join(', ')}`));
  }

  const results = await Promise.all(
    nodes.map(node => queryFleetNode(node, prompt, options))
  );

  return results;
}

/**
 * Format fleet results for display
 */
export function formatFleetResults(results: FleetQueryResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    lines.push(`\n**@${result.node}**`);
    if (result.success) {
      lines.push(result.response || '(no response)');
      if (result.tools_executed?.length) {
        lines.push(pc.dim(`  [executed: ${result.tools_executed.map(t => t.name).join(', ')}]`));
      }
    } else {
      lines.push(pc.red(`Error: ${result.error}`));
    }
  }

  return lines.join('\n');
}

/**
 * Get fleet status (health check all nodes)
 */
export async function getFleetHealth(config: FleetConfig): Promise<Array<{ node: string; healthy: boolean; info?: Record<string, unknown> }>> {
  const results = await Promise.all(
    config.nodes.map(async node => {
      try {
        const response = await fetch(`${node.url}/v1/fleet/health`, {
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const info = await response.json() as Record<string, unknown>;
          return { node: node.name, healthy: true, info };
        }
        return { node: node.name, healthy: false };
      } catch {
        return { node: node.name, healthy: false };
      }
    })
  );

  return results;
}
