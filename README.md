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
| `server.tls.cert` | path | Server certificate for HTTPS |
| `server.tls.key` | path | Server private key |
| `server.tls.ca` | path | CA certificate for client verification (enables mTLS) |
| `fleet.tls.ca` | path | CA certificate for verifying server certs |
| `fleet.tls.clientCert` | path | Client certificate for mTLS authentication |
| `fleet.tls.clientKey` | path | Client private key for mTLS |

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
│   ├── index.ts      # Tool registry
│   ├── types.ts      # Tool interface
│   ├── bash.ts       # Shell execution
│   ├── read_file.ts  # File reading
│   ├── list_files.ts # Directory listing
│   ├── edit_file.ts  # File editing
│   ├── fleet.ts      # Fleet query/upgrade tools
│   └── version.ts    # Version and system info
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

Fleet nodes can upgrade themselves from GitHub releases:

```bash
# Check for upgrades
ai "check for upgrades on all fleet nodes"

# Perform upgrade
ai "upgrade all fleet nodes"

# Or use the tool directly
ai "@server1 upgrade yourself"
```

When a node upgrades:
1. Downloads the new binary from GitHub releases
2. Verifies the SHA256 checksum
3. Replaces the current binary
4. Restarts automatically (via systemd or restart script)

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

## License

MIT
