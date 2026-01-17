#!/usr/bin/env bun
import ora from 'ora';
import pc from 'picocolors';
import { Glob } from 'bun';
import { parseArgs, printHelp, createTemplateConfig, getDefaultSystemPrompt, getServerTLSConfig, getMCPServersConfig, type Verbosity, type ServerTLSConfig } from './config';
import { getProvider, type StreamOptions, type Message, type Provider, type StreamChunk } from './providers';
import { readStdin, filterThinking } from './utils/stream';
import { renderMarkdown } from './utils/markdown';
import { appendHistory } from './history';
import { getToolDefinitions, executeTool, registerTools, type ToolCall } from './tools';
import { readline } from './utils/readline';
import { initializeMCPTools, cleanupMCP } from './mcp';

// Version is injected at build time via --define, falls back to package.json
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.1.0-dev';

const BASE_TOOL_SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools that let you interact with the user's system.

Available tools:
- bash: Execute shell commands (ls, cat, date, grep, curl, etc.)
- read_file: Read file contents
- list_files: List directory contents
- edit_file: Make targeted edits to files
- version: Get your own version and system info
- fleet_list: List all configured fleet nodes and their health
- fleet_query: Query a remote fleet node (params: node, prompt)
- fleet_broadcast: Send a prompt to ALL fleet nodes`;

const MCP_TOOL_INSTRUCTIONS = `
MCP tools are also available from connected MCP servers. These tools are prefixed with "mcp_<server>_".
Use them when their descriptions match the user's needs.`;

const TOOL_EXAMPLES = `
Use tools proactively when they would help answer the user's question. For example:
- "What time is it?" → Use bash with "date"
- "What's in this directory?" → Use list_files or bash with "ls"
- "Show me the contents of config.json" → Use read_file
- "What's my IP address?" → Use bash with "curl ifconfig.me" or similar
- "What version are you running?" → Use version tool
- "Check disk space on server1" → Use fleet_query with node="server1"
- "What's the status of all servers?" → Use fleet_broadcast

When a user mentions @nodename, use fleet_query to query that specific node.
When a user mentions @all, use fleet_broadcast to query all nodes.

Always try to use your tools to get real, accurate information rather than saying you can't help.`;

/**
 * Build the tool system prompt, optionally including MCP tools
 */
function getToolSystemPrompt(hasMCPTools: boolean = false): string {
  let prompt = BASE_TOOL_SYSTEM_PROMPT;
  if (hasMCPTools) {
    prompt += MCP_TOOL_INSTRUCTIONS;
  }
  prompt += TOOL_EXAMPLES;
  return prompt;
}

// Track whether MCP tools have been loaded
let mcpToolsLoaded = false;

/**
 * Build the full system prompt by combining:
 * 1. Config personality/role (defaults.systemPrompt)
 * 2. Tool instructions (if tools enabled)
 * 3. User-provided system prompt (-s flag) takes full precedence if provided
 */
function buildSystemPrompt(userSystemPrompt?: string, includeTools: boolean = true): string | undefined {
  // User-provided system prompt takes full precedence
  if (userSystemPrompt) {
    return userSystemPrompt;
  }

  const parts: string[] = [];

  // Add config personality/role
  const configPrompt = getDefaultSystemPrompt();
  if (configPrompt) {
    parts.push(configPrompt);
  }

  // Add tool instructions
  if (includeTools) {
    parts.push(getToolSystemPrompt(mcpToolsLoaded));
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

type Mode = 'pipe' | 'standalone' | 'repl';

function detectMode(hasPrompt: boolean): { mode: Mode; isOutputPiped: boolean } {
  const isPiped = !process.stdin.isTTY;
  const isOutputPiped = !process.stdout.isTTY;

  if (isPiped) {
    return { mode: 'pipe', isOutputPiped };
  } else if (hasPrompt) {
    return { mode: 'standalone', isOutputPiped };
  } else {
    return { mode: 'repl', isOutputPiped };
  }
}

interface StreamResult {
  text: string;
  toolCalls: ToolCall[];
}

async function streamResponse(
  provider: Provider,
  prompt: string,
  options: StreamOptions,
  showSpinner: boolean,
  useMarkdown: boolean = false
): Promise<StreamResult> {
  let spinner: ReturnType<typeof ora> | null = null;
  if (showSpinner) {
    spinner = ora({
      text: pc.dim(`Thinking... (${provider.name})`),
      spinner: 'dots',
    }).start();
  }

  const rawStream = provider.stream(prompt, options);
  const stream = filterThinking(rawStream);
  let firstChunk = true;
  let fullText = '';
  const toolCalls: ToolCall[] = [];

  for await (const chunk of stream) {
    if (firstChunk && spinner) {
      spinner.stop();
      firstChunk = false;
    }

    if (chunk.type === 'text') {
      // If using markdown, buffer text; otherwise stream it
      if (!useMarkdown) {
        process.stdout.write(chunk.content);
      }
      fullText += chunk.content;
    } else if (chunk.type === 'tool_call') {
      toolCalls.push(chunk.call);
    }
  }

  // If spinner never stopped (empty response), stop it now
  if (spinner && firstChunk) {
    spinner.stop();
  }

  if (fullText) {
    if (useMarkdown) {
      // Render markdown and output
      process.stdout.write(renderMarkdown(fullText));
    } else {
      process.stdout.write('\n');
    }
  }

  return { text: fullText, toolCalls };
}

function formatConfirmation(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'bash') {
    return String(args.command || '');
  }
  if (toolName === 'edit_file') {
    const path = String(args.path || '');
    const oldStr = String(args.old_string || '').slice(0, 50);
    const newStr = String(args.new_string || '').slice(0, 50);
    return `Edit ${path}: "${oldStr}${oldStr.length >= 50 ? '...' : ''}" → "${newStr}${newStr.length >= 50 ? '...' : ''}"`;
  }
  return JSON.stringify(args);
}

async function confirmToolExecution(toolName: string, args: Record<string, unknown>, autoYes: boolean): Promise<boolean> {
  const display = formatConfirmation(toolName, args);

  // Auto-confirm if --yes flag is set
  if (autoYes) {
    process.stderr.write(pc.yellow(`\n⚠ ${pc.bold(toolName)}: ${display} `) + pc.dim('(auto-confirmed)\n'));
    return true;
  }

  process.stderr.write(pc.yellow(`\n⚠ ${pc.bold(toolName)}: ${display}? [y/N] `));

  // Use /dev/tty for confirmation when stdin is piped
  // This allows confirmation to work even with piped input
  if (!process.stdin.isTTY) {
    try {
      const tty = Bun.file('/dev/tty');
      const reader = tty.stream().getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      const char = value ? new TextDecoder().decode(value).toLowerCase().trim() : '';
      console.error();
      return char === 'y';
    } catch {
      // If /dev/tty is not available, deny by default
      console.error(pc.dim(' (no tty, denied)'));
      return false;
    }
  }

  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      const char = chunk.toString().toLowerCase();
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode?.(false);
      console.error();
      resolve(char === 'y');
    };

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}

async function runSingleShot(
  provider: Provider,
  prompt: string,
  options: StreamOptions,
  mode: Mode,
  isOutputPiped: boolean,
  verbosity: Verbosity,
  autoYes: boolean
): Promise<void> {
  const useTools = provider.supportsTools;
  const messages: Message[] = [];

  // Build system prompt: config personality + tools (unless user provided their own)
  const systemPrompt = buildSystemPrompt(options.systemPrompt, useTools);
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const streamOpts: StreamOptions = {
    ...options,
    messages,
    tools: useTools ? getToolDefinitions() : undefined,
  };

  let loopCount = 0;
  const maxLoops = 10;
  let finalText = '';

  while (loopCount < maxLoops) {
    loopCount++;

    const { text, toolCalls } = await streamResponse(provider, prompt, streamOpts, !isOutputPiped, !isOutputPiped);

    const assistantMsg: Message = { role: 'assistant', content: text };
    if (toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls;
    }
    messages.push(assistantMsg);
    finalText = text;

    if (toolCalls.length === 0) {
      break;
    }

    // Execute tool calls
    for (const call of toolCalls) {
      if (verbosity !== 'quiet') {
        console.error(pc.dim(`\n🔧 ${call.name}: ${JSON.stringify(call.arguments)}`));
      }

      const result = await executeTool(call, async (tool, args) => {
        if (tool.requiresConfirmation?.(args)) {
          return confirmToolExecution(tool.definition.name, args, autoYes);
        }
        return true;
      });

      if (verbosity === 'verbose') {
        if (result.error) {
          console.error(pc.red(result.result));
        } else {
          console.error(pc.dim(result.result.slice(0, 500) + (result.result.length > 500 ? '...' : '')));
        }
      }

      messages.push({
        role: 'tool',
        content: result.result,
        tool_call_id: call.id,
      });
    }

    if (verbosity !== 'quiet') {
      console.error();
    }
  }

  await appendHistory({
    timestamp: new Date().toISOString(),
    mode,
    provider: provider.name,
    model: options.model || provider.defaultModel,
    prompt,
    response: finalText,
  });
}

async function runRepl(provider: Provider, options: StreamOptions, verbosity: Verbosity, autoYes: boolean): Promise<void> {
  const messages: Message[] = [];
  const useTools = provider.supportsTools;
  let commandHistory: string[] = [];

  // Build system prompt: config personality + tools (unless user provided their own)
  const systemPrompt = buildSystemPrompt(options.systemPrompt, useTools);
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  console.log(pc.cyan(`AI REPL (${provider.name}:${options.model || provider.defaultModel})`));
  if (useTools) {
    const toolNames = getToolDefinitions().map(t => t.name).join(', ');
    console.log(pc.dim(`Tools enabled: ${toolNames}`));
  }
  console.log(pc.dim('Type "exit" or Ctrl+C to quit, "clear" to reset context\n'));

  while (true) {
    const { line: input, history } = await readline({
      prompt: pc.green('> '),
      history: commandHistory,
    });
    commandHistory = history;

    if (input === null) {
      console.log(pc.dim('Goodbye!'));
      break;
    }

    const trimmed = input.trim();

    if (!trimmed) continue;

    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log(pc.dim('Goodbye!'));
      break;
    }

    if (trimmed.toLowerCase() === 'clear') {
      messages.length = 0;
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      console.log(pc.dim('Context cleared.\n'));
      continue;
    }

    messages.push({ role: 'user', content: trimmed });

    try {
      // Build stream options with tools if supported
      const streamOpts: StreamOptions = {
        ...options,
        messages,
        tools: useTools ? getToolDefinitions() : undefined,
      };

      // Tool execution loop
      let loopCount = 0;
      const maxLoops = 10;

      while (loopCount < maxLoops) {
        loopCount++;

        const { text, toolCalls } = await streamResponse(
          provider,
          trimmed,
          streamOpts,
          true,
          true
        );

        // Add assistant response (with or without tool calls)
        const assistantMsg: Message = { role: 'assistant', content: text };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        messages.push(assistantMsg);

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          await appendHistory({
            timestamp: new Date().toISOString(),
            mode: 'repl',
            provider: provider.name,
            model: options.model || provider.defaultModel,
            prompt: trimmed,
            response: text,
            context_tokens: messages.length,
          });
          break;
        }

        // Execute tool calls
        for (const call of toolCalls) {
          if (verbosity !== 'quiet') {
            console.log(pc.dim(`\n🔧 ${call.name}: ${JSON.stringify(call.arguments)}`));
          }

          const result = await executeTool(call, async (tool, args) => {
            if (tool.requiresConfirmation?.(args)) {
              return confirmToolExecution(tool.definition.name, args, autoYes);
            }
            return true;
          });

          if (verbosity === 'verbose') {
            if (result.error) {
              console.log(pc.red(result.result));
            } else {
              console.log(pc.dim(result.result.slice(0, 500) + (result.result.length > 500 ? '...' : '')));
            }
          }

          // Add tool result to messages
          messages.push({
            role: 'tool',
            content: result.result,
            tool_call_id: call.id,
          });
        }

        if (verbosity !== 'quiet') {
          console.log();
        }
      }

      console.log();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`Error: ${message}\n`));
      messages.pop();
    }
  }

  process.stdin.setRawMode?.(false);
  process.stdin.pause();
}

interface MapReduceOptions {
  provider: Provider;
  streamOptions: StreamOptions;
  prompt: string;
  items: string[];
  reducePrompt?: string;
  verbosity: Verbosity;
  autoYes: boolean;
  isOutputPiped: boolean;
}

async function runMapReduce(options: MapReduceOptions): Promise<void> {
  const { provider, streamOptions, prompt, items, reducePrompt, verbosity, autoYes, isOutputPiped } = options;
  const results: string[] = [];

  // Map phase: process each item
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!.trim();
    if (!item) continue;

    if (!isOutputPiped) {
      console.error(pc.cyan(`\n[${ i + 1}/${items.length}] Processing: ${item}`));
    }

    const itemPrompt = prompt ? `${item}\n\n${prompt}` : item;

    // Capture output instead of streaming to stdout
    const useTools = provider.supportsTools;
    const messages: Message[] = [];

    if (streamOptions.systemPrompt) {
      messages.push({ role: 'system', content: streamOptions.systemPrompt });
    }
    messages.push({ role: 'user', content: itemPrompt });

    const mapStreamOpts: StreamOptions = {
      ...streamOptions,
      messages,
      tools: useTools ? getToolDefinitions() : undefined,
    };

    let loopCount = 0;
    const maxLoops = 10;
    let finalText = '';

    while (loopCount < maxLoops) {
      loopCount++;

      const { text, toolCalls } = await streamResponse(provider, itemPrompt, mapStreamOpts, false, false);

      const assistantMsg: Message = { role: 'assistant', content: text };
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }
      messages.push(assistantMsg);
      finalText = text;

      if (toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      for (const call of toolCalls) {
        if (verbosity !== 'quiet') {
          console.error(pc.dim(`🔧 ${call.name}: ${JSON.stringify(call.arguments)}`));
        }

        const result = await executeTool(call, async (tool, args) => {
          if (tool.requiresConfirmation?.(args)) {
            return confirmToolExecution(tool.definition.name, args, autoYes);
          }
          return true;
        });

        if (verbosity === 'verbose') {
          if (result.error) {
            console.error(pc.red(result.result));
          } else {
            console.error(pc.dim(result.result.slice(0, 200) + (result.result.length > 200 ? '...' : '')));
          }
        }

        messages.push({
          role: 'tool',
          content: result.result,
          tool_call_id: call.id,
        });
      }
    }

    results.push(`[${item}]\n${finalText}`);

    if (!isOutputPiped) {
      console.error(pc.dim(finalText.slice(0, 100) + (finalText.length > 100 ? '...' : '')));
    }
  }

  // Reduce phase: combine results
  if (reducePrompt && results.length > 0) {
    if (!isOutputPiped) {
      console.error(pc.cyan('\n[Reduce] Combining results...'));
    }

    const combinedInput = results.join('\n\n---\n\n');
    const reduceFullPrompt = `${combinedInput}\n\n${reducePrompt}`;

    const { text } = await streamResponse(
      provider,
      reduceFullPrompt,
      { ...streamOptions, messages: [{ role: 'user', content: reduceFullPrompt }] },
      !isOutputPiped,
      !isOutputPiped
    );

    if (isOutputPiped) {
      process.stdout.write(text + '\n');
    }
  } else {
    // Output all map results
    for (const result of results) {
      process.stdout.write(result + '\n\n');
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`ai version ${VERSION}`);
    process.exit(0);
  }

  // Config init mode
  if (args.configInit) {
    createTemplateConfig();
    process.exit(0);
  }

  // Server mode
  if (args.server) {
    const { startServer } = await import('./server');

    // Build TLS config: CLI args override config file
    let tlsConfig: ServerTLSConfig | undefined;
    if (args.cert && args.key) {
      tlsConfig = {
        cert: args.cert,
        key: args.key,
        ca: args.ca,
      };
    } else {
      tlsConfig = getServerTLSConfig();
    }

    await startServer({ port: args.port, token: args.token, tls: tlsConfig });
    return;
  }

  const hasPrompt = args.prompt.length > 0;
  const { mode, isOutputPiped } = detectMode(hasPrompt);

  const provider = getProvider({ model: args.model });
  const streamOptions: StreamOptions = {};

  // Initialize MCP servers if configured
  const mcpServers = getMCPServersConfig();
  if (Object.keys(mcpServers).length > 0) {
    try {
      const mcpTools = await initializeMCPTools(mcpServers);
      if (mcpTools.length > 0) {
        registerTools(mcpTools);
        mcpToolsLoaded = true;
        if (args.verbosity === 'verbose') {
          const toolNames = mcpTools.map(t => t.definition.name).join(', ');
          console.error(pc.dim(`Loaded ${mcpTools.length} MCP tool(s): ${toolNames}`));
        }
      }
    } catch (error) {
      console.error(pc.yellow(`Warning: Failed to initialize MCP servers: ${error}`));
    }
  }

  if (args.systemPrompt) {
    streamOptions.systemPrompt = args.systemPrompt;
  }
  if (args.model && !args.model.includes(':')) {
    streamOptions.model = args.model;
  }

  if (mode === 'repl') {
    await runRepl(provider, streamOptions, args.verbosity, args.yes);
    return;
  }

  const prompt = args.prompt.join(' ');

  // Glob mode: expand pattern and run map/reduce
  if (args.glob) {
    const glob = new Glob(args.glob);
    const items: string[] = [];

    for await (const file of glob.scan('.')) {
      items.push(file);
    }

    if (items.length === 0) {
      console.error(pc.red(`Error: No files match pattern: ${args.glob}`));
      process.exit(1);
    }

    items.sort(); // Consistent ordering

    if (!isOutputPiped) {
      console.error(pc.dim(`Found ${items.length} files matching "${args.glob}"\n`));
    }

    try {
      await runMapReduce({
        provider,
        streamOptions,
        prompt,
        items,
        reducePrompt: args.reduce,
        verbosity: args.verbosity,
        autoYes: args.yes,
        isOutputPiped,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`Error: ${message}`));
      process.exit(1);
    }
    return;
  }

  // Map/Reduce mode with piped input
  if (args.map && mode === 'pipe') {
    const stdinContent = await readStdin();
    const items = stdinContent.split('\n').filter(line => line.trim());

    if (items.length === 0) {
      console.error(pc.red('Error: No input items for map'));
      process.exit(1);
    }

    try {
      await runMapReduce({
        provider,
        streamOptions,
        prompt,
        items,
        reducePrompt: args.reduce,
        verbosity: args.verbosity,
        autoYes: args.yes,
        isOutputPiped,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`Error: ${message}`));
      process.exit(1);
    }
    return;
  }

  // Standard pipe/standalone mode
  let fullPrompt = prompt;

  if (mode === 'pipe') {
    const stdinContent = await readStdin();
    if (stdinContent) {
      if (fullPrompt) {
        fullPrompt = `${stdinContent}\n\n${fullPrompt}`;
      } else {
        fullPrompt = stdinContent;
      }
    }
  }

  if (!fullPrompt.trim()) {
    console.error(pc.red('Error: No prompt provided'));
    process.exit(1);
  }

  try {
    await runSingleShot(provider, fullPrompt, streamOptions, mode, isOutputPiped, args.verbosity, args.yes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`Error: ${message}`));
    // Cleanup MCP before exiting
    if (mcpToolsLoaded) {
      await cleanupMCP();
    }
    process.exit(1);
  }

  // Cleanup MCP connections
  if (mcpToolsLoaded) {
    await cleanupMCP();
  }
}

main().catch(async (error) => {
  console.error(pc.red(`Fatal error: ${error.message}`));
  if (mcpToolsLoaded) {
    await cleanupMCP();
  }
  process.exit(1);
});
