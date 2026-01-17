import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ensureConfigDir, getMemoryTTLConfig } from './config';

const MEMORY_PATH = join(homedir(), '.config', 'ai', 'memory.json');
const SYNC_STATE_PATH = join(homedir(), '.config', 'ai', 'memory-sync.json');

export interface Memory {
  id: string;               // Unique identifier
  category: 'learning' | 'solution' | 'observation' | 'note';
  title: string;            // Short title/summary
  content: string;          // Full content
  tags: string[];           // Searchable tags
  created: number;          // Timestamp
  updated?: number;         // Last update timestamp
  source: string;           // 'local' or peer node name
  ttl?: number;             // Optional expiry timestamp
  context?: string;         // Optional context (e.g., "nginx config issue")
}

export interface MemoryStore {
  memories: Memory[];
  shared: Record<string, Memory[]>;  // Memories received from peers
}

/**
 * Load memory store from disk
 */
export function loadMemoryStore(): MemoryStore {
  try {
    if (existsSync(MEMORY_PATH)) {
      return JSON.parse(readFileSync(MEMORY_PATH, 'utf-8'));
    }
  } catch {}
  return { memories: [], shared: {} };
}

/**
 * Save memory store to disk
 */
export function saveMemoryStore(store: MemoryStore): void {
  ensureConfigDir();
  writeFileSync(MEMORY_PATH, JSON.stringify(store, null, 2));
}

/**
 * Generate a unique memory ID
 */
function generateId(): string {
  return 'mem_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Write a new memory
 */
export function writeMemory(params: {
  category: Memory['category'];
  title: string;
  content: string;
  tags?: string[];
  context?: string;
  ttl?: number;        // Explicit TTL timestamp (absolute)
  ttlDuration?: number; // TTL duration in ms from now
  noExpiry?: boolean;   // Set to true to never expire
}): Memory {
  const store = loadMemoryStore();
  const ttlConfig = getMemoryTTLConfig();
  const now = Date.now();

  // Determine TTL
  let expiryTime: number | undefined;

  if (params.noExpiry) {
    // Explicitly no expiry
    expiryTime = undefined;
  } else if (params.ttl) {
    // Explicit TTL timestamp
    expiryTime = params.ttl;
  } else if (params.ttlDuration) {
    // TTL duration from now
    expiryTime = now + params.ttlDuration;
  } else if (ttlConfig.enabled) {
    // Apply default TTL based on category
    const defaultDuration = ttlConfig.defaultTTL[params.category];
    expiryTime = now + defaultDuration;
  }

  const memory: Memory = {
    id: generateId(),
    category: params.category,
    title: params.title,
    content: params.content,
    tags: params.tags || [],
    created: now,
    source: 'local',
    context: params.context,
    ttl: expiryTime,
  };

  store.memories.push(memory);
  saveMemoryStore(store);

  return memory;
}

/**
 * Read memories with optional filters
 */
export function readMemories(params?: {
  category?: Memory['category'];
  tags?: string[];
  source?: string;
  limit?: number;
  includeShared?: boolean;
}): Memory[] {
  const store = loadMemoryStore();
  const now = Date.now();

  let results: Memory[] = [...store.memories];

  // Include shared memories if requested
  if (params?.includeShared !== false) {
    for (const peerMemories of Object.values(store.shared)) {
      results.push(...peerMemories);
    }
  }

  // Filter out expired memories
  results = results.filter(m => !m.ttl || m.ttl > now);

  // Apply filters
  if (params?.category) {
    results = results.filter(m => m.category === params.category);
  }

  if (params?.tags && params.tags.length > 0) {
    results = results.filter(m =>
      params.tags!.some(tag => m.tags.includes(tag.toLowerCase()))
    );
  }

  if (params?.source) {
    results = results.filter(m => m.source === params.source);
  }

  // Sort by created date (newest first)
  results.sort((a, b) => b.created - a.created);

  // Apply limit
  if (params?.limit && params.limit > 0) {
    results = results.slice(0, params.limit);
  }

  return results;
}

/**
 * Search memories by text (title, content, tags)
 */
export function searchMemories(query: string, params?: {
  category?: Memory['category'];
  limit?: number;
  includeShared?: boolean;
}): Memory[] {
  const store = loadMemoryStore();
  const now = Date.now();
  const queryLower = query.toLowerCase();

  let results: Memory[] = [...store.memories];

  // Include shared memories if requested
  if (params?.includeShared !== false) {
    for (const peerMemories of Object.values(store.shared)) {
      results.push(...peerMemories);
    }
  }

  // Filter out expired memories
  results = results.filter(m => !m.ttl || m.ttl > now);

  // Search by title, content, tags, and context
  results = results.filter(m =>
    m.title.toLowerCase().includes(queryLower) ||
    m.content.toLowerCase().includes(queryLower) ||
    m.tags.some(t => t.toLowerCase().includes(queryLower)) ||
    (m.context && m.context.toLowerCase().includes(queryLower))
  );

  // Apply category filter
  if (params?.category) {
    results = results.filter(m => m.category === params.category);
  }

  // Sort by relevance (title matches first, then content)
  results.sort((a, b) => {
    const aTitle = a.title.toLowerCase().includes(queryLower) ? 1 : 0;
    const bTitle = b.title.toLowerCase().includes(queryLower) ? 1 : 0;
    if (aTitle !== bTitle) return bTitle - aTitle;
    return b.created - a.created;
  });

  // Apply limit
  if (params?.limit && params.limit > 0) {
    results = results.slice(0, params.limit);
  }

  return results;
}

/**
 * Delete a memory by ID
 */
export function deleteMemory(id: string): boolean {
  const store = loadMemoryStore();
  const index = store.memories.findIndex(m => m.id === id);

  if (index === -1) {
    return false;
  }

  store.memories.splice(index, 1);
  saveMemoryStore(store);
  return true;
}

/**
 * Update a memory
 */
export function updateMemory(id: string, updates: Partial<Pick<Memory, 'title' | 'content' | 'tags' | 'context'>>): Memory | null {
  const store = loadMemoryStore();
  const memory = store.memories.find(m => m.id === id);

  if (!memory) {
    return null;
  }

  if (updates.title !== undefined) memory.title = updates.title;
  if (updates.content !== undefined) memory.content = updates.content;
  if (updates.tags !== undefined) memory.tags = updates.tags;
  if (updates.context !== undefined) memory.context = updates.context;
  memory.updated = Date.now();

  saveMemoryStore(store);
  return memory;
}

/**
 * Receive shared memories from a peer
 */
export function receiveSharedMemories(peerName: string, memories: Memory[]): void {
  const store = loadMemoryStore();

  // Mark memories with their source
  const processed = memories.map(m => ({
    ...m,
    source: peerName,
  }));

  // Replace or merge with existing shared memories from this peer
  store.shared[peerName] = processed;

  saveMemoryStore(store);
}

/**
 * Get memories to share with peers
 */
export function getMemoriesForSharing(params?: {
  category?: Memory['category'];
  tags?: string[];
  limit?: number;
}): Memory[] {
  // Only share local memories
  return readMemories({
    ...params,
    source: 'local',
    includeShared: false,
  });
}

/**
 * Format memories for display
 */
export function formatMemories(memories: Memory[]): string {
  if (memories.length === 0) {
    return 'No memories found.';
  }

  const lines: string[] = [];

  for (const m of memories) {
    const date = new Date(m.created).toLocaleDateString();
    const source = m.source === 'local' ? '' : ` (from ${m.source})`;
    const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';

    lines.push(`**${m.title}**${source}`);
    lines.push(`  ${m.category} | ${date}${tags}`);
    lines.push(`  ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================
// Knowledge Sync
// ============================================

export interface SyncState {
  peers: Record<string, {
    lastSyncTime: number;      // When we last synced with this peer
    lastSentId?: string;       // Last memory ID we sent
    lastReceivedId?: string;   // Last memory ID we received
    syncCount: number;         // Total syncs with this peer
  }>;
}

/**
 * Load sync state from disk
 */
export function loadSyncState(): SyncState {
  try {
    if (existsSync(SYNC_STATE_PATH)) {
      return JSON.parse(readFileSync(SYNC_STATE_PATH, 'utf-8'));
    }
  } catch {}
  return { peers: {} };
}

/**
 * Save sync state to disk
 */
export function saveSyncState(state: SyncState): void {
  ensureConfigDir();
  writeFileSync(SYNC_STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Get memories created/updated since a timestamp
 */
export function getMemoriesSince(timestamp: number): Memory[] {
  const store = loadMemoryStore();
  return store.memories.filter(m => {
    const effectiveTime = m.updated || m.created;
    return effectiveTime > timestamp && m.source === 'local';
  });
}

/**
 * Merge received memories, avoiding duplicates
 */
export function mergeReceivedMemories(peerName: string, memories: Memory[]): number {
  const store = loadMemoryStore();

  // Initialize shared array for peer if needed
  if (!store.shared[peerName]) {
    store.shared[peerName] = [];
  }

  const existingIds = new Set(store.shared[peerName].map(m => m.id));
  let addedCount = 0;

  for (const memory of memories) {
    if (!existingIds.has(memory.id)) {
      store.shared[peerName].push({
        ...memory,
        source: peerName,
      });
      addedCount++;
    }
  }

  if (addedCount > 0) {
    saveMemoryStore(store);
  }

  return addedCount;
}

/**
 * Update sync state after a successful sync
 */
export function updateSyncState(peerName: string, sentMemories: Memory[], receivedMemories: Memory[]): void {
  const state = loadSyncState();

  if (!state.peers[peerName]) {
    state.peers[peerName] = {
      lastSyncTime: 0,
      syncCount: 0,
    };
  }

  const peer = state.peers[peerName];
  peer.lastSyncTime = Date.now();
  peer.syncCount++;

  if (sentMemories.length > 0) {
    peer.lastSentId = sentMemories[sentMemories.length - 1]!.id;
  }

  if (receivedMemories.length > 0) {
    peer.lastReceivedId = receivedMemories[receivedMemories.length - 1]!.id;
  }

  saveSyncState(state);
}

/**
 * Get last sync time for a peer
 */
export function getLastSyncTime(peerName: string): number {
  const state = loadSyncState();
  return state.peers[peerName]?.lastSyncTime || 0;
}

/**
 * Get sync statistics
 */
export function getSyncStats(): { peers: Record<string, { lastSync: string; syncCount: number; memoriesShared: number }> } {
  const state = loadSyncState();
  const store = loadMemoryStore();

  const stats: Record<string, { lastSync: string; syncCount: number; memoriesShared: number }> = {};

  for (const [peerName, peerState] of Object.entries(state.peers)) {
    stats[peerName] = {
      lastSync: peerState.lastSyncTime ? new Date(peerState.lastSyncTime).toISOString() : 'never',
      syncCount: peerState.syncCount,
      memoriesShared: store.shared[peerName]?.length || 0,
    };
  }

  return { peers: stats };
}

// ============================================
// Memory Cleanup
// ============================================

export interface CleanupResult {
  localExpired: number;
  sharedExpired: number;
  totalRemaining: number;
}

/**
 * Clean up expired memories from local and shared stores
 */
export function cleanupExpiredMemories(): CleanupResult {
  const store = loadMemoryStore();
  const now = Date.now();

  const originalLocalCount = store.memories.length;
  const originalSharedCount = Object.values(store.shared).reduce((sum, arr) => sum + arr.length, 0);

  // Filter out expired local memories
  store.memories = store.memories.filter(m => !m.ttl || m.ttl > now);

  // Filter out expired shared memories
  for (const peerName of Object.keys(store.shared)) {
    store.shared[peerName] = store.shared[peerName].filter(m => !m.ttl || m.ttl > now);

    // Remove empty peer entries
    if (store.shared[peerName].length === 0) {
      delete store.shared[peerName];
    }
  }

  const localExpired = originalLocalCount - store.memories.length;
  const newSharedCount = Object.values(store.shared).reduce((sum, arr) => sum + arr.length, 0);
  const sharedExpired = originalSharedCount - newSharedCount;

  // Save if any changes were made
  if (localExpired > 0 || sharedExpired > 0) {
    saveMemoryStore(store);
  }

  return {
    localExpired,
    sharedExpired,
    totalRemaining: store.memories.length + newSharedCount,
  };
}

/**
 * Get memory statistics for API
 */
export function getMemoryStats(): {
  local: { total: number; byCategory: Record<string, number>; expiring: { soon: number; thisWeek: number } };
  shared: { total: number; byPeer: Record<string, number> };
  ttlEnabled: boolean;
} {
  const store = loadMemoryStore();
  const ttlConfig = getMemoryTTLConfig();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // Count by category
  const byCategory: Record<string, number> = {
    learning: 0,
    solution: 0,
    observation: 0,
    note: 0,
  };
  for (const m of store.memories) {
    byCategory[m.category]++;
  }

  // Count expiring memories
  let expiringSoon = 0; // Within 24 hours
  let expiringThisWeek = 0; // Within 7 days
  for (const m of store.memories) {
    if (m.ttl) {
      const timeLeft = m.ttl - now;
      if (timeLeft > 0 && timeLeft <= DAY) expiringSoon++;
      if (timeLeft > 0 && timeLeft <= 7 * DAY) expiringThisWeek++;
    }
  }

  // Count shared by peer
  const byPeer: Record<string, number> = {};
  let sharedTotal = 0;
  for (const [peerName, memories] of Object.entries(store.shared)) {
    byPeer[peerName] = memories.length;
    sharedTotal += memories.length;
  }

  return {
    local: {
      total: store.memories.length,
      byCategory,
      expiring: {
        soon: expiringSoon,
        thisWeek: expiringThisWeek,
      },
    },
    shared: {
      total: sharedTotal,
      byPeer,
    },
    ttlEnabled: ttlConfig.enabled,
  };
}
