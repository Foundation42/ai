import { homedir } from 'os';
import { join } from 'path';

const HISTORY_PATH = join(homedir(), '.ai_history.jsonl');

export interface HistoryEntry {
  timestamp: string;
  mode: 'pipe' | 'standalone' | 'repl';
  provider: string;
  model: string;
  prompt: string;
  response: string;
  context_tokens?: number;
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  try {
    const line = JSON.stringify(entry) + '\n';
    const file = Bun.file(HISTORY_PATH);

    // Append to file (create if doesn't exist)
    const existing = await file.exists() ? await file.text() : '';
    await Bun.write(HISTORY_PATH, existing + line);
  } catch {
    // Silently ignore history write errors
  }
}

export async function readHistory(limit?: number): Promise<HistoryEntry[]> {
  try {
    const file = Bun.file(HISTORY_PATH);
    if (!await file.exists()) {
      return [];
    }

    const content = await file.text();
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines.map(line => JSON.parse(line) as HistoryEntry);

    if (limit) {
      return entries.slice(-limit);
    }
    return entries;
  } catch {
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await Bun.write(HISTORY_PATH, '');
  } catch {
    // Silently ignore
  }
}
