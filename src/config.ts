import { homedir } from 'os';
import { join } from 'path';

const CONFIG_PATH = join(homedir(), '.aiconfig');

/**
 * Load environment variables from ~/.aiconfig file
 * Format: KEY=value (one per line, # for comments)
 */
export async function loadEnvFile(): Promise<void> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      const content = await file.text();
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          const value = trimmed.slice(eqIndex + 1).trim();
          // Only set if not already defined in environment
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {
    // Silently ignore errors reading config file
  }
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
}

export function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {
    prompt: [],
    help: false,
    version: false,
    verbosity: 'normal',
    yes: false,
    map: false,
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
  -v, --verbose                 Show tool call outputs
  -q, --quiet                   Hide tool calls entirely
  -y, --yes                     Auto-confirm tool executions (use with caution)
  --map                         Process each stdin line separately
  --reduce <prompt>             Combine map results with a final prompt
  -h, --help                    Show this help message
  -V, --version                 Show version

Providers:
  google      Google Gemini API (requires GOOGLE_API_KEY)
  anthropic   Anthropic API (requires ANTHROPIC_API_KEY)
  openai      OpenAI API (requires OPENAI_API_KEY)
  mistral     Mistral API (requires MISTRAL_API_KEY)
  deepseek    DeepSeek API (requires DEEPSEEK_API_KEY)
  ollama      Local Ollama instance (no API key needed)

Config (~/.aiconfig):
  *_API_KEY - API keys for each provider
  AI_PROVIDER_ORDER - Comma-separated priority (default: google,anthropic,openai,mistral,deepseek,ollama)

Examples:
  ai "What is the capital of France?"
  ai -m openai:gpt-4o "Explain quantum computing"
  cat file.txt | ai "Summarize this"
  echo "Hello" | ai -s "You are a pirate" "Respond to this greeting"

Map/Reduce:
  ls *.ts | ai --map "Describe this file" -y
  find . -name "*.md" | ai --map "Summarize" --reduce "Combine into overview"
`);
}
