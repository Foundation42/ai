import type { Provider, ProviderConfig } from './types';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { MistralProvider } from './mistral';
import { DeepSeekProvider } from './deepseek';

export type { Provider, ProviderConfig, StreamOptions, Message, StreamChunk } from './types';

export type ProviderName = 'ollama' | 'openai' | 'anthropic' | 'google' | 'mistral' | 'deepseek';

const providers: Record<ProviderName, new (config?: ProviderConfig) => Provider> = {
  ollama: OllamaProvider,
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  google: GoogleProvider,
  mistral: MistralProvider,
  deepseek: DeepSeekProvider,
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

const DEFAULT_PROVIDER_ORDER: ProviderName[] = ['google', 'anthropic', 'openai', 'mistral', 'deepseek', 'ollama'];

function getProviderOrder(): ProviderName[] {
  const orderEnv = process.env.AI_PROVIDER_ORDER;
  if (orderEnv) {
    const order = orderEnv.split(',').map(s => s.trim().toLowerCase()) as ProviderName[];
    // Filter to only valid provider names
    return order.filter(p => p in providers);
  }
  return DEFAULT_PROVIDER_ORDER;
}

function isProviderAvailable(name: ProviderName): boolean {
  switch (name) {
    case 'ollama':
      return true; // Always available (local)
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY;
    case 'google':
      return !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
    case 'mistral':
      return !!process.env.MISTRAL_API_KEY;
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY;
    default:
      return false;
  }
}

export function detectProvider(config?: { model?: string }): { provider: ProviderName; model?: string } {
  // 1. Check if model string contains provider prefix (e.g., "openai:gpt-4")
  if (config?.model) {
    const parsed = parseModelString(config.model);
    if (parsed) {
      return parsed;
    }
  }

  // 2. Check providers in configured order
  const order = getProviderOrder();
  for (const name of order) {
    if (isProviderAvailable(name)) {
      return { provider: name, model: config?.model };
    }
  }

  // 3. Fall back to Ollama (always available)
  return { provider: 'ollama', model: config?.model };
}

export function getProvider(config?: { model?: string }): Provider {
  const { provider, model } = detectProvider(config);
  return createProvider(provider, { model });
}
