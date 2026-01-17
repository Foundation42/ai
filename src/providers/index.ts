import type { Provider, ProviderConfig } from './types';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';

export type { Provider, ProviderConfig, StreamOptions, Message } from './types';

export type ProviderName = 'ollama' | 'openai' | 'anthropic' | 'google';

const providers: Record<ProviderName, new (config?: ProviderConfig) => Provider> = {
  ollama: OllamaProvider,
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  google: GoogleProvider,
};

export function createProvider(name: ProviderName, config?: ProviderConfig): Provider {
  const ProviderClass = providers[name];
  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return new ProviderClass(config);
}

export function parseModelString(modelString: string): { provider: ProviderName; model: string } | null {
  const parts = modelString.split(':');
  if (parts.length === 2 && parts[0] && parts[1]) {
    const providerName = parts[0].toLowerCase() as ProviderName;
    if (providerName in providers) {
      return { provider: providerName, model: parts[1] };
    }
  }
  return null;
}

export function detectProvider(config?: { model?: string }): { provider: ProviderName; model?: string } {
  // 1. Check if model string contains provider prefix (e.g., "openai:gpt-4")
  if (config?.model) {
    const parsed = parseModelString(config.model);
    if (parsed) {
      return parsed;
    }
  }

  // 2. Check environment variables for API keys
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', model: config?.model };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', model: config?.model };
  }
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return { provider: 'google', model: config?.model };
  }

  // 3. Fall back to Ollama (local, no API key needed)
  return { provider: 'ollama', model: config?.model };
}

export function getProvider(config?: { model?: string }): Provider {
  const { provider, model } = detectProvider(config);
  return createProvider(provider, { model });
}
