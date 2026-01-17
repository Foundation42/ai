import { getProvider, type StreamOptions, type Message } from './providers';
import { getToolDefinitions, executeTool, type ToolCall } from './tools';
import { getDefaultSystemPrompt } from './config';
import { checkForUpgrade, performUpgrade } from './upgrade';
import pc from 'picocolors';

// Version is injected at build time via --define
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.1.0-dev';

const TOOL_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools that let you interact with the user's system.

Available tools:
- bash: Execute shell commands (ls, cat, date, grep, curl, etc.)
- read_file: Read file contents
- list_files: List directory contents
- edit_file: Make targeted edits to files

Use tools proactively when they would help answer the user's question. For example:
- "What time is it?" → Use bash with "date"
- "What's in this directory?" → Use list_files or bash with "ls"
- "Show me the contents of config.json" → Use read_file
- "What's my IP address?" → Use bash with "curl ifconfig.me" or similar

Always try to use your tools to get real, accurate information rather than saying you can't help.`;

/**
 * Build the full system prompt for fleet nodes by combining:
 * 1. Config personality/role (defaults.systemPrompt)
 * 2. Tool instructions (if tools enabled)
 * 3. Request-provided system prompt takes full precedence if provided
 */
function buildSystemPrompt(requestSystemPrompt?: string, includeTools: boolean = true): string | undefined {
  // Request-provided system prompt takes full precedence
  if (requestSystemPrompt) {
    return requestSystemPrompt;
  }

  const parts: string[] = [];

  // Add config personality/role
  const configPrompt = getDefaultSystemPrompt();
  if (configPrompt) {
    parts.push(configPrompt);
  }

  // Add tool instructions
  if (includeTools) {
    parts.push(TOOL_SYSTEM_PROMPT);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

interface ServerConfig {
  port: number;
  token?: string;
}

interface ChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  tools?: Array<Record<string, unknown>>;
}

interface FleetExecuteRequest {
  prompt: string;
  model?: string;
  system?: string;
  tools?: boolean;  // Enable tool execution (default: true)
}

export async function startServer(config: ServerConfig): Promise<void> {
  const token = config.token || process.env.AI_SERVER_TOKEN || generateToken();
  const showToken = !config.token && !process.env.AI_SERVER_TOKEN;

  console.log(pc.cyan(`\n🚀 AI Server v${VERSION} starting on port ${config.port}`));
  console.log(pc.dim(`   OpenAI-compatible: POST /v1/chat/completions`));
  console.log(pc.dim(`   Fleet execute:     POST /v1/fleet/execute`));
  console.log(pc.dim(`   Fleet health:      GET  /v1/fleet/health`));
  console.log(pc.dim(`   Fleet upgrade:     GET/POST /v1/fleet/upgrade`));
  console.log(pc.dim(`   List models:       GET  /v1/models`));

  if (showToken) {
    console.log(pc.yellow(`\n⚠️  Generated token (set AI_SERVER_TOKEN to use your own):`));
    console.log(pc.green(`   ${token}\n`));
  } else {
    console.log(pc.dim(`\n   Using configured token\n`));
  }

  const server = Bun.serve({
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          },
        });
      }

      // Auth check (skip for health endpoint)
      if (url.pathname !== '/v1/fleet/health') {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${token}`) {
          return jsonResponse({ error: { message: 'Unauthorized', type: 'auth_error' } }, 401);
        }
      }

      try {
        // OpenAI-compatible chat completions
        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
          return await handleChatCompletions(req);
        }

        // List models
        if (url.pathname === '/v1/models' && req.method === 'GET') {
          return handleListModels();
        }

        // Fleet execute
        if (url.pathname === '/v1/fleet/execute' && req.method === 'POST') {
          return await handleFleetExecute(req);
        }

        // Fleet health
        if (url.pathname === '/v1/fleet/health' && req.method === 'GET') {
          return handleFleetHealth();
        }

        // Fleet upgrade check
        if (url.pathname === '/v1/fleet/upgrade' && req.method === 'GET') {
          return await handleUpgradeCheck();
        }

        // Fleet upgrade perform
        if (url.pathname === '/v1/fleet/upgrade' && req.method === 'POST') {
          return await handleUpgradePerform();
        }

        return jsonResponse({ error: { message: 'Not found', type: 'not_found' } }, 404);
      } catch (err) {
        console.error(pc.red('Server error:'), err);
        return jsonResponse({
          error: { message: err instanceof Error ? err.message : 'Internal error', type: 'server_error' }
        }, 500);
      }
    },
  });

  console.log(pc.green(`✓ Server listening on http://localhost:${server.port}`));
}

async function handleChatCompletions(req: Request): Promise<Response> {
  const body = await req.json() as ChatCompletionRequest;
  const model = body.model;
  const stream = body.stream ?? false;

  // Convert messages
  const messages: Message[] = body.messages.map(m => ({
    role: m.role as Message['role'],
    content: m.content,
  }));

  const provider = getProvider({ model });
  const useTools = provider.supportsTools;

  const streamOpts: StreamOptions = {
    model: model?.includes(':') ? model.split(':').slice(1).join(':') : model,
    messages,
    tools: useTools ? getToolDefinitions() : undefined,
  };

  if (stream) {
    return handleStreamingResponse(provider, streamOpts, model || provider.defaultModel);
  } else {
    return await handleNonStreamingResponse(provider, streamOpts, messages, model || provider.defaultModel);
  }
}

async function handleStreamingResponse(
  provider: ReturnType<typeof getProvider>,
  streamOpts: StreamOptions,
  model: string
): Promise<Response> {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${Date.now()}`;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of provider.stream('', streamOpts)) {
          if (chunk.type === 'text') {
            const data = {
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: { content: chunk.content },
                finish_reason: null,
              }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } else if (chunk.type === 'tool_call') {
            // Execute tool and continue
            const result = await executeTool(chunk.call, async () => true);
            const data = {
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: { content: `\n[Tool: ${chunk.call.name}]\n${result.result}\n` },
                finish_reason: null,
              }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        }

        // Send done
        const doneData = {
          id,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneData)}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function handleNonStreamingResponse(
  provider: ReturnType<typeof getProvider>,
  streamOpts: StreamOptions,
  messages: Message[],
  model: string
): Promise<Response> {
  let fullText = '';
  const toolCalls: ToolCall[] = [];
  const maxLoops = 10;
  let loopCount = 0;

  while (loopCount < maxLoops) {
    loopCount++;
    let text = '';
    const currentToolCalls: ToolCall[] = [];

    for await (const chunk of provider.stream('', streamOpts)) {
      if (chunk.type === 'text') {
        text += chunk.content;
      } else if (chunk.type === 'tool_call') {
        currentToolCalls.push(chunk.call);
      }
    }

    fullText += text;

    if (currentToolCalls.length === 0) {
      break;
    }

    // Execute tools
    const assistantMsg: Message = { role: 'assistant', content: text, tool_calls: currentToolCalls };
    messages.push(assistantMsg);

    for (const call of currentToolCalls) {
      toolCalls.push(call);
      const result = await executeTool(call, async () => true);
      messages.push({
        role: 'tool',
        content: result.result,
        tool_call_id: call.id,
      });
      fullText += `\n[Tool: ${call.name}]\n${result.result}\n`;
    }

    streamOpts.messages = messages;
  }

  return jsonResponse({
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: fullText },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

async function handleFleetExecute(req: Request): Promise<Response> {
  const body = await req.json() as FleetExecuteRequest;
  const { prompt, model, system, tools = true } = body;

  const provider = getProvider({ model });
  const useTools = tools && provider.supportsTools;

  const messages: Message[] = [];
  // Build system prompt: config personality + tools (unless request provided their own)
  const systemPrompt = buildSystemPrompt(system, useTools);
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const streamOpts: StreamOptions = {
    model: model?.includes(':') ? model.split(':').slice(1).join(':') : model,
    messages,
    tools: useTools ? getToolDefinitions() : undefined,
  };

  let fullText = '';
  const toolResults: Array<{ name: string; result: string }> = [];
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
      const result = await executeTool(call, async () => true);
      toolResults.push({ name: call.name, result: result.result });
      messages.push({
        role: 'tool',
        content: result.result,
        tool_call_id: call.id,
      });
    }

    streamOpts.messages = messages;
  }

  return jsonResponse({
    success: true,
    response: fullText,
    tools_executed: toolResults,
    provider: provider.name,
    model: model || provider.defaultModel,
  });
}

function handleListModels(): Response {
  const models = [
    { id: 'google:gemini-2.0-flash', provider: 'google', tools: true },
    { id: 'anthropic:claude-sonnet-4-20250514', provider: 'anthropic', tools: true },
    { id: 'openai:gpt-4o-mini', provider: 'openai', tools: true },
    { id: 'openai:gpt-4o', provider: 'openai', tools: true },
    { id: 'mistral:mistral-small-latest', provider: 'mistral', tools: true },
    { id: 'deepseek:deepseek-chat', provider: 'deepseek', tools: true },
    { id: 'ollama:llama3.2', provider: 'ollama', tools: true },
  ];

  return jsonResponse({
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created: 1700000000,
      owned_by: m.provider,
      capabilities: { tools: m.tools },
    })),
  });
}

function handleFleetHealth(): Response {
  const os = require('os');

  return jsonResponse({
    status: 'healthy',
    version: VERSION,
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    load: os.loadavg(),
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
    },
    cpus: os.cpus().length,
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function handleUpgradeCheck(): Promise<Response> {
  const check = await checkForUpgrade(VERSION);

  return jsonResponse({
    currentVersion: check.currentVersion,
    latestVersion: check.latestVersion,
    upgradeAvailable: check.available,
    message: check.available
      ? `Upgrade available: v${check.currentVersion} -> v${check.latestVersion}`
      : `Already at latest version (v${check.currentVersion})`,
  });
}

async function handleUpgradePerform(): Promise<Response> {
  console.log(pc.yellow('Upgrade requested...'));

  const result = await performUpgrade(VERSION, { restart: true });

  if (result.restarting) {
    // Send response before exiting
    const response = jsonResponse({
      success: true,
      message: result.message,
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      restarting: true,
    });

    // Schedule exit after response is sent
    setTimeout(() => {
      console.log(pc.green('Upgrade complete, exiting...'));
      process.exit(0);
    }, 100);

    return response;
  }

  return jsonResponse({
    success: result.success,
    message: result.message,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
  });
}

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'sk-';
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}
