#!/usr/bin/env bun
import ora from 'ora';
import pc from 'picocolors';
import * as readline from 'readline';
import { parseArgs, printHelp, loadEnvFile } from './config';
import { getProvider, type StreamOptions, type Message, type Provider } from './providers';
import { readStdin, filterThinking } from './utils/stream';
import { appendHistory, type HistoryEntry } from './history';

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

async function streamResponse(
  provider: Provider,
  prompt: string,
  options: StreamOptions,
  showSpinner: boolean
): Promise<string> {
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
  let fullResponse = '';

  for await (const chunk of stream) {
    if (firstChunk && spinner) {
      spinner.stop();
      firstChunk = false;
    }
    process.stdout.write(chunk);
    fullResponse += chunk;
  }

  // If spinner never stopped (empty response), stop it now
  if (spinner && firstChunk) {
    spinner.stop();
  }

  process.stdout.write('\n');
  return fullResponse;
}

async function runSingleShot(
  provider: Provider,
  prompt: string,
  options: StreamOptions,
  mode: Mode,
  isOutputPiped: boolean
): Promise<void> {
  const response = await streamResponse(provider, prompt, options, !isOutputPiped);

  // Log to history
  await appendHistory({
    timestamp: new Date().toISOString(),
    mode,
    provider: provider.name,
    model: options.model || provider.defaultModel,
    prompt,
    response,
  });
}

async function runRepl(provider: Provider, options: StreamOptions): Promise<void> {
  const messages: Message[] = [];

  // Add system prompt if provided
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(pc.cyan(`AI REPL (${provider.name}:${options.model || provider.defaultModel})`));
  console.log(pc.dim('Type "exit" or Ctrl+C to quit, "clear" to reset context\n'));

  const prompt = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(pc.green('> '), (answer) => {
        resolve(answer);
      });
    });
  };

  try {
    while (true) {
      const input = await prompt();
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

      // Add user message
      messages.push({ role: 'user', content: trimmed });

      try {
        const response = await streamResponse(
          provider,
          trimmed,
          { ...options, messages },
          true
        );

        // Add assistant response to history
        messages.push({ role: 'assistant', content: response });

        // Log to history file
        await appendHistory({
          timestamp: new Date().toISOString(),
          mode: 'repl',
          provider: provider.name,
          model: options.model || provider.defaultModel,
          prompt: trimmed,
          response,
          context_tokens: messages.length,
        });

        console.log(); // Extra newline for readability
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(pc.red(`Error: ${message}\n`));
        // Remove the failed user message
        messages.pop();
      }
    }
  } finally {
    rl.close();
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

  // Load config from ~/.aiconfig
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
    await runRepl(provider, streamOptions);
    return;
  }

  // Build the prompt for pipe/standalone modes
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
    await runSingleShot(provider, prompt, streamOptions, mode, isOutputPiped);
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
