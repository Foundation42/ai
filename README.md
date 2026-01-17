# AI CLI

A reasoning engine for DevOps.

A powerful command-line interface for interacting with LLMs. Built with Bun, featuring multi-provider support, tool execution, and batch processing.

## Features

- **Multiple Providers** - Google Gemini, Anthropic Claude, OpenAI, Mistral, DeepSeek, Ollama
- **Three Modes** - Pipe, Standalone, and Interactive REPL
- **Tool Execution** - AI can run bash commands, read/edit files, explore directories
- **Map/Reduce** - Batch process multiple inputs with optional aggregation
- **Glob Patterns** - Process files matching patterns like `src/**/*.ts`
- **Markdown Rendering** - Styled terminal output with syntax highlighting
- **Configurable** - Provider priority, API keys, verbosity levels

## Installation

```bash
# Clone and build
git clone https://github.com/Foundation42/ai.git
cd ai
bun install
bun run build

# Add to PATH
ln -s $(pwd)/ai ~/.bun/bin/ai
```

## Usage

### Basic Queries

```bash
# Simple question
ai "What is the capital of France?"

# With specific model
ai -m openai:gpt-4o "Explain quantum computing"

# With system prompt
ai -s "You are a pirate" "Hello there!"
```

### Pipe Mode

```bash
# Summarize a file
cat README.md | ai "Summarize this"

# Explain error logs
tail -100 error.log | ai "What's wrong?"

# Code review
cat src/index.ts | ai "Review this code"
```

### Interactive REPL

```bash
ai
# Enters REPL mode with conversation history
# Type 'exit' or Ctrl+C to quit
# Type 'clear' to reset context
```

### Tool Execution

The AI can use tools to interact with your system:

```bash
# Check disk space (AI runs 'df -h')
ai "What's my free disk space?" -y

# Read and review a file
ai "Review src/index.ts for bugs" -y

# Edit a file (requires confirmation)
ai "Fix the typo in README.md"
```

### Batch Processing

```bash
# Map: Process each file separately
ls src/*.ts | ai --map "Describe this file" -y

# Glob: Same but with pattern
ai -g "src/**/*.ts" "Review this file" -y

# Reduce: Combine results
ai -g "src/*.ts" "List exports" --reduce "Create a summary table" -y
```

### DevOps Examples

```bash
# Semantic log analysis
tail -1000 /var/log/syslog | ai "Find errors that look like memory leaks and suggest fixes"

# Fleet health check
for host in web{1..3}; do ssh $host "uptime && free -m"; done | ai "Summarize health status"

# Config drift detection
ai -g "/etc/nginx/sites-enabled/*" "Check for security misconfigurations" -y
```

## Configuration

Create `~/.aiconfig`:

```bash
# API Keys
GOOGLE_API_KEY=your-key
ANTHROPIC_API_KEY=your-key
OPENAI_API_KEY=your-key
MISTRAL_API_KEY=your-key
DEEPSEEK_API_KEY=your-key

# Provider priority (optional)
AI_PROVIDER_ORDER=google,anthropic,openai,mistral,deepseek,ollama
```

## CLI Options

```
Options:
  -m, --model <provider:model>  Specify provider and model
  -s, --system <prompt>         Set system prompt
  -v, --verbose                 Show tool call outputs
  -q, --quiet                   Hide tool calls entirely
  -y, --yes                     Auto-confirm tool executions
  --map                         Process each stdin line separately
  --reduce <prompt>             Combine map results with a final prompt
  -g, --glob <pattern>          Expand glob and process each file
  -h, --help                    Show help message
  -V, --version                 Show version
```

## Providers

| Provider | Default Model | Tools | API Key |
|----------|---------------|-------|---------|
| Google | gemini-2.0-flash | Yes | GOOGLE_API_KEY |
| Anthropic | claude-sonnet-4-20250514 | Yes | ANTHROPIC_API_KEY |
| OpenAI | gpt-4o-mini | Yes | OPENAI_API_KEY |
| Mistral | mistral-small-latest | Yes | MISTRAL_API_KEY |
| DeepSeek | deepseek-chat | Yes | DEEPSEEK_API_KEY |
| Ollama | gemma3:4b | Yes* | (local) |

\* Ollama tool support depends on the model (llama3.1+, mistral, qwen2.5, etc.)

## Tools

When using a provider with tool support (all providers), the AI can:

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands (with safety checks) |
| `read_file` | Read file contents |
| `list_files` | List directory contents |
| `edit_file` | Make targeted string replacements |

Dangerous commands require confirmation unless `-y` is used.

## Architecture

```
src/
├── index.ts          # Main entry, mode detection, REPL
├── config.ts         # CLI parsing, ~/.aiconfig loading
├── history.ts        # JSONL history logging
├── providers/
│   ├── index.ts      # Provider factory, auto-detection
│   ├── types.ts      # Provider interface
│   ├── google.ts     # Gemini (with tools)
│   ├── anthropic.ts  # Claude
│   ├── openai.ts     # GPT
│   ├── mistral.ts    # Mistral
│   ├── deepseek.ts   # DeepSeek
│   └── ollama.ts     # Local Ollama
├── tools/
│   ├── index.ts      # Tool registry
│   ├── types.ts      # Tool interface
│   ├── bash.ts       # Shell execution
│   ├── read_file.ts  # File reading
│   ├── list_files.ts # Directory listing
│   └── edit_file.ts  # File editing
└── utils/
    ├── stream.ts     # Streaming, thinking filter
    └── markdown.ts   # Terminal markdown rendering
```

## License

MIT
