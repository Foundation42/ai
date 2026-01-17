import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import pc from 'picocolors';
import { getSchedulerConfig, ensureConfigDir, type ScheduledTask, getFleetConfig } from './config';
import { loadFleetConfig, queryFleetNode, type FleetNode } from './fleet';
import { getProvider, type StreamOptions, type Message } from './providers';
import { getToolDefinitions, executeTool, type ToolCall } from './tools';
import { getDefaultSystemPrompt, getServerAutoConfirm, getFleetTLSConfig } from './config';

const STATE_PATH = join(homedir(), '.config', 'ai', 'scheduler-state.json');

// Confirmation function for tool execution - respects server autoConfirm setting
const serverConfirmFn = async () => getServerAutoConfirm();

// Timer reference for cleanup
let schedulerTimer: Timer | null = null;

// Tool system prompt for scheduled tasks
const TOOL_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools that let you interact with the system.

Available tools:
- bash: Execute shell commands (ls, cat, date, grep, curl, etc.)
- read_file: Read file contents
- list_files: List directory contents
- edit_file: Make targeted edits to files
- web_fetch: Fetch content from URLs (web pages, APIs, raw files)
- version: Get your own version and system info
- fleet_query: Query other fleet nodes
- fleet_list: List fleet nodes and their status

Use tools proactively to complete your tasks.`;

export interface TaskState {
  lastRun?: number;          // Timestamp of last execution
  lastResult?: 'success' | 'error' | 'skipped' | 'handoff';
  lastResponse?: string;     // Last response (truncated)
  nextRun?: number;          // Calculated next run time
  runCount?: number;         // Total runs
  errorCount?: number;       // Total errors
}

export interface SchedulerState {
  tasks: Record<string, TaskState>;
}

/**
 * Load scheduler state from disk
 */
export function loadSchedulerState(): SchedulerState {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    }
  } catch {}
  return { tasks: {} };
}

/**
 * Save scheduler state to disk
 */
export function saveSchedulerState(state: SchedulerState): void {
  ensureConfigDir();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Parse schedule string and return interval in milliseconds
 * Supports:
 * - "@every Nm" - every N minutes
 * - "@every Nh" - every N hours
 * - "@every Ns" - every N seconds
 * - "@hourly" - every hour
 * - "@daily" - every day
 * - "* * * * *" - cron expression (minutes only for simplicity)
 */
export function parseSchedule(schedule: string): number {
  // @every format
  const everyMatch = schedule.match(/^@every\s+(\d+)([smh])$/);
  if (everyMatch) {
    const value = parseInt(everyMatch[1]!, 10);
    const unit = everyMatch[2];
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
    }
  }

  // Named intervals
  if (schedule === '@hourly') return 60 * 60 * 1000;
  if (schedule === '@daily') return 24 * 60 * 60 * 1000;
  if (schedule === '@weekly') return 7 * 24 * 60 * 60 * 1000;

  // Simple cron: parse first field as minutes interval
  // Format: "*/5 * * * *" = every 5 minutes
  const cronMatch = schedule.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (cronMatch) {
    return parseInt(cronMatch[1]!, 10) * 60 * 1000;
  }

  // Default to 5 minutes if parsing fails
  console.warn(pc.yellow(`Warning: Could not parse schedule "${schedule}", defaulting to 5 minutes`));
  return 5 * 60 * 1000;
}

/**
 * Get current system load (1-minute average, normalized to 0-1)
 */
function getSystemLoad(): number {
  const os = require('os');
  const load = os.loadavg()[0]; // 1-minute average
  const cpus = os.cpus().length;
  return load / cpus; // Normalize to 0-1 scale
}

/**
 * Check if task conditions are met
 */
function checkConditions(task: ScheduledTask): { shouldRun: boolean; reason?: string } {
  if (!task.condition) {
    return { shouldRun: true };
  }

  const load = getSystemLoad();

  if (task.condition.maxLoad !== undefined && load > task.condition.maxLoad) {
    return { shouldRun: false, reason: `Load ${load.toFixed(2)} > maxLoad ${task.condition.maxLoad}` };
  }

  if (task.condition.minLoad !== undefined && load < task.condition.minLoad) {
    return { shouldRun: false, reason: `Load ${load.toFixed(2)} < minLoad ${task.condition.minLoad}` };
  }

  return { shouldRun: true };
}

/**
 * Check if task should hand off to a peer
 */
function shouldHandoff(task: ScheduledTask): { handoff: boolean; reason?: string } {
  if (!task.handoff?.enabled) {
    return { handoff: false };
  }

  const load = getSystemLoad();
  if (load > task.handoff.loadThreshold) {
    return { handoff: true, reason: `Load ${load.toFixed(2)} > threshold ${task.handoff.loadThreshold}` };
  }

  return { handoff: false };
}

/**
 * Execute a prompt locally (similar to handleFleetExecute)
 */
async function executePromptLocally(prompt: string): Promise<{ success: boolean; response: string }> {
  try {
    const provider = getProvider({});
    const messages: Message[] = [];

    const configPrompt = getDefaultSystemPrompt();
    if (configPrompt) {
      messages.push({ role: 'system', content: configPrompt + '\n\n' + TOOL_SYSTEM_PROMPT });
    } else {
      messages.push({ role: 'system', content: TOOL_SYSTEM_PROMPT });
    }
    messages.push({ role: 'user', content: prompt });

    const streamOpts: StreamOptions = {
      messages,
      tools: provider.supportsTools ? getToolDefinitions() : undefined,
    };

    let fullText = '';
    const maxLoops = 10;
    let loopCount = 0;

    while (loopCount < maxLoops) {
      loopCount++;
      let text = '';
      const toolCalls: ToolCall[] = [];

      for await (const chunk of provider.stream('', streamOpts)) {
        if (chunk.type === 'text') {
          text += chunk.content;
        } else if (chunk.type === 'tool_call') {
          toolCalls.push(chunk.call);
        }
      }

      fullText += text;

      if (toolCalls.length === 0) {
        break;
      }

      const assistantMsg: Message = { role: 'assistant', content: text, tool_calls: toolCalls };
      messages.push(assistantMsg);

      for (const call of toolCalls) {
        const result = await executeTool(call, serverConfirmFn);
        messages.push({
          role: 'tool',
          content: result.result,
          tool_call_id: call.id,
        });
      }

      streamOpts.messages = messages;
    }

    return { success: true, response: fullText };
  } catch (err) {
    return { success: false, response: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Hand off task to a peer node
 */
async function handoffToPeer(
  task: ScheduledTask,
  peers: FleetNode[]
): Promise<{ success: boolean; node?: string; response?: string; error?: string }> {
  if (peers.length === 0) {
    return { success: false, error: 'No peers available for handoff' };
  }

  const fleetTLS = getFleetTLSConfig();

  // Try peers in order until one succeeds
  for (const peer of peers) {
    const prompt = task.handoff?.prompt || task.prompt;
    console.log(pc.dim(`   Handing off to ${peer.name}...`));

    const result = await queryFleetNode(peer, prompt, { fleetTLS });

    if (result.success) {
      return { success: true, node: peer.name, response: result.response };
    }

    console.log(pc.dim(`   ${peer.name} failed: ${result.error}`));
  }

  return { success: false, error: 'All peers failed' };
}

/**
 * Execute a single scheduled task
 */
async function executeTask(task: ScheduledTask, state: SchedulerState): Promise<void> {
  const taskState = state.tasks[task.name] || { runCount: 0, errorCount: 0 };

  console.log(pc.cyan(`\n[Scheduler] Running task: ${task.name}`));

  // Check conditions
  const conditions = checkConditions(task);
  if (!conditions.shouldRun) {
    console.log(pc.dim(`   Skipped: ${conditions.reason}`));
    taskState.lastRun = Date.now();
    taskState.lastResult = 'skipped';
    taskState.lastResponse = conditions.reason;
    state.tasks[task.name] = taskState;
    saveSchedulerState(state);
    return;
  }

  // Check for handoff
  const handoff = shouldHandoff(task);
  if (handoff.handoff) {
    console.log(pc.yellow(`   Handoff triggered: ${handoff.reason}`));

    // Get peer nodes
    const fleetConfig = loadFleetConfig();
    let peers = fleetConfig.nodes;

    // Filter to specific peers if configured
    if (task.handoff?.peers && task.handoff.peers.length > 0) {
      peers = peers.filter(n => task.handoff!.peers!.includes(n.name));
    }

    const result = await handoffToPeer(task, peers);

    taskState.lastRun = Date.now();
    taskState.runCount = (taskState.runCount || 0) + 1;

    if (result.success) {
      console.log(pc.green(`   Handed off to ${result.node}`));
      taskState.lastResult = 'handoff';
      taskState.lastResponse = `Handed off to ${result.node}: ${(result.response || '').slice(0, 200)}`;
    } else {
      console.log(pc.red(`   Handoff failed: ${result.error}`));
      taskState.lastResult = 'error';
      taskState.lastResponse = result.error;
      taskState.errorCount = (taskState.errorCount || 0) + 1;
    }

    state.tasks[task.name] = taskState;
    saveSchedulerState(state);
    return;
  }

  // Execute locally
  const result = await executePromptLocally(task.prompt);

  taskState.lastRun = Date.now();
  taskState.runCount = (taskState.runCount || 0) + 1;

  if (result.success) {
    console.log(pc.green(`   Completed successfully`));
    if (result.response) {
      // Show truncated response
      const preview = result.response.slice(0, 200).replace(/\n/g, ' ');
      console.log(pc.dim(`   Response: ${preview}${result.response.length > 200 ? '...' : ''}`));
    }
    taskState.lastResult = 'success';
    taskState.lastResponse = result.response.slice(0, 500);
  } else {
    console.log(pc.red(`   Failed: ${result.response}`));
    taskState.lastResult = 'error';
    taskState.lastResponse = result.response;
    taskState.errorCount = (taskState.errorCount || 0) + 1;
  }

  state.tasks[task.name] = taskState;
  saveSchedulerState(state);
}

/**
 * Main scheduler tick - checks and runs due tasks
 */
async function schedulerTick(): Promise<void> {
  const config = getSchedulerConfig();
  if (!config.enabled || !config.tasks?.length) {
    return;
  }

  const state = loadSchedulerState();
  const now = Date.now();

  for (const task of config.tasks) {
    if (task.enabled === false) {
      continue;
    }

    const taskState = state.tasks[task.name] || {};
    const interval = parseSchedule(task.schedule);
    const lastRun = taskState.lastRun || 0;

    // Check if task is due
    if (now - lastRun >= interval) {
      try {
        await executeTask(task, state);
      } catch (err) {
        console.error(pc.red(`[Scheduler] Error in task ${task.name}: ${err}`));
      }
    }
  }
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  const config = getSchedulerConfig();

  if (!config.enabled) {
    return;
  }

  const taskCount = config.tasks?.length || 0;
  if (taskCount === 0) {
    console.log(pc.dim(`   Scheduler enabled but no tasks configured`));
    return;
  }

  console.log(pc.dim(`   Scheduler enabled (${taskCount} task${taskCount > 1 ? 's' : ''})`));

  // List tasks
  for (const task of config.tasks || []) {
    if (task.enabled !== false) {
      console.log(pc.dim(`     - ${task.name}: ${task.schedule}`));
    }
  }

  // Run initial tick after 10s delay (let server fully start)
  setTimeout(schedulerTick, 10000);

  // Then check every 30 seconds for due tasks
  schedulerTimer = setInterval(schedulerTick, 30000);
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

/**
 * Get scheduler status for API
 */
export function getSchedulerStatus(): { enabled: boolean; tasks: Array<{ name: string; state: TaskState; schedule: string; nextRun?: number }> } {
  const config = getSchedulerConfig();
  const state = loadSchedulerState();
  const now = Date.now();

  const tasks = (config.tasks || []).map(task => {
    const taskState = state.tasks[task.name] || {};
    const interval = parseSchedule(task.schedule);
    const lastRun = taskState.lastRun || 0;
    const nextRun = lastRun + interval;

    return {
      name: task.name,
      schedule: task.schedule,
      state: taskState,
      nextRun: nextRun > now ? nextRun : now,
    };
  });

  return { enabled: config.enabled || false, tasks };
}
