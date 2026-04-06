# Badger — Safety-First Agentic Coding

> **"AI agents that won't break your code."**

Badger is a safety-first agentic coding system. Every file modification is
checkpointed, verified, and auto-reverted if anything breaks.

---

## How to Use

```
$badger "Add user authentication with JWT"
$badger-status
$badger-rollback
```

### Commands

| Command | Description |
|---------|------------|
| `$badger "<task>"` | Start a safety-first agentic coding task |
| `$badger-status` | View checkpoints, rollback history, and safety state |
| `$badger-rollback` | Manually rollback to any Badger checkpoint |

---

## Architecture

Badger uses a 3-tier prompt architecture:

### Tier 1: System Rules (inherited by ALL agents)
- `system/constitution.md` — Non-negotiable safety rules, the Prime Directive
- `system/safety-protocol.md` — Technical specifications for checkpoint, verify, rollback, blast radius, guardrails
- `system/communication.md` — Agent communication protocol, task formats, handoff rules

### Tier 2: Agent Roles (each inherits Tier 1)
- `agents/manager.md` — Orchestrator: assigns tasks, monitors progress, presents results
- `agents/architect.md` — Designer: plans approach, defines file structure, never writes code
- `agents/executor.md` — Implementer: writes code, follows plan, checkpoints every change
- `agents/reviewer.md` — Inspector: reviews code quality, security, plan adherence

### Tier 3: Skills (user-facing commands)
- `skills/badger/SKILL.md` — Main entry point
- `skills/badger-status/SKILL.md` — Status viewer
- `skills/badger-rollback/SKILL.md` — Manual rollback

---

## The Prime Directive

Every file modification MUST follow this exact sequence:

```
1. GUARDRAIL CHECK  — Is the target file protected? If yes, STOP.
2. BLAST RADIUS     — How many files depend on the target? If critical, ask user.
3. CHECKPOINT       — Create a git checkpoint BEFORE making any change.
4. EXECUTE          — Make the change.
5. VERIFY           — Run build, test, lint, type-check.
6. RESULT           — If verify PASSES → commit. If verify FAILS → ROLLBACK.
```

No step may be skipped. There is no "the change is too small." The sequence
runs every single time.

---

## Safety Layer

### Checkpoints
Before every file modification, Badger creates a git checkpoint commit.
These form a LIFO stack — if anything goes wrong, Badger reverts to the
last known-good state automatically.

### Verification
After every file modification, Badger runs the verification suite:
1. **Build** — Does the project compile?
2. **Test** — Do all tests pass?
3. **Lint** — Does the code pass linting?
4. **Type check** — Does the code pass type checking?

Commands are auto-detected from the project's config (package.json,
Makefile, pyproject.toml, Cargo.toml, go.mod).

### Rollback
If ANY verification check fails:
1. Auto-revert to the last checkpoint
2. Log what was attempted and why it failed
3. Notify the user with the specific error

**Badger never "fixes forward."** It rolls back first, then optionally
retries with a different approach.

### Blast Radius Analysis
Before modifying any file, Badger scans its dependency graph:
- **Low** (0-1 dependents) → Proceed automatically
- **Medium** (2-5 dependents) → Proceed with caution
- **High** (6-15 dependents) → Warn and proceed carefully
- **Critical** (16+ or config/entry point) → STOP and ask user

### Sensitive File Guardrails
Badger auto-detects and protects sensitive files:
- `.env`, `.env.*` — environment variables
- `*credentials*`, `*secret*`, `*key*` — secrets
- `*.pem`, `*.key`, `*.cert` — certificates
- Any file matching secrets patterns in `.gitignore`

Protected files cannot be read, modified, or referenced by any agent.

---

## Agent Roles and Boundaries

| Role | Can Do | Cannot Do |
|------|--------|-----------|
| **Manager** | Orchestrate, assign tasks, communicate with user | Write code |
| **Architect** | Design systems, plan file structure, choose patterns | Write code |
| **Executor** | Write code, implement features, install dependencies | Skip checkpoints, change architecture |
| **Reviewer** | Review code, identify bugs, suggest improvements | Write code |

Agents communicate through the Manager only. No direct agent-to-agent
communication. This ensures the safety protocol is enforced at every handoff.

---

## State Files

Badger stores its state in `.badger/` (add to .gitignore):

| File | Purpose |
|------|---------|
| `checkpoints.json` | Checkpoint stack (LIFO) |
| `rollback-log.json` | History of all rollbacks with discarded diffs |
| `protected-files.json` | Sensitive files guardrail config |
| `blast-radius.json` | Blast radius audit trail |
| `state.json` | Current workflow state |

---

## Project Configuration

Badger auto-detects your project type and verification commands.
Override in `.badger/config.json`:

```json
{
  "verify": {
    "build": "npm run build",
    "test": "npm test",
    "lint": "npm run lint",
    "typecheck": "npx tsc --noEmit"
  }
}
```
