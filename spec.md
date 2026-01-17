# Executive Brief: The "AI-CLI" Infrastructure Orchestrator

**Date:** January 17, 2026
**Subject:** Modernizing DevOps Workflows with Generative AI & Fleet Automation

### 1. Executive Summary

We are proposing the development of `ai`, a high-performance, lightweight command-line utility built on the **Bun** runtime. This tool integrates Large Language Models (LLMs) directly into our Linux shell environment, transforming the command line from a static interface into an intelligent "reasoning engine" for DevOps, fleet management, and remote infrastructure optimization.

### 2. The Opportunity: From Reactive to Predictive Ops

Current DevOps workflows rely on manual scripting and reactive troubleshooting. When a server fails or a build breaks, engineers must manually parse logs and diagnose root causes.
**The `ai` utility shifts this paradigm by enabling:**

* **Semantic Data Processing:** Using natural language to filter and analyze system logs (e.g., *"Find all errors in these logs that look like memory leaks and suggest a fix"*).
* **Autonomous Fleet Management:** Deploying "Agent Mode" across our server fleet to monitor health and perform self-healing tasks locally.
* **Rapid Scripting & Refactoring:** Reducing the time to write complex automation scripts from hours to seconds through interactive code generation.

### 3. Key Business Benefits

* **Efficiency & Speed:** Estimates from similar AI-DevOps integrations show a **35–50% reduction** in manual operational toil and incident response times.
* **Cost Optimization:** By using local models (via Ollama) alongside cloud providers, we can process massive amounts of infrastructure data without incurring the high token costs of pure cloud-AI solutions.
* **Reduced Human Error:** Standardizing infrastructure changes through AI-mediated "Map/Reduce" operations ensures consistency across hundreds of remote nodes.
* **Vendor Agility:** The tool is provider-agnostic, supporting OpenAI, Anthropic, Google Gemini, and local Ollama models, protecting us from vendor lock-in.

### 4. Technical Innovation: The Model Context Protocol (MCP)

The tool utilizes the new **Model Context Protocol (MCP)**. This acts as a "USB-C for AI," allowing the utility to securely connect to our internal databases, cloud APIs, and local filesystems. This gives the AI the "hands" it needs to actually perform DevOps tasks—like restarting services or updating configurations—rather than just talking about them.

### 5. Security & Governance

* **Human-in-the-Loop:** All destructive commands (e.g., server restarts or file deletions) require manual confirmation by default.
* **Privacy-First:** Sensitive data can be processed by local models (Ollama) within our own infrastructure, ensuring we meet strict data compliance standards.
* **Auditability:** Every interaction is logged to a local `.jsonl` history file, providing a full audit trail of AI-assisted actions taken on the fleet.

### 6. Recommendation

We recommend moving forward with a Phase 1 prototype of the `ai` utility. This will allow our engineering team to validate the tool-calling and fleet-management capabilities on a subset of our development environment before a wider rollout.

---

## Technical Specification: `ai` CLI Utility

### 1. Core Architecture

* **Runtime:** Bun (for  startup time and native TypeScript support).
* **Primary Language:** TypeScript.
* **Distribution:** Single-file standalone binary via `bun build --compile`.
* **Backend Support:** Pluggable provider pattern (OpenAI, Anthropic, Gemini, Ollama).

### 2. Operational Modes

The tool must detect its input state and switch between three modes:

| Mode | Trigger | Description |
| --- | --- | --- |
| **Pipe** | `stdin` is not a TTY | Reads `stdin`, appends to prompt, and streams output. |
| **Standalone** | Args provided + TTY | Single-shot execution of the provided prompt. |
| **REPL** | No args + TTY | Interactive chat session with persistent context. |
| **Server** | `--server` flag | Becomes an HTTP agent for remote DevOps/Fleet commands. |

---

### 3. Functional Requirements

#### A. Multi-Backend Provider Pattern

The utility must use a `Provider` interface to normalize requests across different APIs.

* **Environment Variables:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_HOST`. (Or from ~/.aiconfig file)
* **Selection:** Default to Ollama if no keys are found; allow override via `--model` or `-m`.

#### B. Map/Reduce Logic

* **Map (`--map`):** Split `stdin` by line. For each line, send a prompt and output the result sequentially.
* *Example:* `ls | ai --map "Is this a directory or a file?"`


* **Reduce (`--reduce`):** Buffer all `stdin` until EOF, then send the entire block with the prompt to summarize/collapse.

#### C. History & Context

* **Storage:** `~/.ai_history.jsonl`.
* **Schema:** `{ timestamp, mode, provider, model, prompt, response, context_tokens }`.
* **Persistence:** In REPL mode, send the `context` array (Ollama) or message history (APIs) back to the provider to maintain conversation state.

#### D. Agentic Capabilities (DevOps Focus)

* **MCP Support:** Ability to connect to local MCP servers (stdio-based).
* **Remote Execution:** Secure `Bun.serve` endpoint that accepts prompts and returns terminal output from the host machine.
* **Security:** Implement a "Protected Mode" where any tool call involving `rm`, `sudo`, or `systemctl` requires a local `(y/n)` confirmation unless a `--force` flag is used.

---

### 4. Implementation Details (The "Bun" Way)

* **Streaming:** Use `ReadableStream` and `TextDecoder` to ensure real-time character output.
* **CLI UX:** * Use `picocolors` for prompt styling.
* Use `ora` or simple ANSI escapes for "Thinking..." indicators during long API waits.


* **Config:** Store default model preferences and system prompts in `~/.config/ai/config.json`.

---

### 5. Next Steps for Development

1. **Phase 1:** Core "Pipe/Standalone" logic with Ollama and OpenAI providers.
2. **Phase 2:** REPL mode with `.jsonl` history logging.
3. **Phase 3:** Map/Reduce flags for batch processing.
4. **Phase 4:** MCP client integration and `--server` mode for fleet management.


Christian Beaumont / January 17th 2026 / Entrained AI Instritute