import { homedir } from 'os';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';

const CONFIG_DIR = join(homedir(), '.config', 'ai');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

// Server TLS config
export interface ServerTLSConfig {
  enabled?: boolean;
  cert: string;      // Path to server certificate
  key: string;       // Path to server private key
  ca?: string;       // Path to CA cert for client verification
  requestCert?: boolean;  // Require client certs (default: true when ca provided)
}

// Fleet TLS config (client-side)
export interface FleetTLSConfig {
  ca?: string;           // CA cert for server verification
  clientCert?: string;   // Default client cert for all nodes
  clientKey?: string;    // Default client key for all nodes
}

export interface FleetNodeConfig {
  url: string;
  token?: string;
  description?: string;
  systemPrompt?: string;
  // TLS fields for per-node override
  clientCert?: string;   // Per-node client cert override
  clientKey?: string;    // Per-node client key override
}

export interface FleetConfig {
  token?: string;
  tls?: FleetTLSConfig;
  nodes: Record<string, FleetNodeConfig>;
}

export interface AutoUpgradeConfig {
  enabled?: boolean;      // Enable periodic polling (default: false)
  interval?: number;      // Poll interval in ms (default: 60000 = 1 minute)
}

// Scheduled task configuration
export interface ScheduledTask {
  name: string;              // Task identifier
  schedule: string;          // Cron expression or "@every 5m", "@hourly", etc.
  prompt: string;            // The prompt to execute
  enabled?: boolean;         // Default true
  condition?: {              // Optional conditions to run
    maxLoad?: number;        // Only run if system load < threshold (e.g., 0.8)
    minLoad?: number;        // Only run if system load > threshold (for triggers)
  };
  handoff?: {                // Load-based handoff to peers
    enabled: boolean;        // Enable handoff when busy
    loadThreshold: number;   // Hand off if local load > this (e.g., 0.7)
    peers?: string[];        // Specific peers, or omit for all mesh peers
    prompt?: string;         // Custom handoff prompt (default: original prompt)
  };
}

export interface KnowledgeSyncConfig {
  enabled?: boolean;         // Enable automatic knowledge sync (default: false)
  interval?: number;         // Sync interval in ms (default: 300000 = 5 minutes)
  categories?: Array<'learning' | 'solution' | 'observation' | 'note'>;  // Categories to sync (default: all)
  peers?: string[];          // Specific peers to sync with (default: all)
}

// Memory TTL configuration
export interface MemoryTTLConfig {
  enabled?: boolean;            // Enable TTL enforcement (default: false)
  cleanupInterval?: number;     // Cleanup interval in ms (default: 3600000 = 1 hour)
  defaultTTL?: {                // Default TTL per category in ms
    learning?: number;          // Default: 30 days
    solution?: number;          // Default: 90 days (solutions are valuable longer)
    observation?: number;       // Default: 7 days
    note?: number;              // Default: 14 days
  };
}

// Event hook types
export type EventType =
  | 'disk_usage'      // Disk usage exceeds threshold
  | 'memory_usage'    // Memory usage exceeds threshold
  | 'load_average'    // System load exceeds threshold
  | 'service_down'    // systemd service is not running
  | 'service_up'      // systemd service started running
  | 'file_exists'     // File appears
  | 'file_missing'    // File disappears
  | 'file_changed'    // File modification time changed
  | 'command_fails'   // Command exits with non-zero
  | 'command_succeeds'// Command exits with zero
  | 'command_output'  // Command output matches pattern
  | 'http_down'       // HTTP endpoint returns error
  | 'http_up'         // HTTP endpoint becomes available
  | 'port_open'       // TCP port is open
  | 'port_closed';    // TCP port is closed

export interface EventCondition {
  type: EventType;
  // For disk_usage, memory_usage, load_average
  threshold?: number;           // e.g., 0.9 for 90%
  // For disk_usage
  path?: string;                // Mount point to check (default: /)
  // For service_down/service_up
  service?: string;             // systemd service name
  // For file_exists/file_missing/file_changed
  file?: string;                // File path to check
  // For command_* events
  command?: string;             // Command to run
  pattern?: string;             // Regex pattern for command_output
  // For http_down/http_up
  url?: string;                 // URL to check
  expectedStatus?: number;      // Expected HTTP status (default: 200)
  // For port_open/port_closed
  host?: string;                // Host to check (default: localhost)
  port?: number;                // Port number
}

export interface EventHook {
  name: string;                 // Unique identifier
  enabled?: boolean;            // Default: true
  event: EventCondition;        // What to watch for
  prompt: string;               // Prompt to execute when triggered
  cooldown?: number;            // Minimum time between triggers in ms (default: 300000 = 5 min)
  notifyPeers?: boolean;        // Send alert to peer nodes
  peerPrompt?: string;          // Custom prompt for peer notification
}

export interface EventHooksConfig {
  enabled?: boolean;            // Master switch (default: false)
  checkInterval?: number;       // How often to check conditions in ms (default: 30000 = 30s)
  hooks?: EventHook[];          // List of event hooks
}

export interface SchedulerConfig {
  enabled?: boolean;         // Master switch (default: false)
  tasks?: ScheduledTask[];   // List of scheduled tasks
  knowledgeSync?: KnowledgeSyncConfig;  // Automatic knowledge sync config
  memoryTTL?: MemoryTTLConfig;          // Memory expiry and cleanup config
  eventHooks?: EventHooksConfig;        // Event-driven triggers
}

export interface ServerConfig {
  port?: number;
  token?: string;
  tls?: ServerTLSConfig;
  autoConfirm?: boolean;  // Auto-confirm dangerous commands (use with caution)
  autoUpgrade?: AutoUpgradeConfig;  // Auto-upgrade polling config
  scheduler?: SchedulerConfig;      // Scheduled tasks config
}

// MCP Server configuration (local stdio or remote SSE)
export interface MCPServerConfig {
  // For local stdio servers:
  command?: string;          // Command to run (e.g., "npx", "python")
  args?: string[];           // Arguments to pass
  env?: Record<string, string>;  // Environment variables
  cwd?: string;              // Working directory
  // For remote SSE servers:
  url?: string;              // SSE endpoint URL (e.g., "https://mcp.example.com/sse")
  headers?: Record<string, string>;  // HTTP headers (e.g., auth tokens)
  // Common:
  description?: string;      // Human-readable description
}

export interface AIConfig {
  providers?: {
    default?: string;
    google?: ProviderConfig;
    anthropic?: ProviderConfig;
    openai?: ProviderConfig;
    mistral?: ProviderConfig;
    deepseek?: ProviderConfig;
    ollama?: ProviderConfig;
  };
  server?: ServerConfig;
  fleet?: FleetConfig;
  mcp?: {
    servers?: Record<string, MCPServerConfig>;
  };
  defaults?: {
    model?: string;
    verbosity?: 'quiet' | 'normal' | 'verbose';
    autoConfirm?: boolean;
    systemPrompt?: string;
  };
}

let cachedConfig: AIConfig | null = null;

/**
 * Load configuration from ~/.config/ai/config.json
 */
export function loadConfig(): AIConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    if (existsSync(CONFIG_PATH)) {
      const content = require('fs').readFileSync(CONFIG_PATH, 'utf-8');
      cachedConfig = JSON.parse(content) as AIConfig;

      // Set environment variables from config for providers
      const providers = cachedConfig.providers || {};
      if (providers.google?.apiKey) {
        process.env.GOOGLE_API_KEY = providers.google.apiKey;
      }
      if (providers.anthropic?.apiKey) {
        process.env.ANTHROPIC_API_KEY = providers.anthropic.apiKey;
      }
      if (providers.openai?.apiKey) {
        process.env.OPENAI_API_KEY = providers.openai.apiKey;
      }
      if (providers.mistral?.apiKey) {
        process.env.MISTRAL_API_KEY = providers.mistral.apiKey;
      }
      if (providers.deepseek?.apiKey) {
        process.env.DEEPSEEK_API_KEY = providers.deepseek.apiKey;
      }
      if (providers.ollama?.baseUrl) {
        process.env.OLLAMA_HOST = providers.ollama.baseUrl;
      }

      return cachedConfig;
    }
  } catch (err) {
    console.error(`Warning: Failed to load config from ${CONFIG_PATH}:`, err);
  }

  cachedConfig = {};
  return cachedConfig;
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Ensure config directory exists
 */
export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: AIConfig): void {
  ensureConfigDir();
  require('fs').writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  cachedConfig = config;
}

/**
 * Get fleet configuration
 */
export function getFleetConfig(): FleetConfig {
  const config = loadConfig();
  return config.fleet || { nodes: {} };
}

/**
 * Get default provider name
 */
export function getDefaultProvider(): string | undefined {
  const config = loadConfig();
  return config.providers?.default || config.defaults?.model?.split(':')[0];
}

/**
 * Get default model
 */
export function getDefaultModel(): string | undefined {
  const config = loadConfig();
  return config.defaults?.model;
}

/**
 * Get default system prompt (personality/role)
 */
export function getDefaultSystemPrompt(): string | undefined {
  const config = loadConfig();
  return config.defaults?.systemPrompt;
}

/**
 * Load a certificate file from disk
 * Supports ~ expansion for home directory
 */
export function loadCertFile(path: string): string {
  const resolved = path.startsWith('~')
    ? path.replace('~', process.env.HOME || homedir())
    : resolve(path);

  if (!existsSync(resolved)) {
    throw new Error(`Certificate file not found: ${resolved}`);
  }
  return readFileSync(resolved, 'utf-8');
}

/**
 * Get server configuration
 */
export function getServerConfig(): ServerConfig | undefined {
  const config = loadConfig();
  return config.server;
}

/**
 * Get server TLS configuration
 */
export function getServerTLSConfig(): ServerTLSConfig | undefined {
  const config = loadConfig();
  return config.server?.tls;
}

/**
 * Get fleet TLS configuration
 */
export function getFleetTLSConfig(): FleetTLSConfig | undefined {
  const config = loadConfig();
  return config.fleet?.tls;
}

/**
 * Get server autoConfirm setting
 */
export function getServerAutoConfirm(): boolean {
  const config = loadConfig();
  return config.server?.autoConfirm ?? false;
}

/**
 * Get auto-upgrade configuration
 */
export function getAutoUpgradeConfig(): AutoUpgradeConfig {
  const config = loadConfig();
  return config.server?.autoUpgrade || { enabled: false };
}

/**
 * Get scheduler configuration
 */
export function getSchedulerConfig(): SchedulerConfig {
  const config = loadConfig();
  return config.server?.scheduler || { enabled: false, tasks: [] };
}

/**
 * Get knowledge sync configuration
 */
export function getKnowledgeSyncConfig(): KnowledgeSyncConfig {
  const config = loadConfig();
  return config.server?.scheduler?.knowledgeSync || { enabled: false };
}

/**
 * Get memory TTL configuration with defaults
 */
export function getMemoryTTLConfig(): MemoryTTLConfig & { defaultTTL: Required<MemoryTTLConfig['defaultTTL']> } {
  const config = loadConfig();
  const ttlConfig = config.server?.scheduler?.memoryTTL || {};

  // Default TTLs in milliseconds
  const DAY = 24 * 60 * 60 * 1000;

  return {
    enabled: ttlConfig.enabled ?? false,
    cleanupInterval: ttlConfig.cleanupInterval ?? 60 * 60 * 1000, // 1 hour
    defaultTTL: {
      learning: ttlConfig.defaultTTL?.learning ?? 30 * DAY,      // 30 days
      solution: ttlConfig.defaultTTL?.solution ?? 90 * DAY,      // 90 days
      observation: ttlConfig.defaultTTL?.observation ?? 7 * DAY, // 7 days
      note: ttlConfig.defaultTTL?.note ?? 14 * DAY,              // 14 days
    },
  };
}

/**
 * Get event hooks configuration
 */
export function getEventHooksConfig(): EventHooksConfig {
  const config = loadConfig();
  return config.server?.scheduler?.eventHooks || { enabled: false, hooks: [] };
}

/**
 * Get MCP servers configuration
 */
export function getMCPServersConfig(): Record<string, MCPServerConfig> {
  const config = loadConfig();
  return config.mcp?.servers || {};
}

export type Verbosity = 'quiet' | 'normal' | 'verbose';

export interface CLIArgs {
  prompt: string[];
  model?: string;
  systemPrompt?: string;
  help: boolean;
  version: boolean;
  verbosity: Verbosity;
  yes: boolean;
  map: boolean;
  reduce?: string;
  glob?: string;
  server: boolean;
  port: number;
  token?: string;
  configInit?: boolean;
  // TLS options
  cert?: string;   // Server certificate path
  key?: string;    // Server private key path
  ca?: string;     // CA certificate path for client verification
}

export function parseArgs(args: string[]): CLIArgs {
  const config = loadConfig();

  const result: CLIArgs = {
    prompt: [],
    help: false,
    version: false,
    verbosity: config.defaults?.verbosity || 'normal',
    yes: config.defaults?.autoConfirm || false,
    map: false,
    server: false,
    port: 8080,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-V' || arg === '--version') {
      result.version = true;
    } else if (arg === '-m' || arg === '--model') {
      result.model = args[++i];
    } else if (arg === '-s' || arg === '--system') {
      result.systemPrompt = args[++i];
    } else if (arg === '-v' || arg === '--verbose') {
      result.verbosity = 'verbose';
    } else if (arg === '-q' || arg === '--quiet') {
      result.verbosity = 'quiet';
    } else if (arg === '-y' || arg === '--yes') {
      result.yes = true;
    } else if (arg === '--map') {
      result.map = true;
    } else if (arg === '--reduce') {
      result.reduce = args[++i];
    } else if (arg === '--glob' || arg === '-g') {
      result.glob = args[++i];
      result.map = true; // --glob implies --map
    } else if (arg === '--server') {
      result.server = true;
    } else if (arg === '--port' || arg === '-p') {
      result.port = parseInt(args[++i] || '8080', 10);
    } else if (arg === '--token') {
      result.token = args[++i];
    } else if (arg === '--config-init') {
      result.configInit = true;
    } else if (arg === '--cert') {
      result.cert = args[++i];
    } else if (arg === '--key') {
      result.key = args[++i];
    } else if (arg === '--ca') {
      result.ca = args[++i];
    } else if (!arg.startsWith('-')) {
      result.prompt.push(arg);
    }

    i++;
  }

  // Apply default model if not specified
  if (!result.model && config.defaults?.model) {
    result.model = config.defaults.model;
  }

  return result;
}

export function printHelp(): void {
  console.log(`
ai - LLM CLI tool

Usage:
  ai [options] [prompt...]
  echo "input" | ai [options] [prompt...]

Options:
  -m, --model <provider:model>  Specify provider and model (e.g., openai:gpt-4o)
  -s, --system <prompt>         Set system prompt
  -v, --verbose                 Show tool call outputs
  -q, --quiet                   Hide tool calls entirely
  -y, --yes                     Auto-confirm tool executions (use with caution)
  --map                         Process each stdin line separately
  --reduce <prompt>             Combine map results with a final prompt
  -g, --glob <pattern>          Expand glob pattern and process each file (implies --map)
  -h, --help                    Show this help message
  -V, --version                 Show version

Server Mode:
  --server                      Start as HTTP server (OpenAI-compatible API)
  -p, --port <port>             Server port (default: 8080)
  --token <token>               Bearer token for auth (or set in config)
  --cert <path>                 Server certificate file (enables HTTPS)
  --key <path>                  Server private key file
  --ca <path>                   CA certificate for client verification (enables mTLS)

Configuration:
  --config-init                 Create a template config file
  Config file: ~/.config/ai/config.json

Providers:
  google      Google Gemini API
  anthropic   Anthropic API
  openai      OpenAI API
  mistral     Mistral API
  deepseek    DeepSeek API
  ollama      Local Ollama instance

Fleet Commands:
  @nodename <prompt>            Query a specific fleet node
  @all <prompt>                 Broadcast to all fleet nodes

Examples:
  ai "What is the capital of France?"
  ai -m openai:gpt-4o "Explain quantum computing"
  ai "@server1 check disk space"
  ai "@all report memory usage"
`);
}

/**
 * Create a template config file
 */
export function createTemplateConfig(): void {
  const template: AIConfig = {
    providers: {
      default: "google",
      google: {
        apiKey: "your-google-api-key"
      },
      anthropic: {
        apiKey: "your-anthropic-api-key"
      },
      openai: {
        apiKey: "your-openai-api-key"
      },
      mistral: {
        apiKey: "your-mistral-api-key"
      },
      deepseek: {
        apiKey: "your-deepseek-api-key"
      },
      ollama: {
        baseUrl: "http://localhost:11434"
      }
    },
    server: {
      port: 9090,
      token: "your-server-token",
      autoConfirm: true,  // Allow dangerous commands like systemctl
      autoUpgrade: {
        enabled: true,     // Enable periodic upgrade checks
        interval: 60000    // Check every minute (in milliseconds)
      },
      scheduler: {
        enabled: true,     // Enable scheduled tasks
        tasks: [
          {
            name: "health-check",
            schedule: "@every 5m",   // Every 5 minutes
            prompt: "Check system health: disk space, memory, and load average"
          },
          {
            name: "load-handoff",
            schedule: "@every 1m",   // Check every minute
            prompt: "Monitor system load",
            condition: {
              minLoad: 0.7           // Only trigger when load > 70%
            },
            handoff: {
              enabled: true,
              loadThreshold: 0.7,    // Hand off if local load > 70%
              prompt: "I'm getting busy over here - can you help with some analysis?"
            }
          }
        ],
        knowledgeSync: {
          enabled: true,           // Enable automatic knowledge sync
          interval: 300000         // Sync every 5 minutes
        },
        memoryTTL: {
          enabled: true,           // Enable memory expiry
          cleanupInterval: 3600000, // Cleanup every hour
          defaultTTL: {
            learning: 2592000000,  // 30 days
            solution: 7776000000,  // 90 days
            observation: 604800000, // 7 days
            note: 1209600000       // 14 days
          }
        },
        eventHooks: {
          enabled: true,           // Enable event-driven triggers
          checkInterval: 30000,    // Check conditions every 30 seconds
          hooks: [
            {
              name: "disk-alert",
              event: { type: "disk_usage", threshold: 0.9, path: "/" },
              prompt: "Disk usage is critical! Find large files and suggest cleanup",
              cooldown: 3600000,   // 1 hour cooldown
              notifyPeers: true,
              peerPrompt: "My disk is nearly full - heads up!"
            },
            {
              name: "nginx-down",
              event: { type: "service_down", service: "nginx" },
              prompt: "Nginx is down! Check status and try to restart it",
              cooldown: 300000     // 5 minute cooldown
            },
            {
              name: "api-health",
              event: { type: "http_down", url: "http://localhost:3000/health" },
              prompt: "API health check failed! Investigate and report status",
              cooldown: 60000      // 1 minute cooldown
            }
          ]
        }
      },
      tls: {
        cert: "~/.config/ai/certs/server.pem",
        key: "~/.config/ai/certs/server-key.pem",
        ca: "~/.config/ai/certs/ca.pem"
      }
    },
    fleet: {
      token: "your-fleet-token",
      tls: {
        ca: "~/.config/ai/certs/ca.pem",
        clientCert: "~/.config/ai/certs/client.pem",
        clientKey: "~/.config/ai/certs/client-key.pem"
      },
      nodes: {
        "example-server": {
          url: "https://example.com:9443",
          description: "Example fleet node with mTLS",
          systemPrompt: "You are a helpful assistant on the example server."
        }
      }
    },
    mcp: {
      servers: {
        "filesystem": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/home"],
          description: "File system access via MCP"
        },
        "sqlite": {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-sqlite", "~/data.db"],
          description: "SQLite database access via MCP"
        }
      }
    },
    defaults: {
      model: "google:gemini-2.0-flash",
      verbosity: "normal",
      autoConfirm: false,
      systemPrompt: "You are a helpful DevOps assistant."
    }
  };

  ensureConfigDir();

  if (existsSync(CONFIG_PATH)) {
    console.log(`Config already exists at ${CONFIG_PATH}`);
    console.log('Remove it first if you want to create a new template.');
    return;
  }

  saveConfig(template);
  console.log(`Created template config at ${CONFIG_PATH}`);
  console.log('Edit it to add your API keys and fleet nodes.');
}
