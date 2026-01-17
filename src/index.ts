#!/usr/bin/env bun
import ora from 'ora';
import pc from 'picocolors';
import { parseArgs, printHelp, loadEnvFile } from './config';
import { getProvider, type StreamOptions } from './providers';
import { readStdin, filterThinking } from './utils/stream';

const VERSION = '0.1.0';

function detectMode(): { isPiped: boolean; isOutputPiped: boolean } {
  // Check if stdin is a TTY (interactive terminal) or piped
  const isPiped = !process.stdin.isTTY;
  const isOutputPiped = !process.stdout.isTTY;
  return { isPiped, isOutputPiped };
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

  const { isPiped, isOutputPiped } = detectMode();
  const hasPrompt = args.prompt.length > 0;

  if (!isPiped && !hasPrompt) {
    // No input provided - show help
    printHelp();
    process.exit(1);
  }

  // Build the prompt
  let prompt = args.prompt.join(' ');

  if (isPiped) {
    const stdinContent = await readStdin();
    if (stdinContent) {
      if (prompt) {
        // Combine stdin with prompt
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

  // Load config from ~/.aiconfig
  await loadEnvFile();

  try {
    const provider = getProvider({ model: args.model });

    const streamOptions: StreamOptions = {};
    if (args.systemPrompt) {
      streamOptions.systemPrompt = args.systemPrompt;
    }
    if (args.model && !args.model.includes(':')) {
      streamOptions.model = args.model;
    }

    // Show spinner only when output is a TTY (not piped)
    let spinner: ReturnType<typeof ora> | null = null;
    if (!isOutputPiped) {
      spinner = ora({
        text: pc.dim(`Thinking... (${provider.name})`),
        spinner: 'dots',
      }).start();
    }

    const rawStream = provider.stream(prompt, streamOptions);
    const stream = filterThinking(rawStream);
    let firstChunk = true;

    for await (const chunk of stream) {
      if (firstChunk && spinner) {
        spinner.stop();
        firstChunk = false;
      }
      process.stdout.write(chunk);
    }

    // Ensure we end with a newline
    process.stdout.write('\n');
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
