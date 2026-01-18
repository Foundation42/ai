import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { spawn } from 'child_process';
import pc from 'picocolors';
import { ensureConfigDir, getEventHooksConfig, type EventHook, type EventCondition } from './config';

const EVENT_STATE_PATH = join(homedir(), '.config', 'ai', 'event-state.json');

// ============================================
// Event State Management
// ============================================

interface EventState {
  hooks: Record<string, {
    lastTriggered?: number;      // Timestamp of last trigger
    lastChecked?: number;        // Timestamp of last check
    triggerCount: number;        // Total triggers
    lastValue?: string | number; // Last observed value (for change detection)
    lastStatus?: boolean;        // Last condition status (for edge detection)
  }>;
}

export function loadEventState(): EventState {
  try {
    if (existsSync(EVENT_STATE_PATH)) {
      return JSON.parse(readFileSync(EVENT_STATE_PATH, 'utf-8'));
    }
  } catch {}
  return { hooks: {} };
}

export function saveEventState(state: EventState): void {
  ensureConfigDir();
  writeFileSync(EVENT_STATE_PATH, JSON.stringify(state, null, 2));
}

// ============================================
// Event Detection Functions
// ============================================

/**
 * Check disk usage for a mount point
 */
async function checkDiskUsage(path: string = '/'): Promise<number> {
  return new Promise((resolve) => {
    const df = spawn('df', ['-P', path]);
    let output = '';

    df.stdout.on('data', (data) => {
      output += data.toString();
    });

    df.on('close', () => {
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 5) {
          const usedPercent = parseInt(parts[4].replace('%', ''), 10) / 100;
          resolve(usedPercent);
          return;
        }
      }
      resolve(0);
    });

    df.on('error', () => resolve(0));
  });
}

/**
 * Check memory usage
 */
function checkMemoryUsage(): number {
  const os = require('os');
  const total = os.totalmem();
  const free = os.freemem();
  return (total - free) / total;
}

/**
 * Check system load average (normalized to CPU count)
 */
function checkLoadAverage(): number {
  const os = require('os');
  const load = os.loadavg()[0]; // 1-minute average
  const cpus = os.cpus().length;
  return load / cpus;
}

/**
 * Check if a systemd service is running
 */
async function checkServiceStatus(service: string): Promise<boolean> {
  return new Promise((resolve) => {
    const systemctl = spawn('systemctl', ['is-active', '--quiet', service]);

    systemctl.on('close', (code) => {
      resolve(code === 0);
    });

    systemctl.on('error', () => resolve(false));
  });
}

/**
 * Check if a file exists
 */
function checkFileExists(path: string): boolean {
  const resolved = path.startsWith('~')
    ? path.replace('~', process.env.HOME || homedir())
    : path;
  return existsSync(resolved);
}

/**
 * Get file modification time
 */
function getFileMtime(path: string): number | null {
  const resolved = path.startsWith('~')
    ? path.replace('~', process.env.HOME || homedir())
    : path;
  try {
    const stats = statSync(resolved);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Run a command and get result
 */
async function runCommand(command: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      timeout: 10000, // 10 second timeout
    });

    let output = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output: output + stderr });
    });

    proc.on('error', (err) => {
      resolve({ exitCode: 1, output: err.message });
    });
  });
}

/**
 * Check HTTP endpoint status
 */
async function checkHttpStatus(url: string, expectedStatus: number = 200): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.status === expectedStatus;
  } catch {
    return false;
  }
}

/**
 * Check if a TCP port is open
 */
async function checkPortOpen(host: string = 'localhost', port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = new net.Socket();

    socket.setTimeout(3000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.connect(port, host);
  });
}

// ============================================
// Event Evaluation
// ============================================

export interface EventCheckResult {
  triggered: boolean;
  value?: string | number;
  message?: string;
}

/**
 * Check if an event condition is met
 */
export async function checkEventCondition(
  event: EventCondition,
  lastValue?: string | number,
  lastStatus?: boolean
): Promise<EventCheckResult> {
  const threshold = event.threshold ?? 0.9;

  switch (event.type) {
    case 'disk_usage': {
      const usage = await checkDiskUsage(event.path || '/');
      const triggered = usage >= threshold;
      return {
        triggered,
        value: usage,
        message: triggered ? `Disk usage ${(usage * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}%` : undefined,
      };
    }

    case 'memory_usage': {
      const usage = checkMemoryUsage();
      const triggered = usage >= threshold;
      return {
        triggered,
        value: usage,
        message: triggered ? `Memory usage ${(usage * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}%` : undefined,
      };
    }

    case 'load_average': {
      const load = checkLoadAverage();
      const triggered = load >= threshold;
      return {
        triggered,
        value: load,
        message: triggered ? `Load average ${load.toFixed(2)} >= ${threshold}` : undefined,
      };
    }

    case 'service_down': {
      if (!event.service) return { triggered: false };
      const isRunning = await checkServiceStatus(event.service);
      // Only trigger on transition from running to stopped (edge detection)
      // Use lastValue (1=running, 0=stopped) for edge detection, not lastStatus
      const wasRunning = lastValue === undefined || lastValue === 1;
      const triggered = !isRunning && wasRunning;
      return {
        triggered,
        value: isRunning ? 1 : 0,
        message: triggered ? `Service ${event.service} is down` : undefined,
      };
    }

    case 'service_up': {
      if (!event.service) return { triggered: false };
      const isRunning = await checkServiceStatus(event.service);
      // Only trigger on transition from stopped to running
      // Use lastValue for edge detection
      const wasRunning = lastValue === 1;
      const triggered = isRunning && !wasRunning;
      return {
        triggered,
        value: isRunning ? 1 : 0,
        message: triggered ? `Service ${event.service} is now running` : undefined,
      };
    }

    case 'file_exists': {
      if (!event.file) return { triggered: false };
      const exists = checkFileExists(event.file);
      // Only trigger on transition from missing to exists
      const wasExisting = lastValue === 1;
      const triggered = exists && !wasExisting;
      return {
        triggered,
        value: exists ? 1 : 0,
        message: triggered ? `File ${event.file} appeared` : undefined,
      };
    }

    case 'file_missing': {
      if (!event.file) return { triggered: false };
      const exists = checkFileExists(event.file);
      // Only trigger on transition from exists to missing
      const wasExisting = lastValue === undefined || lastValue === 1;
      const triggered = !exists && wasExisting;
      return {
        triggered,
        value: exists ? 1 : 0,
        message: triggered ? `File ${event.file} is missing` : undefined,
      };
    }

    case 'file_changed': {
      if (!event.file) return { triggered: false };
      const mtime = getFileMtime(event.file);
      if (mtime === null) return { triggered: false, value: 0 };
      // Only trigger if mtime changed from last check
      const triggered = lastValue !== undefined && mtime !== lastValue;
      return {
        triggered,
        value: mtime,
        message: triggered ? `File ${event.file} was modified` : undefined,
      };
    }

    case 'command_fails': {
      if (!event.command) return { triggered: false };
      const result = await runCommand(event.command);
      const triggered = result.exitCode !== 0;
      return {
        triggered,
        value: result.exitCode,
        message: triggered ? `Command failed with exit code ${result.exitCode}` : undefined,
      };
    }

    case 'command_succeeds': {
      if (!event.command) return { triggered: false };
      const result = await runCommand(event.command);
      // Only trigger on transition from failing to succeeding
      const wasSucceeding = lastStatus !== false;
      const triggered = result.exitCode === 0 && !wasSucceeding;
      return {
        triggered,
        value: result.exitCode,
        message: triggered ? `Command succeeded` : undefined,
      };
    }

    case 'command_output': {
      if (!event.command || !event.pattern) return { triggered: false };
      const result = await runCommand(event.command);
      const regex = new RegExp(event.pattern);
      const matches = regex.test(result.output);
      return {
        triggered: matches,
        value: result.output.slice(0, 200),
        message: matches ? `Command output matched pattern "${event.pattern}"` : undefined,
      };
    }

    case 'http_down': {
      if (!event.url) return { triggered: false };
      const isUp = await checkHttpStatus(event.url, event.expectedStatus || 200);
      // Only trigger on transition from up to down
      const wasUp = lastValue === undefined || lastValue === 1;
      const triggered = !isUp && wasUp;
      return {
        triggered,
        value: isUp ? 1 : 0,
        message: triggered ? `HTTP endpoint ${event.url} is down` : undefined,
      };
    }

    case 'http_up': {
      if (!event.url) return { triggered: false };
      const isUp = await checkHttpStatus(event.url, event.expectedStatus || 200);
      // Only trigger on transition from down to up
      const wasUp = lastValue === 1;
      const triggered = isUp && !wasUp;
      return {
        triggered,
        value: isUp ? 1 : 0,
        message: triggered ? `HTTP endpoint ${event.url} is now available` : undefined,
      };
    }

    case 'port_open': {
      if (!event.port) return { triggered: false };
      const isOpen = await checkPortOpen(event.host || 'localhost', event.port);
      // Only trigger on transition from closed to open
      const wasOpen = lastValue === 1;
      const triggered = isOpen && !wasOpen;
      return {
        triggered,
        value: isOpen ? 1 : 0,
        message: triggered ? `Port ${event.port} is now open` : undefined,
      };
    }

    case 'port_closed': {
      if (!event.port) return { triggered: false };
      const isOpen = await checkPortOpen(event.host || 'localhost', event.port);
      // Only trigger on transition from open to closed
      const wasOpen = lastValue === undefined || lastValue === 1;
      const triggered = !isOpen && wasOpen;
      return {
        triggered,
        value: isOpen ? 1 : 0,
        message: triggered ? `Port ${event.port} is now closed` : undefined,
      };
    }

    default:
      return { triggered: false };
  }
}

/**
 * Check if hook is in cooldown
 */
export function isInCooldown(hook: EventHook, state: EventState): boolean {
  const hookState = state.hooks[hook.name];
  if (!hookState?.lastTriggered) return false;

  const cooldown = hook.cooldown ?? 300000; // Default 5 minutes
  const elapsed = Date.now() - hookState.lastTriggered;

  return elapsed < cooldown;
}

/**
 * Get event hooks statistics for API
 */
export function getEventHooksStats(): {
  enabled: boolean;
  hooks: Array<{
    name: string;
    eventType: string;
    triggerCount: number;
    lastTriggered?: string;
    inCooldown: boolean;
    cooldownRemaining?: number;
  }>;
} {
  const config = getEventHooksConfig();
  const state = loadEventState();
  const now = Date.now();

  const hooks = (config.hooks || []).map(hook => {
    const hookState = state.hooks[hook.name] || { triggerCount: 0 };
    const cooldown = hook.cooldown ?? 300000;
    const inCooldown = hookState.lastTriggered ? (now - hookState.lastTriggered) < cooldown : false;
    const cooldownRemaining = hookState.lastTriggered && inCooldown
      ? cooldown - (now - hookState.lastTriggered)
      : undefined;

    return {
      name: hook.name,
      eventType: hook.event.type,
      triggerCount: hookState.triggerCount,
      lastTriggered: hookState.lastTriggered ? new Date(hookState.lastTriggered).toISOString() : undefined,
      inCooldown,
      cooldownRemaining,
    };
  });

  return {
    enabled: config.enabled || false,
    hooks,
  };
}
