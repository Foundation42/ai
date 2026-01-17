import type { Tool, ToolDefinition } from './types';
import {
  writeMemory,
  readMemories,
  searchMemories,
  deleteMemory,
  formatMemories,
  getMemoriesForSharing,
  receiveSharedMemories,
  type Memory,
} from '../memory';
import { loadFleetConfig, queryFleetNode } from '../fleet';
import { getFleetTLSConfig } from '../config';

/**
 * Write a new memory (learning, solution, observation)
 */
export class MemoryWriteTool implements Tool {
  definition: ToolDefinition = {
    name: 'memory_write',
    description: `Store a memory for future reference. Use this to save:
- Learnings: Things you've discovered or figured out
- Solutions: Fixes for problems you've solved
- Observations: Notable patterns or behaviors
- Notes: General information worth remembering

The memory will be stored locally and can be shared with peers.`,
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['learning', 'solution', 'observation', 'note'],
          description: 'Type of memory',
        },
        title: {
          type: 'string',
          description: 'Short title summarizing the memory',
        },
        content: {
          type: 'string',
          description: 'Full content of the memory',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for searching (e.g., ["nginx", "performance"])',
        },
        context: {
          type: 'string',
          description: 'Optional context (e.g., "fixing nginx 502 errors")',
        },
      },
      required: ['category', 'title', 'content'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const category = args.category as Memory['category'];
    const title = String(args.title || '');
    const content = String(args.content || '');
    const tags = (args.tags as string[]) || [];
    const context = args.context ? String(args.context) : undefined;

    if (!title || !content) {
      return 'Error: title and content are required';
    }

    const memory = writeMemory({
      category,
      title,
      content,
      tags: tags.map(t => t.toLowerCase()),
      context,
    });

    return `Memory saved: "${memory.title}" (${memory.id})`;
  }
}

/**
 * Read memories with optional filters
 */
export class MemoryReadTool implements Tool {
  definition: ToolDefinition = {
    name: 'memory_read',
    description: `Read memories from local storage. Can filter by category, tags, or source.
Returns both local memories and those shared from peers.`,
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['learning', 'solution', 'observation', 'note'],
          description: 'Filter by category',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (any match)',
        },
        source: {
          type: 'string',
          description: 'Filter by source ("local" or peer name)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return',
        },
      },
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const category = args.category as Memory['category'] | undefined;
    const tags = args.tags as string[] | undefined;
    const source = args.source as string | undefined;
    const limit = args.limit as number | undefined;

    const memories = readMemories({
      category,
      tags,
      source,
      limit: limit || 10,
      includeShared: true,
    });

    return formatMemories(memories);
  }
}

/**
 * Search memories by text
 */
export class MemorySearchTool implements Tool {
  definition: ToolDefinition = {
    name: 'memory_search',
    description: `Search memories by text query. Searches title, content, tags, and context.
Use this to find relevant past experiences or solutions.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        category: {
          type: 'string',
          enum: ['learning', 'solution', 'observation', 'note'],
          description: 'Filter by category',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 5)',
        },
      },
      required: ['query'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query || '');
    const category = args.category as Memory['category'] | undefined;
    const limit = (args.limit as number) || 5;

    if (!query) {
      return 'Error: query is required';
    }

    const memories = searchMemories(query, {
      category,
      limit,
      includeShared: true,
    });

    if (memories.length === 0) {
      return `No memories found matching "${query}"`;
    }

    return formatMemories(memories);
  }
}

/**
 * Share memories with peer nodes
 */
export class MemoryShareTool implements Tool {
  definition: ToolDefinition = {
    name: 'memory_share',
    description: `Share memories with peer nodes in the fleet.
Use this to spread learnings or solutions to other nodes.`,
    parameters: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Peer node name, or "all" for all peers',
        },
        category: {
          type: 'string',
          enum: ['learning', 'solution', 'observation', 'note'],
          description: 'Only share memories of this category',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only share memories with these tags',
        },
        limit: {
          type: 'number',
          description: 'Maximum memories to share (default 5)',
        },
      },
      required: ['node'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const nodeName = String(args.node || '').toLowerCase();
    const category = args.category as Memory['category'] | undefined;
    const tags = args.tags as string[] | undefined;
    const limit = (args.limit as number) || 5;

    if (!nodeName) {
      return 'Error: node is required';
    }

    const fleetConfig = loadFleetConfig();
    const fleetTLS = getFleetTLSConfig();

    // Get memories to share
    const memories = getMemoriesForSharing({ category, tags, limit });

    if (memories.length === 0) {
      return 'No memories to share';
    }

    // Determine target nodes
    let targetNodes = fleetConfig.nodes;
    if (nodeName !== 'all') {
      targetNodes = targetNodes.filter(n => n.name.toLowerCase() === nodeName);
      if (targetNodes.length === 0) {
        return `Error: Unknown node "${nodeName}"`;
      }
    }

    const results: string[] = [];

    for (const node of targetNodes) {
      // Send memories to peer via fleet query
      const memoriesJson = JSON.stringify(memories);
      const prompt = `MEMORY_SHARE_PROTOCOL: Please store these shared memories from me: ${memoriesJson}

Use the memory_receive tool to store them, then confirm what you received.`;

      const result = await queryFleetNode(node, prompt, { fleetTLS });

      if (result.success) {
        results.push(`${node.name}: Shared ${memories.length} memories`);
      } else {
        results.push(`${node.name}: Failed - ${result.error}`);
      }
    }

    return results.join('\n');
  }
}

/**
 * Receive shared memories from a peer (internal use)
 */
export class MemoryReceiveTool implements Tool {
  definition: ToolDefinition = {
    name: 'memory_receive',
    description: `Receive and store memories shared from a peer node.
This is typically called automatically when a peer shares memories.`,
    parameters: {
      type: 'object',
      properties: {
        peer: {
          type: 'string',
          description: 'Name of the peer sending memories',
        },
        memories: {
          type: 'string',
          description: 'JSON array of memories to store',
        },
      },
      required: ['peer', 'memories'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const peer = String(args.peer || '');
    const memoriesJson = String(args.memories || '');

    if (!peer || !memoriesJson) {
      return 'Error: peer and memories are required';
    }

    try {
      const memories = JSON.parse(memoriesJson) as Memory[];
      receiveSharedMemories(peer, memories);
      return `Received and stored ${memories.length} memories from ${peer}`;
    } catch (err) {
      return `Error parsing memories: ${err instanceof Error ? err.message : err}`;
    }
  }
}

/**
 * Ask peers for help (searches peer memories and asks if needed)
 */
export class MemoryAskPeersTool implements Tool {
  definition: ToolDefinition = {
    name: 'memory_ask_peers',
    description: `Ask peer nodes if they have relevant memories or solutions.
Use this when you encounter a problem and want to see if other nodes have experience with it.`,
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'What you need help with',
        },
        node: {
          type: 'string',
          description: 'Specific peer to ask, or "all" (default: all)',
        },
      },
      required: ['question'],
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const question = String(args.question || '');
    const nodeName = String(args.node || 'all').toLowerCase();

    if (!question) {
      return 'Error: question is required';
    }

    const fleetConfig = loadFleetConfig();
    const fleetTLS = getFleetTLSConfig();

    // Determine target nodes
    let targetNodes = fleetConfig.nodes;
    if (nodeName !== 'all') {
      targetNodes = targetNodes.filter(n => n.name.toLowerCase() === nodeName);
      if (targetNodes.length === 0) {
        return `Error: Unknown node "${nodeName}"`;
      }
    }

    const results: string[] = [];

    for (const node of targetNodes) {
      const prompt = `A peer node is asking for help with: "${question}"

Please search your memories for anything relevant. If you have related experiences, solutions, or learnings, share them. Use memory_search to look for relevant memories, then summarize what you know.`;

      const result = await queryFleetNode(node, prompt, { fleetTLS });

      if (result.success && result.response) {
        results.push(`**${node.name}:**\n${result.response}`);
      } else {
        results.push(`**${node.name}:** No response`);
      }
    }

    return results.join('\n\n');
  }
}
