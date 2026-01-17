import { homedir } from 'os';
import { join } from 'path';

export interface Config {
  defaultProvider?: string;
  defaultModel?: string;
  providers?: {
    ollama?: { host?: string; model?: string };
    openai?: { apiKey?: string; model?: string };
    anthropic?: { apiKey?: string; model?: string };
    google?: { apiKey?: string; model?: string };
  };
  systemPrompt?: string;
}

const CONFIG_PATH = join(homedir(), '.config', 'ai', 'config.json');

let cachedConfig: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      cachedConfig = await file.json();
      return cachedConfig!;
    }
  } catch {
    // Config file doesn't exist or is invalid, use defaults
  }

  cachedConfig = {};
  return cachedConfig;
}

export async function saveConfig(config: Config): Promise<void> {
  const configDir = join(homedir(), '.config', 'ai');

  // Ensure directory exists
  const dir = Bun.file(configDir);
  try {
    await Bun.write(join(configDir, '.keep'), '');
  } catch {
    // Directory creation might fail, try to create it
    const { mkdir } = await import('fs/promises');
    await mkdir(configDir, { recursive: true });
  }

  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2));
  cachedConfig = config;
}

export interface CLIArgs {
  prompt: string[];
  model?: string;
  systemPrompt?: string;
  help: boolean;
  version: boolean;
}

export function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    prompt: [],
    help: false,
    version: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help') {
      result.help = true;
    } else if (arg === '-v' || arg === '--version') {
      result.version = true;
    } else if (arg === '-m' || arg === '--model') {
      result.model = args[++i];
    } else if (arg === '-s' || arg === '--system') {
      result.systemPrompt = args[++i];
    } else if (!arg.startsWith('-')) {
      result.prompt.push(arg);
    }

    i++;
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
  -h, --help                    Show this help message
  -v, --version                 Show version

Providers:
  ollama      Local Ollama instance (default, no API key needed)
  openai      OpenAI API (requires OPENAI_API_KEY)
  anthropic   Anthropic API (requires ANTHROPIC_API_KEY)
  google      Google Gemini API (requires GOOGLE_API_KEY or GEMINI_API_KEY)

Examples:
  ai "What is the capital of France?"
  ai -m openai:gpt-4o "Explain quantum computing"
  cat file.txt | ai "Summarize this"
  echo "Hello" | ai -s "You are a pirate" "Respond to this greeting"
`);
}
