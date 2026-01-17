# AI CLI

<p align="center">
  <img src="assets/robot-wave.png" alt="AI CLI Robot" width="256">
</p>

**An AI that can actually do things.**

Talk to your computer in plain English. Ask questions, run commands, manage files, explore codebases—locally or across your entire infrastructure.

```bash
# On your local machine
ai "what's eating up my disk space?"
ai "find all the large video files I haven't watched"
ai "why is my system running slow?"

# In your codebase
ai "explain how the auth system works in this project"
ai "find and fix the bug in src/parser.ts"
ai "review this PR for security issues" < diff.patch

# Across your infrastructure (home lab, servers, cloud)
ai "@raspberry-pi what's the CPU temperature?"
ai "check disk space on all my servers"
ai "deploy the latest version to @production"
```

## Quick Start

```bash
# Install (Linux/macOS)
curl -fsSL https://raw.githubusercontent.com/Foundation42/ai/main/install.sh | bash

# Run - it will guide you through setup!
ai
```

Windows users: download `ai-windows-x64.exe` from [releases](https://github.com/Foundation42/ai/releases).

## How It's Different

**Not another coding assistant.** Tools like Claude Code, GitHub Copilot, Cursor, and Codex are designed for software development—writing code, completing functions, explaining syntax.

AI CLI is designed for **operations**:

| Coding Assistants | AI CLI |
|-------------------|--------|
| Write code for you | Run commands for you |
| Work in your IDE | Work in your terminal |
| Understand code | Understand systems |
| Help you develop | Help you operate |
| Single machine | Entire fleet |

**Not another pipe-to-LLM tool.** Tools like [llm](https://github.com/simonw/llm), [mods](https://github.com/charmbracelet/mods), and `gh copilot` are excellent for piping content through language models:

```bash
# llm - pipe content for transformation
cat README.md | llm "convert this to a man page"

# mods - Unix-y pipeline integration
ls -lh | mods "which file is largest?"

# gh copilot - command discovery
gh copilot suggest "find large files"
```

These tools **process text you give them**. AI CLI **takes action on your system**:

| Pipe-to-LLM Tools | AI CLI |
|-------------------|--------|
| You find the data | It finds the data |
| You run the commands | It runs the commands |
| Transform text | Accomplish tasks |
| Single interaction | Multi-step reasoning |
| Your machine only | Entire fleet |

```bash
# With pipe tools, YOU do the work:
find . -name "*.log" | llm "summarize errors"

# With AI CLI, IT does the work:
ai "find all log files and summarize any errors"
```

**Key differences from everything else:**

- **Runs on servers, not just your laptop** — Deploy to your infrastructure and query machines remotely with `@mentions`
- **Fleet orchestration** — Manage dozens of machines with natural language: `"check disk space on all web servers"`
- **Self-managing nodes** — Fleet nodes auto-upgrade themselves from GitHub releases
- **Production-ready security** — mTLS authentication, token auth, confirmation prompts for dangerous commands
- **Agentic execution** — Multi-step reasoning: finds files, reads them, runs commands, iterates until done

Think of it this way: pipe tools help you *transform* text. Coding assistants help you *build* software. AI CLI helps you *run* it.

## What It Is

AI CLI is a command-line tool that connects large language models (LLMs) to your system. It's not just a chatbot—it can **execute commands**, **read and edit files**, **explore codebases**, and optionally **manage remote machines**.

Use it on your laptop to get things done faster. Deploy it to your Raspberry Pi, home server, or cloud infrastructure to build a network of AI-powered nodes you can query from anywhere.

## What It Does

| Capability | Description |
|------------|-------------|
| **Execute** | Run bash commands, read/write files, explore systems |
| **Reason** | Analyze logs, diagnose issues, suggest fixes |
| **Orchestrate** | Query and manage fleets of servers with @ mentions |
| **Self-Manage** | Fleet nodes auto-upgrade from GitHub releases |
| **Secure** | mTLS authentication, token-based auth, confirmation prompts |

## Why You Need It

**The Problem:** You know what you want to do, but not always the exact command. Finding files, parsing logs, remembering flags, writing one-off scripts—it all takes time.

**The Solution:** Just describe what you want. The AI figures out how to do it.

```bash
# Instead of: find . -name "*.ts" -exec grep -l "TODO" {} \; | xargs wc -l | ...
ai "find all TODO comments in this project and count them by file"

# Instead of: du -ah ~ | sort -rh | head -20 | ...
ai "what's taking up space in my home directory?"

# Instead of: reading man pages and Stack Overflow
ai "compress all PNGs in this folder to reduce file size"

# Instead of: writing a bash script
ai "rename all these files to lowercase with dashes instead of spaces"
```

**Scales from laptop to data center:**

```bash
# Just your machine
ai "why is my fan running so loud?"

# Your home network
ai "@nas how much storage is left?"
ai "@pi check if the garage door sensor is working"

# Production infrastructure
ai "which servers are running low on disk space?"
ai "verify nginx is running on all web servers, restart any that are down"
```

## What It Enables

- **Conversational Infrastructure** — Query your entire fleet like a database
- **Autonomous Operations** — Fleet nodes that monitor, report, and fix themselves
- **Secure Delegation** — Give AI access to servers without sharing SSH keys
- **Tribal Knowledge Capture** — Encode your expertise in system prompts
- **Hierarchical Fleets** — Nodes can query other nodes, building intelligent meshes

## Zero to Hero

```bash
# 1. Install
curl -sL https://github.com/Foundation42/ai/releases/latest/download/ai-linux-x64 \
  -o /usr/local/bin/ai && chmod +x /usr/local/bin/ai

# 2. Configure (add your API key)
ai --config-init
nano ~/.config/ai/config.json

# 3. Use locally
ai "what's using the most disk space?"

# 4. Deploy to servers (see Fleet Tutorial below)
# 5. Query your entire infrastructure in plain English
ai "check the health of all production servers"
```

## Features

- **Multiple Providers** — Google Gemini, Anthropic Claude, OpenAI, Mistral, DeepSeek, Ollama
- **Three Modes** — Pipe, Standalone, and Interactive REPL
- **Tool Execution** — AI can run bash commands, read/edit files, explore directories
- **MCP Support** — Connect to local or remote MCP servers for extended capabilities
- **Fleet Orchestration** — Query and manage remote servers with @ mentions
- **Mesh Networking** — Fleet nodes can query each other directly
- **Scheduled Tasks** — Cron-like jobs with load-based handoff to peers
- **Auto-Upgrade** — Fleet nodes upgrade themselves from GitHub releases
- **mTLS Security** — Mutual TLS authentication for fleet communication
- **Map/Reduce** — Batch process multiple inputs with optional aggregation
- **Glob Patterns** — Process files matching patterns like `src/**/*.ts`
- **Markdown Rendering** — Styled terminal output with syntax highlighting
- **systemd Integration** — Production-ready with automatic restarts

## Installation

**Quick install (Linux/macOS):**

```bash
curl -fsSL https://raw.githubusercontent.com/Foundation42/ai/main/install.sh | bash
```

Then just run `ai` — it will guide you through setup on first run!

**Windows:**

Download `ai-windows-x64.exe` from [releases](https://github.com/Foundation42/ai/releases), rename to `ai.exe`, and add to your PATH.

**Manual install:**

```bash
# Download binary (replace with your platform)
# Options: ai-linux-x64, ai-linux-arm64, ai-macos-x64, ai-macos-arm64
curl -sL https://github.com/Foundation42/ai/releases/latest/download/ai-linux-x64 \
  -o ~/.local/bin/ai && chmod +x ~/.local/bin/ai

# Or build from source (requires Bun)
git clone https://github.com/Foundation42/ai.git
cd ai
bun install
bun run build
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

### Tool Output Verbosity

Control how much detail you see when the AI uses tools:

```bash
# Normal mode (default) - shows tool names as they execute
ai "what's in this directory?"

# Verbose mode - shows full tool output (useful for debugging)
ai -v "check disk space"

# Quiet mode - hides tool calls entirely, shows only final response
ai -q "summarize the system status"

# Auto-confirm mode - skip confirmation prompts for dangerous commands
ai -y "restart the nginx service"
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

### Local System Management

Use AI to explore, monitor, and manage your local machine:

```bash
# System exploration
ai "what's using the most disk space on this machine?"
ai "show me the largest files in my home directory"
ai "what services are currently running?"
ai "which processes are using the most memory?"

# Monitoring and troubleshooting
ai "is my system healthy? check CPU, memory, and disk"
ai "why is my computer running slow right now?"
ai "check if any disks are failing or have errors"
ai "what happened in the system logs in the last hour?"

# Finding things
ai "find all PDF files I modified this week"
ai "where is the nginx config file on this system?"
ai "find TODO comments in this project"

# System administration
ai "add a new user called 'deploy' with sudo access"
ai "set up a cron job to backup /data every night at 2am"
ai "configure the firewall to allow port 443"
ai "why won't my SSH connection to server1 work?"
```

### Working with Codebases

AI CLI understands code and can help with development tasks:

```bash
# Understanding code
ai "explain what src/server.ts does"
ai "how does authentication work in this codebase?"
ai "find where errors are handled in this project"
ai "what dependencies does this project have?"

# Code review
ai "review src/index.ts for bugs and security issues"
ai "check this PR diff for problems" < pr.diff
ai "are there any memory leaks in src/cache.ts?"

# Refactoring
ai "suggest how to simplify the handleRequest function in src/server.ts"
ai "find duplicate code in the src/ directory"
ai "this function is too long, help me break it up" < src/bigfunction.ts

# Documentation
ai "write JSDoc comments for the functions in src/utils.ts"
ai "generate a README for this project based on the code"
ai "explain this regex and add a comment" < src/parser.ts

# Debugging
ai "this test is failing, help me understand why" < test-output.txt
ai "what's causing this stack trace?" < error.log
ai "find where this variable gets mutated"
```

### Map/Reduce Processing

Process multiple items and optionally combine the results:

**Map Mode** — Process each input separately:

```bash
# Process each line from stdin
cat urls.txt | ai --map "check if this URL is accessible"

# Process files matching a pattern (--glob implies --map)
ai -g "src/**/*.ts" "list all exported functions in this file"
ai -g "*.md" "summarize this document in one sentence"
ai -g "test/*.test.ts" "does this test file have good coverage?"
```

**Reduce Mode** — Combine map results into a final output:

```bash
# Analyze all files, then create a summary
ai -g "src/*.ts" "describe this file briefly" \
   --reduce "create a table of all files and their purposes"

# Find issues across files, then prioritize them
ai -g "src/**/*.ts" "list any code smells or bugs" \
   --reduce "rank these issues by severity and suggest which to fix first"

# Gather metrics, then report
ai -g "src/**/*.ts" "count lines of code and functions" \
   --reduce "create a project statistics summary"
```

**Real-World Map/Reduce Examples:**

```bash
# Security audit across all config files
ai -g "/etc/**/*.conf" "check for security issues" -y \
   --reduce "create a security report with recommendations"

# API documentation from source code
ai -g "src/routes/*.ts" "extract API endpoints and their parameters" \
   --reduce "generate OpenAPI documentation"

# Dependency analysis
ai -g "**/package.json" "list all dependencies" \
   --reduce "find duplicate or conflicting versions"

# Log analysis across multiple files
ai -g "/var/log/*.log" "find errors and warnings from today" -y \
   --reduce "correlate these events and identify root causes"

# Codebase migration planning
ai -g "src/**/*.js" "identify ES5 patterns that should be modernized" \
   --reduce "create a migration plan prioritized by impact"
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

Create `~/.config/ai/config.json` (or run `ai --config-init` to generate a template):

```json
{
  "providers": {
    "default": "google",
    "google": { "apiKey": "your-google-api-key" },
    "anthropic": { "apiKey": "your-anthropic-api-key" },
    "openai": { "apiKey": "your-openai-api-key" },
    "mistral": { "apiKey": "your-mistral-api-key" },
    "deepseek": { "apiKey": "your-deepseek-api-key" },
    "ollama": { "baseUrl": "http://localhost:11434" }
  },
  "server": {
    "port": 9443,
    "token": "your-server-token",
    "autoConfirm": true,
    "autoUpgrade": {
      "enabled": true,
      "interval": 60000
    },
    "tls": {
      "cert": "~/.config/ai/certs/server.pem",
      "key": "~/.config/ai/certs/server-key.pem",
      "ca": "~/.config/ai/certs/ca.pem"
    }
  },
  "fleet": {
    "token": "your-fleet-token",
    "tls": {
      "ca": "~/.config/ai/certs/ca.pem",
      "clientCert": "~/.config/ai/certs/client.pem",
      "clientKey": "~/.config/ai/certs/client-key.pem"
    },
    "nodes": {
      "server1": {
        "url": "https://10.0.1.10:9443",
        "description": "Web server",
        "systemPrompt": "You are a web server administrator focused on nginx and application health."
      },
      "server2": {
        "url": "https://10.0.1.11:9443",
        "description": "Database server",
        "systemPrompt": "You are a PostgreSQL database administrator. Focus on query performance and data integrity."
      }
    }
  },
  "defaults": {
    "model": "google:gemini-2.0-flash",
    "verbosity": "normal",
    "autoConfirm": false,
    "systemPrompt": "You are a helpful DevOps assistant."
  }
}
```

### Configuration Options

| Section | Option | Description |
|---------|--------|-------------|
| `server.autoConfirm` | boolean | Auto-confirm dangerous commands (systemctl, sudo, etc.) |
| `server.autoUpgrade.enabled` | boolean | Enable automatic upgrade polling (default: false) |
| `server.autoUpgrade.interval` | number | Poll interval in milliseconds (default: 60000) |
| `server.tls.cert` | path | Server certificate for HTTPS |
| `server.tls.key` | path | Server private key |
| `server.tls.ca` | path | CA certificate for client verification (enables mTLS) |
| `fleet.tls.ca` | path | CA certificate for verifying server certs |
| `fleet.tls.clientCert` | path | Client certificate for mTLS authentication |
| `fleet.tls.clientKey` | path | Client private key for mTLS |
| `mcp.servers.<name>.command` | string | Command to run the MCP server |
| `mcp.servers.<name>.args` | array | Arguments to pass to the command |
| `mcp.servers.<name>.env` | object | Environment variables for the server |
| `mcp.servers.<name>.cwd` | string | Working directory for the server |

## MCP (Model Context Protocol)

AI CLI supports [MCP](https://modelcontextprotocol.io) servers, allowing you to extend the AI with additional tools from external sources—databases, APIs, custom integrations, and more.

### What is MCP?

MCP is a standard protocol that lets AI tools connect to external services. Think of it as "USB-C for AI"—a universal way to plug in capabilities. MCP servers can provide:

- Database access (SQLite, PostgreSQL, etc.)
- File system operations
- API integrations (GitHub, Slack, etc.)
- Custom tools for your specific workflows

### Adding MCP Servers Conversationally

The easiest way to add an MCP server is to just ask:

```bash
# Add a remote MCP server
ai "Connect to the MCP server at https://mcp.example.com/sse called myserver"

# Add a local MCP server
ai "Add an MCP server called sqlite using npx -y @modelcontextprotocol/server-sqlite ~/data.db"

# List your MCP servers
ai "What MCP servers do I have?"

# Remove an MCP server
ai "Remove the myserver MCP server"
```

### MCP Management Tools

| Tool | Description |
|------|-------------|
| `mcp_add` | Add a new MCP server (local command or remote URL) |
| `mcp_remove` | Remove an MCP server and unregister its tools |
| `mcp_update` | Update an existing MCP server configuration |
| `mcp_list` | List all configured MCP servers and their status |

### Configuring MCP Servers via Config File

You can also add MCP servers directly in your config file:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
        "description": "File system access via MCP"
      },
      "sqlite": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sqlite", "~/data.db"],
        "description": "SQLite database access"
      },
      "remote-api": {
        "url": "https://mcp.example.com/sse",
        "description": "Remote MCP server via HTTP/SSE"
      }
    }
  }
}
```

### Local vs Remote MCP Servers

AI CLI supports both local and remote MCP servers:

| Type | Config | Transport |
|------|--------|-----------|
| **Local** | `command` + `args` | stdio (stdin/stdout) |
| **Remote** | `url` | HTTP/SSE (Streamable HTTP) |

Remote servers are great for shared services, cloud-hosted tools, or connecting to MCP servers you don't want to run locally.

### Using MCP Tools

When MCP servers are configured, their tools are automatically loaded at startup. MCP tools appear with the prefix `mcp_<server>_<tool>`:

```bash
ai "list my recent GitHub issues"
# Uses mcp_github_list_issues automatically

ai "query the users table"
# Uses mcp_sqlite_query automatically
```

### Popular MCP Servers

| Server | Package | Description |
|--------|---------|-------------|
| Filesystem | `@modelcontextprotocol/server-filesystem` | Read/write files |
| SQLite | `@modelcontextprotocol/server-sqlite` | Query SQLite databases |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Query PostgreSQL |
| GitHub | `@modelcontextprotocol/server-github` | GitHub API |
| Slack | `@modelcontextprotocol/server-slack` | Slack integration |
| Memory | `@modelcontextprotocol/server-memory` | Persistent memory |

Find more at [github.com/modelcontextprotocol](https://github.com/modelcontextprotocol).

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

Server Mode:
  --server                      Start as HTTP server
  -p, --port <port>             Server port (default: 8080)
  --token <token>               Bearer token for authentication
  --cert <path>                 Server certificate file (enables HTTPS)
  --key <path>                  Server private key file
  --ca <path>                   CA certificate for client verification (enables mTLS)

Configuration:
  --config-init                 Create template config file
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
| `web_fetch` | Fetch content from URLs (web pages, APIs, files) |
| `version` | Get version and system info |

Dangerous commands require confirmation unless `-y` is used.

## Architecture

```
src/
├── index.ts          # Main entry, mode detection, REPL
├── config.ts         # CLI parsing, JSON config loading
├── fleet.ts          # Fleet orchestration, @ mentions
├── server.ts         # HTTP server mode (with TLS/mTLS)
├── upgrade.ts        # Auto-upgrade from GitHub releases
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
│   ├── index.ts       # Tool registry
│   ├── types.ts       # Tool interface
│   ├── bash.ts        # Shell execution
│   ├── read_file.ts   # File reading
│   ├── list_files.ts  # Directory listing
│   ├── edit_file.ts   # File editing
│   ├── web_fetch.ts   # URL fetching
│   ├── fleet.ts       # Fleet query/upgrade/restart tools
│   ├── mcp_manage.ts  # MCP add/remove/update/list
│   └── version.ts     # Version and system info
├── mcp/
│   ├── index.ts          # MCP module exports
│   ├── types.ts          # MCP protocol types
│   ├── transport.ts      # stdio transport (local servers)
│   ├── http-transport.ts # HTTP/SSE transport (remote servers)
│   ├── client.ts         # MCP client & manager
│   └── tools.ts          # MCP tool wrappers
└── utils/
    ├── stream.ts     # Streaming, thinking filter
    └── markdown.ts   # Terminal markdown rendering
```

## Fleet Orchestration

Query remote AI nodes using @ mentions (configure nodes in `~/.config/ai/config.json`):

```bash
# Query specific nodes with @ mentions
ai "@server1 what's your disk usage?"
ai "@server2 check if nginx is running"

# Query all nodes
ai "@all report your memory usage"

# Let AI figure it out
ai "Which server has the highest load?"
```

### Fleet Tools

| Tool | Description |
|------|-------------|
| `fleet_list` | List all fleet nodes and health status |
| `fleet_query` | Query a specific node |
| `fleet_broadcast` | Send prompt to all nodes |
| `fleet_upgrade` | Check for and perform upgrades on fleet nodes |
| `fleet_restart` | Restart fleet nodes to apply config changes |

### Fleet Tutorial

A step-by-step guide to setting up and using the AI fleet.

#### Step 1: Deploy Fleet Nodes

On each server you want to manage, download and install the AI binary:

```bash
# Download latest release
curl -sL https://github.com/Foundation42/ai/releases/latest/download/ai-linux-x64 \
  -o /usr/local/bin/ai
chmod +x /usr/local/bin/ai

# Verify installation
ai --version
```

#### Step 2: Configure Fleet Nodes

Create a config file on each node with an API key and server settings:

```bash
mkdir -p ~/.config/ai
cat > ~/.config/ai/config.json << 'EOF'
{
  "server": {
    "port": 9090,
    "autoConfirm": true
  },
  "providers": {
    "default": "google",
    "google": { "apiKey": "your-api-key" }
  }
}
EOF
```

#### Step 3: Start Fleet Nodes

Start the AI server (with systemd for production):

```bash
# Quick start (for testing)
AI_SERVER_TOKEN=your-fleet-token ai --server --port 9090

# Production: create systemd service (see systemd section below)
```

#### Step 4: Configure Your Controller

On your local machine, configure the fleet nodes:

```bash
cat > ~/.config/ai/config.json << 'EOF'
{
  "providers": {
    "default": "google",
    "google": { "apiKey": "your-api-key" }
  },
  "fleet": {
    "token": "your-fleet-token",
    "nodes": {
      "web1": {
        "url": "http://10.0.1.10:9090",
        "description": "Web server 1"
      },
      "web2": {
        "url": "http://10.0.1.11:9090",
        "description": "Web server 2"
      },
      "db1": {
        "url": "http://10.0.1.20:9090",
        "description": "Database server"
      }
    }
  },
  "defaults": {
    "model": "google:gemini-2.0-flash"
  }
}
EOF
```

#### Step 5: Verify Fleet Health

```bash
# Check all nodes are online
ai "list all fleet nodes and their status"

# Expected output:
# Fleet nodes:
#   web1: healthy (web1.example.com)
#   web2: healthy (web2.example.com)
#   db1: healthy (db1.example.com)
```

#### Step 6: Basic Fleet Operations

```bash
# Query a single node
ai "@web1 what's your current memory usage?"

# Query all nodes
ai "@all report disk space usage"

# Let AI pick the right node
ai "check the database server's replication status"

# Run a command across all nodes
ai "check uptime on all servers"
```

#### Step 7: Real-World Examples

```bash
# Monitor logs across fleet
ai "check for errors in /var/log/syslog on all servers in the last hour"

# Find resource hogs
ai "which server has the highest CPU usage right now?"

# Coordinate deployments
ai "@web1 pull the latest docker image for myapp"
ai "@web2 pull the latest docker image for myapp"
ai "verify myapp is running on all web servers"

# Security audit
ai "check for failed SSH login attempts on all servers"

# Install packages fleet-wide
ai "install htop on all servers using apt"

# Check service status
ai "is nginx running on all web servers? restart it if not"
```

#### Step 8: Fleet Upgrades

Keep your fleet up to date:

```bash
# Check for available upgrades
ai "check for upgrades on all fleet nodes"

# Upgrade all nodes
ai "upgrade all fleet nodes to the latest version"

# Verify versions
ai "what version is each fleet node running?"
```

#### Tips

- Use `server.autoConfirm: true` on fleet nodes to allow privileged commands
- Use systemd with `Restart=always` for production deployments
- Enable mTLS for secure communication (see mTLS section)
- Fleet nodes can query each other - build hierarchical architectures

### Mesh Networking

Fleet nodes can communicate directly with each other, enabling powerful distributed architectures where any node can query any other node.

#### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Controller                          │
│                   (your machine)                        │
│                                                         │
│  fleet.nodes: { node1, node2, node3 }                   │
└─────────────────┬───────────────────┬───────────────────┘
                  │                   │
         ┌────────▼────────┐  ┌───────▼────────┐
         │     Node 1      │◄─►     Node 2      │
         │                 │  │                 │
         │ fleet.nodes:    │  │ fleet.nodes:    │
         │  { node2 }      │  │  { node1 }      │
         └────────┬────────┘  └────────┬────────┘
                  │                    │
                  └──────────▼─────────┘
                       Both nodes can
                       query each other
```

#### Configuration

To enable mesh networking, configure each node to know about its peers:

**Node 1** (`~/.config/ai/config.json`):
```json
{
  "server": {
    "port": 9443,
    "autoConfirm": true,
    "tls": { "cert": "...", "key": "...", "ca": "..." }
  },
  "fleet": {
    "token": "shared-fleet-token",
    "tls": {
      "ca": "/path/to/ca.pem",
      "clientCert": "/path/to/client.pem",
      "clientKey": "/path/to/client-key.pem"
    },
    "nodes": {
      "node2": {
        "url": "https://node2-ip:9443",
        "description": "Peer node 2"
      }
    }
  }
}
```

**Node 2** (mirror configuration pointing to Node 1):
```json
{
  "fleet": {
    "nodes": {
      "node1": {
        "url": "https://node1-ip:9443",
        "description": "Peer node 1"
      }
    }
  }
}
```

#### Peer-to-Peer Queries

Once configured, nodes can query each other directly:

```bash
# From your controller, ask node1 to query node2
ai "@node1 ask node2 what its current load is"

# Node1 will use its fleet tools to query node2 directly
# Response: "I queried node2 - it reports 15% CPU, 2.1GB memory used"
```

#### Use Cases

**Load Distribution**: Nodes can ask peers for help when busy:
```bash
# A node under heavy load can delegate work
ai "@node1 if you're busy, ask node2 to handle disk analysis"
```

**Redundant Monitoring**: Nodes can cross-check each other:
```bash
ai "@node1 verify that node2 is healthy and responding"
```

**Distributed Tasks**: Coordinate complex operations:
```bash
ai "@node1 coordinate with node2 to analyze logs from both servers"
```

#### Security Notes

- All nodes should use mTLS with the same CA for secure peer communication
- Each node needs a copy of the client certificate and key for outbound connections
- Use unique server certificates per node, but shared client certificates are fine for mesh

## Server Mode

Run as an OpenAI-compatible API server with fleet management capabilities:

```bash
# Start server
ai --server

# With custom port and token
ai --server --port 8080 --token mysecret
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat API |
| `/v1/models` | GET | List available models |
| `/v1/fleet/execute` | POST | Execute prompt with tools |
| `/v1/fleet/health` | GET | Node health info (no auth) |
| `/v1/fleet/upgrade` | GET | Check for available upgrades |
| `/v1/fleet/upgrade` | POST | Perform upgrade and restart |
| `/v1/fleet/restart` | POST | Restart the server (for config changes) |
| `/v1/scheduler` | GET | View scheduled tasks status |

### Examples

```bash
# Chat completion (OpenAI-compatible)
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "google:gemini-2.0-flash", "messages": [{"role": "user", "content": "Hello"}]}'

# Fleet execute (runs tools on the server)
curl -X POST http://localhost:8080/v1/fleet/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is the disk usage on this machine?"}'

# Health check (no auth required)
curl http://localhost:8080/v1/fleet/health
```

## mTLS (Mutual TLS)

Secure fleet communication with mutual TLS authentication. Both the server and client verify each other's certificates.

### Generate Certificates

```bash
# Create CA
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -key ca-key.pem -out ca.pem -days 365 -subj "/CN=AI-Fleet-CA"

# Create server cert (for each node)
openssl genrsa -out server-key.pem 2048
openssl req -new -key server-key.pem -out server.csr -subj "/CN=server1"
echo "subjectAltName=IP:10.0.1.10,DNS:server1" > server-ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out server.pem -days 365 -extfile server-ext.cnf

# Create client cert (for the controller)
openssl genrsa -out client-key.pem 2048
openssl req -new -key client-key.pem -out client.csr -subj "/CN=ai-controller"
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out client.pem -days 365
```

### Start Server with mTLS

```bash
ai --server --port 9443 --cert server.pem --key server-key.pem --ca ca.pem
```

### Test Connection

```bash
# With client cert (works)
curl --cert client.pem --key client-key.pem --cacert ca.pem \
  https://10.0.1.10:9443/v1/fleet/health

# Without client cert (rejected)
curl --cacert ca.pem https://10.0.1.10:9443/v1/fleet/health
```

## Auto-Upgrade

Fleet nodes can upgrade themselves from GitHub releases—either on-demand or automatically via polling.

### On-Demand Upgrades

```bash
# Check for upgrades
ai "check for upgrades on all fleet nodes"

# Perform upgrade
ai "upgrade all fleet nodes"

# Or use the tool directly
ai "@server1 upgrade yourself"
```

### Automatic Upgrade Polling

Enable automatic upgrades so fleet nodes check for and install updates without intervention:

```json
{
  "server": {
    "autoUpgrade": {
      "enabled": true,
      "interval": 60000
    }
  }
}
```

When enabled, fleet nodes will:
- Check GitHub releases at the configured interval (default: every 60 seconds)
- Automatically download and install new versions
- Restart gracefully via systemd
- Persist upgrade state to `~/.config/ai/upgrade-state.json`

### Remote Restart

Apply configuration changes without SSH access:

```bash
# Restart a single node
ai "restart @server1"

# Restart all nodes
ai "restart all fleet nodes"
```

### How Upgrades Work

1. Downloads the new binary from GitHub releases
2. Verifies the SHA256 checksum
3. Backs up the current binary
4. Replaces with the new version
5. Restarts automatically (via systemd or restart script)

## Scheduled Tasks

Fleet nodes can run scheduled tasks—cron-like jobs that execute prompts at intervals. This enables automated monitoring, health checks, and load-based handoff between nodes.

### Configuration

```json
{
  "server": {
    "scheduler": {
      "enabled": true,
      "tasks": [
        {
          "name": "health-check",
          "schedule": "@every 5m",
          "prompt": "Check system health: disk space, memory, and load average"
        },
        {
          "name": "log-monitor",
          "schedule": "*/15 * * * *",
          "prompt": "Check /var/log/syslog for errors in the last 15 minutes"
        }
      ]
    }
  }
}
```

### Schedule Formats

| Format | Description | Example |
|--------|-------------|---------|
| `@every Nm` | Every N minutes | `@every 5m` |
| `@every Nh` | Every N hours | `@every 2h` |
| `@every Ns` | Every N seconds | `@every 30s` |
| `@hourly` | Every hour | `@hourly` |
| `@daily` | Every day | `@daily` |
| `*/N * * * *` | Cron: every N minutes | `*/5 * * * *` |

### Conditional Execution

Tasks can have conditions that must be met before running:

```json
{
  "name": "intensive-analysis",
  "schedule": "@every 10m",
  "prompt": "Run detailed performance analysis",
  "condition": {
    "maxLoad": 0.5
  }
}
```

Conditions:
- `maxLoad`: Only run if system load < threshold (0-1 scale)
- `minLoad`: Only run if system load > threshold (for triggered tasks)

### Load-Based Handoff

The killer feature: tasks can automatically delegate to peer nodes when the local system is busy:

```json
{
  "name": "load-handoff",
  "schedule": "@every 1m",
  "prompt": "Analyze system metrics",
  "condition": {
    "minLoad": 0.7
  },
  "handoff": {
    "enabled": true,
    "loadThreshold": 0.7,
    "prompt": "Hey, I'm getting quite busy over here - can you help with some analysis?"
  }
}
```

When load exceeds the threshold:
1. The node checks its configured peer nodes
2. Sends the handoff prompt to the first available peer
3. The peer executes the task instead

This enables collaborative load balancing across your fleet mesh.

### Task State

Task execution state is persisted to `~/.config/ai/scheduler-state.json`:

```json
{
  "tasks": {
    "health-check": {
      "lastRun": 1705520400000,
      "lastResult": "success",
      "lastResponse": "All systems healthy...",
      "runCount": 42,
      "errorCount": 0
    }
  }
}
```

### Monitoring Tasks

Check scheduler status via the API:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9090/v1/scheduler
```

Response:
```json
{
  "enabled": true,
  "tasks": [
    {
      "name": "health-check",
      "schedule": "@every 5m",
      "state": {
        "lastRun": 1705520400000,
        "lastResult": "success",
        "runCount": 42
      },
      "nextRun": 1705520700000
    }
  ]
}
```

## systemd Integration

For production deployments, run fleet nodes as systemd services:

```bash
# Create service file
cat > /etc/systemd/system/ai.service << EOF
[Unit]
Description=AI Fleet Node
After=network.target

[Service]
Type=simple
Environment=AI_SERVER_TOKEN=your-token
ExecStart=/usr/local/bin/ai --server --port 9443
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable ai
systemctl start ai
```

The AI automatically detects when running under systemd and exits cleanly after upgrades, letting systemd handle the restart.

## Contributing

Contributions are welcome! Here's how to get started:

```bash
# Clone the repo
git clone https://github.com/Foundation42/ai.git
cd ai

# Install dependencies (requires Bun)
bun install

# Run in development mode
bun run dev "hello world"

# Build the binary
bun run build
```

**Guidelines:**

- Open an issue first for major changes
- Follow the existing code style
- Test your changes locally before submitting
- Update documentation if adding new features

## License

MIT

---

<p align="center">
  <em>Built with</em><br>
  <a href="https://entrained.ai"><strong>Christian Beaumont</strong></a> ·
  <a href="https://anthropic.com"><strong>Claude</strong></a> ·
  <a href="https://google.com"><strong>Gemini</strong></a>
</p>
