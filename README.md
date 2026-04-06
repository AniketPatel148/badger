<p align="center">
  <img src="assets/badger-logo.png" alt="Badger Logo" width="200" />
</p>

<h1 align="center">Badger</h1>

<p align="center">
  <strong>AI agents that won't break your code.</strong>
</p>

<p align="center">
  <a href="#how-it-works">How It Works</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#safety-layer">Safety</a> •
  <a href="#status">Status</a>
</p>

---

Badger is a **safety-first agentic coding system**. It wraps AI coding agents in a protective layer of checkpoints, verification, and automatic rollback — so your codebase stays intact even when an agent makes a mistake.

Every file modification is **checkpointed before it happens**, **verified after it lands**, and **auto-reverted if anything breaks**. No exceptions. No "the change is too small."

## How It Works

```
You: $badger "Add user authentication with JWT"

Badger:
  1. GUARDRAIL CHECK  → Is the target file protected?
  2. BLAST RADIUS     → How many files depend on it?
  3. CHECKPOINT       → Snapshot the repo state
  4. EXECUTE          → Make the change
  5. VERIFY           → Build · Test · Lint · Typecheck
  6. RESULT           → Pass? Commit. Fail? Rollback.
```

If verification fails, Badger **never tries to "fix forward."** It rolls back to the last known-good state, logs what went wrong, and tells you exactly what happened.

## Quick Start

```bash
# Clone
git clone https://github.com/AniketPatel148/badger.git
cd badger

# Install dependencies
bun install

# Run
bun run dev
```

### Commands

| Command | Description |
|---------|-------------|
| `$badger "<task>"` | Start a safety-first agentic coding task |
| `$badger-status` | View checkpoints, rollback history, and safety state |
| `$badger-rollback` | Manually rollback to any checkpoint |

## Architecture

Badger uses a **3-tier prompt architecture** with strict role separation:

```
┌─────────────────────────────────────────────┐
│              Tier 1: System Rules            │
│   Constitution · Safety Protocol · Comms     │
├─────────────────────────────────────────────┤
│              Tier 2: Agent Roles             │
│   Manager · Architect · Executor · Reviewer  │
├─────────────────────────────────────────────┤
│              Tier 3: Skills                  │
│   $badger · $badger-status · $badger-rollback│
└─────────────────────────────────────────────┘
```

### Agents

| Agent | Role | Boundary |
|-------|------|----------|
| **Manager** | Orchestrates tasks, communicates with user | Cannot write code |
| **Architect** | Designs systems, plans file structures | Cannot write code |
| **Executor** | Implements features, writes code | Cannot skip checkpoints or change architecture |
| **Reviewer** | Reviews code quality and security | Cannot write code |

Agents communicate **only through the Manager** — no direct agent-to-agent calls. This ensures the safety protocol is enforced at every handoff.

## Safety Layer

### 🛡️ Checkpoints
A git checkpoint is created **before every file modification**. These form a LIFO stack that can be unwound at any point.

### ✅ Verification
After every change, Badger runs: **Build → Test → Lint → Typecheck**. Commands are auto-detected from your project config.

### ⏪ Automatic Rollback
If **any** verification check fails: revert → log → notify. Always.

### 📊 Blast Radius Analysis
Before touching a file, Badger scans its dependency graph and assigns a risk level:

| Risk | Dependents | Action |
|------|-----------|--------|
| Low | 0–1 | Proceed |
| Medium | 2–5 | Proceed with caution |
| High | 6–15 | Warn and proceed carefully |
| Critical | 16+ or config/entry | **Stop and ask user** |

### 🔒 Sensitive File Guardrails
`.env`, credentials, certificates, API keys — auto-detected and **protected by default**. Agents cannot read, modify, or reference them.

## Status

> 🚧 **Badger is under active development.** Core safety primitives are being built out. Not yet ready for production use.

### Built with
- **TypeScript** + **Bun**
- Targets: **Claude Code** and **OpenAI Codex**

## License

MIT

---

<p align="center">
  <sub>Built by <a href="https://github.com/AniketPatel148">Aniket Patel</a></sub>
</p>
