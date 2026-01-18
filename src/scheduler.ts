import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import pc from 'picocolors';
import { getSchedulerConfig, getKnowledgeSyncConfig, getMemoryTTLConfig, getEventHooksConfig, ensureConfigDir, type ScheduledTask, type KnowledgeSyncConfig, type EventHook } from './config';
import { loadFleetConfig, queryFleetNode, type FleetNode } from './fleet';
import { getProvider, type StreamOptions, type Message } from './providers';
import { getToolDefinitions, executeTool, type ToolCall } from './tools';
import { getDefaultSystemPrompt, getServerAutoConfirm, getFleetTLSConfig } from './config';
import {
  getMemoriesSince,
  getLastSyncTime,
  mergeReceivedMemories,
  updateSyncState,
  getSyncStats,
  cleanupExpiredMemories,
  getMemoryStats,
  type Memory,
} from './memory';
import {
  loadEventState,
  saveEventState,
  checkEventCondition,
  isInCooldown,
  getEventHooksStats,
} from './events';

const STATE_PATH = join(homedir(), '.config', 'ai', 'scheduler-state.json');
const HANDOFF_STATE_PATH = join(homedir(), '.config', 'ai', 'handoff-state.json');

// Confirmation function for tool execution - respects server autoConfirm setting
const serverConfirmFn = async () => getServerAutoConfirm();

// Timer references for cleanup
let schedulerTimer: Timer | null = null;
let knowledgeSyncTimer: Timer | null = null;
let memoryCleanupTimer: Timer | null = null;
let eventHooksTimer: Timer | null = null;

// ============================================
// Round-Robin Handoff State
// ============================================

interface HandoffState {
  lastPeerIndex: number;           // Index of last peer used
  peerStats: Record<string, {      // Per-peer statistics
    handoffs: number;              // Total handoffs to this peer
    successes: number;             // Successful handoffs
    failures: number;              // Failed handoffs
    lastUsed?: number;             // Timestamp of last use
    lastSuccess?: number;          // Timestamp of last success
    consecutiveFailures: number;   // For health tracking
  }>;
}

function loadHandoffState(): HandoffState {
  try {
    if (existsSync(HANDOFF_STATE_PATH)) {
      return JSON.parse(readFileSync(HANDOFF_STATE_PATH, 'utf-8'));
    }
  } catch {}
  return { lastPeerIndex: -1, peerStats: {} };
}

function saveHandoffState(state: HandoffState): void {
  ensureConfigDir();
  writeFileSync(HANDOFF_STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Select next peer using round-robin, skipping unhealthy peers
 */
function selectNextPeer(peers: FleetNode[], state: HandoffState): { peer: FleetNode; index: number } | null {
  if (peers.length === 0) return null;

  const maxConsecutiveFailures = 3; // Skip peers with this many consecutive failures
  let attempts = 0;
  let index = (state.lastPeerIndex + 1) % peers.length;

  while (attempts < peers.length) {
    const peer = peers[index]!;
    const peerStat = state.peerStats[peer.name];

    // Skip if peer has too many consecutive failures (but still try if all peers are failing)
    if (!peerStat || peerStat.consecutiveFailures < maxConsecutiveFailures) {
      return { peer, index };
    }

    // Check if enough time has passed to retry a failing peer (5 minutes)
    if (peerStat.lastUsed && Date.now() - peerStat.lastUsed > 5 * 60 * 1000) {
      return { peer, index };
    }

    index = (index + 1) % peers.length;
    attempts++;
  }

  // All peers are failing, just return the next one anyway
  index = (state.lastPeerIndex + 1) % peers.length;
  return { peer: peers[index]!, index };
}

/**
 * Update peer stats after a handoff attempt
 */
function updatePeerStats(state: HandoffState, peerName: string, success: boolean): void {
  if (!state.peerStats[peerName]) {
    state.peerStats[peerName] = {
      handoffs: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
    };
  }

  const stats = state.peerStats[peerName]!;
  stats.handoffs++;
  stats.lastUsed = Date.now();

  if (success) {
    stats.successes++;
    stats.consecutiveFailures = 0;
    stats.lastSuccess = Date.now();
  } else {
    stats.failures++;
    stats.consecutiveFailures++;
  }
}

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
- memory_write: Store learnings, solutions, or observations
- memory_read: Read stored memories
- memory_search: Search memories by text
- memory_share: Share memories with peer nodes
- memory_ask_peers: Ask peers if they have relevant experience

Use tools proactively to complete your tasks.
When you learn something useful, save it with memory_write.
When you solve a problem, save the solution so you can reference it later.`;

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
 * Hand off task to a peer node using round-robin selection
 */
async function handoffToPeer(
  task: ScheduledTask,
  peers: FleetNode[]
): Promise<{ success: boolean; node?: string; response?: string; error?: string }> {
  if (peers.length === 0) {
    return { success: false, error: 'No peers available for handoff' };
  }

  const fleetTLS = getFleetTLSConfig();
  const handoffState = loadHandoffState();

  // Try up to peers.length times, using round-robin
  let attempts = 0;
  const maxAttempts = peers.length;

  while (attempts < maxAttempts) {
    // Select next peer using round-robin
    const selection = selectNextPeer(peers, handoffState);
    if (!selection) {
      return { success: false, error: 'No peers available' };
    }

    const { peer, index } = selection;
    handoffState.lastPeerIndex = index;

    const prompt = task.handoff?.prompt || task.prompt;
    console.log(pc.dim(`   Handing off to ${peer.name} (round-robin #${index + 1}/${peers.length})...`));

    const result = await queryFleetNode(peer, prompt, { fleetTLS });

    if (result.success) {
      updatePeerStats(handoffState, peer.name, true);
      saveHandoffState(handoffState);
      return { success: true, node: peer.name, response: result.response };
    }

    console.log(pc.dim(`   ${peer.name} failed: ${result.error}`));
    updatePeerStats(handoffState, peer.name, false);
    saveHandoffState(handoffState);

    attempts++;
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

  // Also start knowledge sync if enabled
  startKnowledgeSync();

  // Also start memory cleanup if enabled
  startMemoryCleanup();

  // Also start event hooks if enabled
  startEventHooks();
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (knowledgeSyncTimer) {
    clearInterval(knowledgeSyncTimer);
    knowledgeSyncTimer = null;
  }
  if (memoryCleanupTimer) {
    clearInterval(memoryCleanupTimer);
    memoryCleanupTimer = null;
  }
  if (eventHooksTimer) {
    clearInterval(eventHooksTimer);
    eventHooksTimer = null;
  }
}

// ============================================
// Knowledge Sync
// ============================================

/**
 * Sync memories with a single peer
 */
async function syncWithPeer(
  peer: FleetNode,
  config: KnowledgeSyncConfig
): Promise<{ sent: number; received: number; error?: string }> {
  const fleetTLS = getFleetTLSConfig();
  const lastSync = getLastSyncTime(peer.name);

  // Get memories to send (created since last sync)
  let memoriesToSend = getMemoriesSince(lastSync);

  // Filter by categories if specified
  if (config.categories && config.categories.length > 0) {
    memoriesToSend = memoriesToSend.filter(m => config.categories!.includes(m.category));
  }

  try {
    // Send our memories and request theirs
    const prompt = `KNOWLEDGE_SYNC_REQUEST: A peer wants to sync knowledge with you.

1. Here are ${memoriesToSend.length} memories from me since ${lastSync ? new Date(lastSync).toISOString() : 'the beginning'}:
${JSON.stringify(memoriesToSend)}

2. Please:
   a) Store these memories using memory_receive with peer="${peer.name}"
   b) Send back your memories created since timestamp ${lastSync} as JSON
   c) Format your response as: MEMORIES_RESPONSE: [array of your memories]`;

    const result = await queryFleetNode(peer, prompt, { fleetTLS });

    if (!result.success) {
      return { sent: 0, received: 0, error: result.error };
    }

    // Parse received memories from response
    let receivedMemories: Memory[] = [];
    const response = result.response || '';

    // Try to extract memories from response
    const memoriesMatch = response.match(/MEMORIES_RESPONSE:\s*(\[[\s\S]*?\])/);
    if (memoriesMatch) {
      try {
        receivedMemories = JSON.parse(memoriesMatch[1]!);
      } catch {
        // Couldn't parse, that's ok
      }
    }

    // Merge received memories
    const addedCount = receivedMemories.length > 0
      ? mergeReceivedMemories(peer.name, receivedMemories)
      : 0;

    // Update sync state
    updateSyncState(peer.name, memoriesToSend, receivedMemories);

    return { sent: memoriesToSend.length, received: addedCount };
  } catch (err) {
    return { sent: 0, received: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run knowledge sync with all configured peers
 */
async function knowledgeSyncTick(): Promise<void> {
  const config = getKnowledgeSyncConfig();

  if (!config.enabled) {
    return;
  }

  const fleetConfig = loadFleetConfig();
  let peers = fleetConfig.nodes;

  // Filter to specific peers if configured
  if (config.peers && config.peers.length > 0) {
    peers = peers.filter(n => config.peers!.includes(n.name));
  }

  if (peers.length === 0) {
    return;
  }

  console.log(pc.cyan(`\n[Knowledge Sync] Syncing with ${peers.length} peer(s)...`));

  for (const peer of peers) {
    const result = await syncWithPeer(peer, config);

    if (result.error) {
      console.log(pc.dim(`   ${peer.name}: Error - ${result.error}`));
    } else {
      console.log(pc.dim(`   ${peer.name}: Sent ${result.sent}, received ${result.received}`));
    }
  }
}

/**
 * Start knowledge sync
 */
export function startKnowledgeSync(): void {
  // Prevent double-start
  if (knowledgeSyncTimer) {
    return;
  }

  const config = getKnowledgeSyncConfig();

  if (!config.enabled) {
    return;
  }

  const interval = config.interval || 300000; // Default 5 minutes

  console.log(pc.dim(`   Knowledge sync enabled (every ${interval / 1000}s)`));

  // Run initial sync after 15s delay
  setTimeout(knowledgeSyncTick, 15000);

  // Then sync at configured interval
  knowledgeSyncTimer = setInterval(knowledgeSyncTick, interval);
}

// ============================================
// Memory Cleanup
// ============================================

/**
 * Run memory cleanup tick
 */
function memoryCleanupTick(): void {
  const config = getMemoryTTLConfig();

  if (!config.enabled) {
    return;
  }

  const result = cleanupExpiredMemories();

  if (result.localExpired > 0 || result.sharedExpired > 0) {
    console.log(pc.dim(`\n[Memory Cleanup] Removed ${result.localExpired} local, ${result.sharedExpired} shared (${result.totalRemaining} remaining)`));
  }
}

/**
 * Start memory cleanup timer
 */
export function startMemoryCleanup(): void {
  // Prevent double-start
  if (memoryCleanupTimer) {
    return;
  }

  const config = getMemoryTTLConfig();

  if (!config.enabled) {
    return;
  }

  const interval = config.cleanupInterval || 3600000; // Default 1 hour

  console.log(pc.dim(`   Memory TTL enabled (cleanup every ${interval / 1000}s)`));

  // Run initial cleanup after 20s delay
  setTimeout(memoryCleanupTick, 20000);

  // Then cleanup at configured interval
  memoryCleanupTimer = setInterval(memoryCleanupTick, interval);
}

// ============================================
// Event Hooks
// ============================================

/**
 * Execute an event hook's prompt
 */
async function executeEventHook(hook: EventHook, message: string): Promise<void> {
  console.log(pc.yellow(`\n[Event Hook] ${hook.name}: ${message}`));

  // Execute the hook's prompt
  const result = await executePromptLocally(hook.prompt);

  if (result.success) {
    console.log(pc.green(`   Action completed`));
    if (result.response) {
      const preview = result.response.slice(0, 200).replace(/\n/g, ' ');
      console.log(pc.dim(`   Response: ${preview}${result.response.length > 200 ? '...' : ''}`));
    }
  } else {
    console.log(pc.red(`   Action failed: ${result.response}`));
  }

  // Notify peers if configured
  if (hook.notifyPeers) {
    const fleetConfig = loadFleetConfig();
    const fleetTLS = getFleetTLSConfig();
    const peerPrompt = hook.peerPrompt || `Alert from peer: ${message}`;

    for (const peer of fleetConfig.nodes) {
      await notifyPeerWithRetry(peer, peerPrompt, fleetTLS, 3);
    }
  }
}

/**
 * Notify a peer with retry logic
 */
async function notifyPeerWithRetry(
  peer: FleetNode,
  prompt: string,
  fleetTLS: ReturnType<typeof getFleetTLSConfig>,
  maxRetries: number = 3
): Promise<boolean> {
  const retryDelays = [1000, 3000, 5000]; // 1s, 3s, 5s between retries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(pc.dim(`   Notifying ${peer.name}${attempt > 1 ? ` (retry ${attempt}/${maxRetries})` : ''}...`));

    try {
      const result = await queryFleetNode(peer, prompt, { fleetTLS });

      if (result.success) {
        console.log(pc.dim(`   ${peer.name}: Notified successfully`));
        return true;
      }

      // If it failed but we have retries left, wait and try again
      if (attempt < maxRetries) {
        const delay = retryDelays[attempt - 1] || 5000;
        console.log(pc.dim(`   ${peer.name}: Failed, retrying in ${delay / 1000}s...`));
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.log(pc.red(`   ${peer.name}: Notification failed after ${maxRetries} attempts`));
      }
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = retryDelays[attempt - 1] || 5000;
        console.log(pc.dim(`   ${peer.name}: Error, retrying in ${delay / 1000}s...`));
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.log(pc.red(`   ${peer.name}: Notification error after ${maxRetries} attempts: ${err}`));
      }
    }
  }

  return false;
}

/**
 * Run event hooks check tick
 */
async function eventHooksTick(): Promise<void> {
  const config = getEventHooksConfig();

  if (!config.enabled || !config.hooks?.length) {
    return;
  }

  const eventState = loadEventState();
  const now = Date.now();

  for (const hook of config.hooks) {
    if (hook.enabled === false) {
      continue;
    }

    // Initialize hook state if needed
    if (!eventState.hooks[hook.name]) {
      eventState.hooks[hook.name] = { triggerCount: 0 };
    }

    const hookState = eventState.hooks[hook.name];

    // Skip if in cooldown
    if (isInCooldown(hook, eventState)) {
      continue;
    }

    try {
      // Check the event condition
      const result = await checkEventCondition(
        hook.event,
        hookState.lastValue,
        hookState.lastStatus
      );

      // Update state with current check
      hookState.lastChecked = now;

      // Store current status for edge detection
      if (typeof result.value === 'number') {
        hookState.lastValue = result.value;
        hookState.lastStatus = result.triggered;
      }

      // Execute hook if triggered
      if (result.triggered && result.message) {
        hookState.lastTriggered = now;
        hookState.triggerCount++;
        saveEventState(eventState);

        await executeEventHook(hook, result.message);
      }
    } catch (err) {
      console.error(pc.dim(`Event hook ${hook.name} check failed: ${err}`));
    }
  }

  // Save state periodically
  saveEventState(eventState);
}

/**
 * Start event hooks monitoring
 */
export function startEventHooks(): void {
  // Prevent double-start
  if (eventHooksTimer) {
    return;
  }

  const config = getEventHooksConfig();

  if (!config.enabled) {
    return;
  }

  const hookCount = config.hooks?.length || 0;
  if (hookCount === 0) {
    console.log(pc.dim(`   Event hooks enabled but no hooks configured`));
    return;
  }

  const interval = config.checkInterval || 30000; // Default 30 seconds

  console.log(pc.dim(`   Event hooks enabled (${hookCount} hook${hookCount > 1 ? 's' : ''}, check every ${interval / 1000}s)`));

  // List hooks
  for (const hook of config.hooks || []) {
    if (hook.enabled !== false) {
      console.log(pc.dim(`     - ${hook.name}: ${hook.event.type}`));
    }
  }

  // Run initial check after 25s delay
  setTimeout(eventHooksTick, 25000);

  // Then check at configured interval
  eventHooksTimer = setInterval(eventHooksTick, interval);
}

/**
 * Get handoff stats for API
 */
export function getHandoffStats(): {
  lastPeerIndex: number;
  peers: Array<{
    name: string;
    handoffs: number;
    successes: number;
    failures: number;
    successRate: number;
    consecutiveFailures: number;
    healthy: boolean;
    lastUsed?: string;
    lastSuccess?: string;
  }>;
} {
  const state = loadHandoffState();

  const peers = Object.entries(state.peerStats).map(([name, stats]) => ({
    name,
    handoffs: stats.handoffs,
    successes: stats.successes,
    failures: stats.failures,
    successRate: stats.handoffs > 0 ? Math.round((stats.successes / stats.handoffs) * 100) : 0,
    consecutiveFailures: stats.consecutiveFailures,
    healthy: stats.consecutiveFailures < 3,
    lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toISOString() : undefined,
    lastSuccess: stats.lastSuccess ? new Date(stats.lastSuccess).toISOString() : undefined,
  }));

  return {
    lastPeerIndex: state.lastPeerIndex,
    peers,
  };
}

/**
 * Get scheduler status for API
 */
export function getSchedulerStatus(): {
  enabled: boolean;
  tasks: Array<{ name: string; state: TaskState; schedule: string; nextRun?: number }>;
  handoff: ReturnType<typeof getHandoffStats>;
  knowledgeSync: ReturnType<typeof getSyncStats>;
  memory: ReturnType<typeof getMemoryStats>;
  eventHooks: ReturnType<typeof getEventHooksStats>;
} {
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

  return {
    enabled: config.enabled || false,
    tasks,
    handoff: getHandoffStats(),
    knowledgeSync: getSyncStats(),
    memory: getMemoryStats(),
    eventHooks: getEventHooksStats(),
  };
}
