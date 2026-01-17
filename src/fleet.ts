import pc from 'picocolors';
import { getFleetConfig as getConfigFleet, getFleetTLSConfig, loadCertFile, type FleetConfig as ConfigFleetConfig, type FleetTLSConfig } from './config';

export interface FleetNode {
  name: string;
  url: string;
  token?: string;
  description?: string;
  // Per-node TLS override
  clientCert?: string;
  clientKey?: string;
}

export interface FleetConfig {
  nodes: FleetNode[];
  defaultToken?: string;
  tls?: FleetTLSConfig;
}

export interface FleetQueryResult {
  node: string;
  success: boolean;
  response?: string;
  tools_executed?: Array<{ name: string; result: string }>;
  error?: string;
}

/**
 * Load fleet configuration from ~/.config/ai/config.json
 */
export function loadFleetConfig(): FleetConfig {
  const configFleet = getConfigFleet();
  const fleetTLS = getFleetTLSConfig();
  const nodes: FleetNode[] = [];

  for (const [name, nodeConfig] of Object.entries(configFleet.nodes || {})) {
    nodes.push({
      name,
      url: nodeConfig.url.startsWith('http') ? nodeConfig.url : `http://${nodeConfig.url}`,
      token: nodeConfig.token || configFleet.token,
      description: nodeConfig.description,
      clientCert: nodeConfig.clientCert,
      clientKey: nodeConfig.clientKey,
    });
  }

  return { nodes, defaultToken: configFleet.token, tls: fleetTLS };
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
 * Build TLS fetch options for a fleet node
 */
function buildTLSFetchOptions(node: FleetNode, fleetTLS?: FleetTLSConfig): { tls?: { cert: string; key: string; ca?: string } } {
  // Get cert paths (per-node overrides fleet defaults)
  const clientCert = node.clientCert || fleetTLS?.clientCert;
  const clientKey = node.clientKey || fleetTLS?.clientKey;
  const ca = fleetTLS?.ca;

  if (clientCert && clientKey) {
    try {
      return {
        tls: {
          cert: loadCertFile(clientCert),
          key: loadCertFile(clientKey),
          ca: ca ? loadCertFile(ca) : undefined,
        },
      };
    } catch (err) {
      // Return empty if cert loading fails - error will be caught in queryFleetNode
      console.error(pc.dim(`Warning: Failed to load TLS certs for ${node.name}: ${err}`));
    }
  }

  return {};
}

/**
 * Query a single fleet node
 */
export async function queryFleetNode(
  node: FleetNode,
  prompt: string,
  options: { model?: string; system?: string; fleetTLS?: FleetTLSConfig } = {}
): Promise<FleetQueryResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (node.token) {
      headers['Authorization'] = `Bearer ${node.token}`;
    }

    // Build TLS options if configured
    const tlsOptions = buildTLSFetchOptions(node, options.fleetTLS);

    const response = await fetch(`${node.url}/v1/fleet/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        model: options.model,
        system: options.system,
      }),
      ...tlsOptions,
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
  options: { model?: string; system?: string; verbose?: boolean; fleetTLS?: FleetTLSConfig } = {}
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
        const tlsOptions = buildTLSFetchOptions(node, config.tls);
        const response = await fetch(`${node.url}/v1/fleet/health`, {
          signal: AbortSignal.timeout(5000),
          ...tlsOptions,
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

export interface UpgradeResult {
  success: boolean;
  message: string;
  currentVersion?: string;
  latestVersion?: string;
}

/**
 * Check for or perform upgrade on a fleet node
 */
export async function upgradeFleetNode(
  node: FleetNode,
  performUpgrade: boolean = false,
  fleetTLS?: FleetTLSConfig
): Promise<UpgradeResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (node.token) {
      headers['Authorization'] = `Bearer ${node.token}`;
    }

    const tlsOptions = buildTLSFetchOptions(node, fleetTLS);
    const method = performUpgrade ? 'POST' : 'GET';
    const response = await fetch(`${node.url}/v1/fleet/upgrade`, {
      method,
      headers,
      signal: AbortSignal.timeout(60000), // Longer timeout for upgrades
      ...tlsOptions,
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        message: `HTTP ${response.status}: ${error}`,
      };
    }

    const data = await response.json() as {
      success?: boolean;
      message: string;
      currentVersion?: string;
      latestVersion?: string;
      upgradeAvailable?: boolean;
    };

    return {
      success: data.success !== false,
      message: data.message,
      currentVersion: data.currentVersion,
      latestVersion: data.latestVersion,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface RestartResult {
  success: boolean;
  message: string;
  version?: string;
}

/**
 * Restart a fleet node
 */
export async function restartFleetNode(
  node: FleetNode,
  fleetTLS?: FleetTLSConfig
): Promise<RestartResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (node.token) {
      headers['Authorization'] = `Bearer ${node.token}`;
    }

    const tlsOptions = buildTLSFetchOptions(node, fleetTLS);
    const response = await fetch(`${node.url}/v1/fleet/restart`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
      ...tlsOptions,
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        message: `HTTP ${response.status}: ${error}`,
      };
    }

    const data = await response.json() as {
      success?: boolean;
      message: string;
      version?: string;
    };

    return {
      success: data.success !== false,
      message: data.message,
      version: data.version,
    };
  } catch (err) {
    // Connection reset is expected when server restarts
    if (err instanceof Error && (err.message.includes('ECONNRESET') || err.message.includes('socket'))) {
      return {
        success: true,
        message: 'Server restarting (connection closed)',
      };
    }
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
