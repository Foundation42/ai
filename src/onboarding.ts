/**
 * First-run onboarding experience
 * Guides users through initial configuration
 */

import pc from 'picocolors';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { saveConfig, ensureConfigDir, type AIConfig } from './config';
import { readline } from './utils/readline';

const CONFIG_PATH = join(homedir(), '.config', 'ai', 'config.json');

/**
 * Check if onboarding is needed
 */
export function needsOnboarding(): boolean {
  return !existsSync(CONFIG_PATH);
}

/**
 * Run interactive onboarding
 */
export async function runOnboarding(): Promise<boolean> {
  console.log(pc.cyan(`
  ╭─────────────────────────────────────╮
  │                                     │
  │   ${pc.bold('Welcome to AI CLI!')}               │
  │                                     │
  │   Let's get you set up.             │
  │                                     │
  ╰─────────────────────────────────────╯
`));

  console.log(pc.dim('This will create ~/.config/ai/config.json\n'));

  // Ask which provider to use
  console.log(pc.bold('Which AI provider would you like to use?\n'));
  console.log('  1. Google Gemini ' + pc.dim('(recommended - fast & capable)'));
  console.log('  2. Anthropic Claude ' + pc.dim('(excellent reasoning)'));
  console.log('  3. OpenAI GPT ' + pc.dim('(widely used)'));
  console.log('  4. Mistral ' + pc.dim('(European, efficient)'));
  console.log('  5. DeepSeek ' + pc.dim('(budget-friendly)'));
  console.log('  6. Ollama ' + pc.dim('(local, private)'));
  console.log('  7. Skip for now ' + pc.dim('(edit config manually later)'));
  console.log('');

  const choice = await readline.question(pc.cyan('Enter choice [1-7]: '));

  const providers: Record<string, { name: string; envVar: string; keyName: string; defaultModel: string }> = {
    '1': { name: 'google', envVar: 'GOOGLE_API_KEY', keyName: 'Google API key', defaultModel: 'google:gemini-2.0-flash' },
    '2': { name: 'anthropic', envVar: 'ANTHROPIC_API_KEY', keyName: 'Anthropic API key', defaultModel: 'anthropic:claude-sonnet-4-20250514' },
    '3': { name: 'openai', envVar: 'OPENAI_API_KEY', keyName: 'OpenAI API key', defaultModel: 'openai:gpt-4o' },
    '4': { name: 'mistral', envVar: 'MISTRAL_API_KEY', keyName: 'Mistral API key', defaultModel: 'mistral:mistral-large-latest' },
    '5': { name: 'deepseek', envVar: 'DEEPSEEK_API_KEY', keyName: 'DeepSeek API key', defaultModel: 'deepseek:deepseek-chat' },
    '6': { name: 'ollama', envVar: '', keyName: '', defaultModel: 'ollama:llama3.2' },
  };

  if (choice === '7' || !providers[choice]) {
    // Create minimal config
    ensureConfigDir();
    const config: AIConfig = {
      providers: {},
      defaults: {
        verbosity: 'normal',
        autoConfirm: false,
      },
    };
    saveConfig(config);
    console.log(pc.green('\nCreated empty config at ~/.config/ai/config.json'));
    console.log(pc.dim('Edit it to add your API keys, then run ai again.\n'));
    return false;
  }

  const provider = providers[choice]!;
  let apiKey = '';

  if (provider.name === 'ollama') {
    console.log(pc.dim('\nOllama runs locally - no API key needed.'));
    console.log(pc.dim('Make sure Ollama is running: ollama serve\n'));
  } else {
    // Check for existing env var
    const existingKey = process.env[provider.envVar];
    if (existingKey) {
      console.log(pc.dim(`\nFound ${provider.envVar} in environment.`));
      const useExisting = await readline.question(pc.cyan('Use this key? [Y/n]: '));
      if (useExisting.toLowerCase() !== 'n') {
        apiKey = existingKey;
      }
    }

    if (!apiKey) {
      console.log('');
      apiKey = await readline.question(pc.cyan(`Enter your ${provider.keyName}: `));
      if (!apiKey.trim()) {
        console.log(pc.yellow('\nNo API key provided. Creating config without it.'));
        console.log(pc.dim('You can add it later in ~/.config/ai/config.json\n'));
      }
    }
  }

  // Build config
  const config: AIConfig = {
    providers: {
      default: provider.name,
    },
    defaults: {
      model: provider.defaultModel,
      verbosity: 'normal',
      autoConfirm: false,
    },
  };

  // Add provider-specific config
  if (provider.name === 'ollama') {
    config.providers!.ollama = { baseUrl: 'http://localhost:11434' };
  } else if (apiKey.trim()) {
    (config.providers as any)[provider.name] = { apiKey: apiKey.trim() };
  }

  // Save config
  ensureConfigDir();
  saveConfig(config);

  console.log(pc.green('\n✓ Configuration saved to ~/.config/ai/config.json'));
  console.log('');
  console.log(pc.bold('You\'re all set! Try these commands:\n'));
  console.log(pc.dim('  ai "What time is it?"'));
  console.log(pc.dim('  ai "What\'s using the most disk space?"'));
  console.log(pc.dim('  ai "Explain this error" < error.log'));
  console.log('');

  return true;
}
