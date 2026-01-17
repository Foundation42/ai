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

export interface SchedulerConfig {
  enabled?: boolean;         // Master switch (default: false)
  tasks?: ScheduledTask[];   // List of scheduled tasks
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
        ]
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
