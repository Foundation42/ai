#!/usr/bin/env bun
import ora from 'ora';
import pc from 'picocolors';
import { parseArgs, printHelp, loadEnvFile, type Verbosity } from './config';
import { getProvider, type StreamOptions, type Message, type Provider, type StreamChunk } from './providers';
import { readStdin, filterThinking } from './utils/stream';
import { renderMarkdown } from './utils/markdown';
import { appendHistory } from './history';
import { getToolDefinitions, executeTool, type ToolCall } from './tools';

const VERSION = '0.1.0';

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

async function confirmToolExecution(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(pc.yellow(`\n⚠ Execute: ${pc.bold(command)}? [y/N] `));

    const onData = (chunk: Buffer) => {
      const char = chunk.toString().toLowerCase();
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode?.(false);
      console.log();
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
  verbosity: Verbosity
): Promise<void> {
  const useTools = provider.supportsTools;
  const messages: Message[] = [];

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
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
          return confirmToolExecution(String(args.command || ''));
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

async function runRepl(provider: Provider, options: StreamOptions, verbosity: Verbosity): Promise<void> {
  const messages: Message[] = [];
  const useTools = provider.supportsTools;

  // Add system prompt if provided
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }

  console.log(pc.cyan(`AI REPL (${provider.name}:${options.model || provider.defaultModel})`));
  if (useTools) {
    console.log(pc.dim('Tools enabled: bash'));
  }
  console.log(pc.dim('Type "exit" or Ctrl+C to quit, "clear" to reset context\n'));

  const promptUser = async (): Promise<string | null> => {
    return new Promise((resolve) => {
      process.stdout.write(pc.green('> '));

      let input = '';
      const onData = (chunk: Buffer) => {
        const str = chunk.toString();
        for (const char of str) {
          if (char === '\n' || char === '\r') {
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode?.(false);
            resolve(input);
            return;
          } else if (char === '\x03') {
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode?.(false);
            resolve(null);
            return;
          } else if (char === '\x7f' || char === '\b') {
            if (input.length > 0) {
              input = input.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else if (char >= ' ') {
            input += char;
            process.stdout.write(char);
          }
        }
      };

      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    });
  };

  while (true) {
    const input = await promptUser();

    if (input === null) {
      console.log(pc.dim('\nGoodbye!'));
      break;
    }

    console.log();
    const trimmed = input.trim();

    if (!trimmed) continue;

    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log(pc.dim('Goodbye!'));
      break;
    }

    if (trimmed.toLowerCase() === 'clear') {
      messages.length = 0;
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
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
              return confirmToolExecution(String(args.command || ''));
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

  await loadEnvFile();

  const hasPrompt = args.prompt.length > 0;
  const { mode, isOutputPiped } = detectMode(hasPrompt);

  const provider = getProvider({ model: args.model });
  const streamOptions: StreamOptions = {};

  if (args.systemPrompt) {
    streamOptions.systemPrompt = args.systemPrompt;
  }
  if (args.model && !args.model.includes(':')) {
    streamOptions.model = args.model;
  }

  if (mode === 'repl') {
    await runRepl(provider, streamOptions, args.verbosity);
    return;
  }

  let prompt = args.prompt.join(' ');

  if (mode === 'pipe') {
    const stdinContent = await readStdin();
    if (stdinContent) {
      if (prompt) {
        prompt = `${stdinContent}\n\n${prompt}`;
      } else {
        prompt = stdinContent;
      }
    }
  }

  if (!prompt.trim()) {
    console.error(pc.red('Error: No prompt provided'));
    process.exit(1);
  }

  try {
    await runSingleShot(provider, prompt, streamOptions, mode, isOutputPiped, args.verbosity);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`Error: ${message}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(pc.red(`Fatal error: ${error.message}`));
  process.exit(1);
});
