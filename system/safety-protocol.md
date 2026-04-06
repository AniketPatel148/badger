# Badger Safety Protocol

This document defines the detailed technical rules for Badger's safety layer.
All agents inherit these rules from the constitution. This document expands on
the "how" of each safety mechanism.

---

## 1. Checkpoint Protocol (Detailed)

### When to Checkpoint
A checkpoint MUST be created before:
- Any `Write` or `Edit` tool call that modifies a project file
- Any `Bash` command that modifies files (e.g., `mkdir`, `mv`, `rm`, `cp`, `sed`)
- Any dependency installation (`npm install`, `pip install`, `cargo add`, etc.)
- Any database migration or schema change
- Any git operation that modifies history (rebase, cherry-pick, merge)

A checkpoint is NOT required for:
- Read-only operations (reading files, running `git status`, listing directories)
- Writing to `.badger/` state files (these are managed by safety engines)
- Running verification commands (these are post-change checks)

### Checkpoint Naming
Checkpoints follow this naming convention:
```
checkpoint/{task-id}/{agent-role}/{unix-timestamp}
```

Example:
```
checkpoint/task-001/executor/1712345678
```

### Checkpoint Commit Message
All checkpoint commits use this prefix:
```
[badger:checkpoint] {human-readable description of what's about to happen}
```

Examples:
```
[badger:checkpoint] Before executor implements JWT auth middleware
[badger:checkpoint] Before executor adds user model and migrations
[badger:checkpoint] Before reviewer applies suggested fixes to auth.ts
```

### Checkpoint Storage
Checkpoints are stored in `.badger/checkpoints.json` as a LIFO stack:
```json
{
  "checkpoints": [
    {
      "id": "checkpoint/task-001/executor/1712345678",
      "sha": "abc1234",
      "taskId": "task-001",
      "agentRole": "executor",
      "timestamp": "2026-04-05T10:00:00.000Z",
      "description": "Before executor implements JWT auth middleware"
    }
  ],
  "projectRoot": "/path/to/project"
}
```

---

## 2. Verification Protocol (Detailed)

### Check Order and Behavior

| Order | Check | Command Source | On Failure |
|-------|-------|---------------|------------|
| 1 | **Build** | `package.json` scripts.build, Makefile, Cargo.toml | ROLLBACK |
| 2 | **Test** | `package.json` scripts.test, pytest, `go test`, `cargo test` | ROLLBACK |
| 3 | **Lint** | `package.json` scripts.lint, ruff, clippy | ROLLBACK |
| 4 | **Type** | tsconfig.json → `tsc --noEmit`, mypy, `go vet`, `cargo check` | ROLLBACK |

**Fail-fast**: If check 1 fails, checks 2-4 do NOT run. The first failure
triggers an immediate rollback.

**Missing commands**: If a check has no auto-detected command (e.g., no lint
script in package.json), that check is SKIPPED, not FAILED. A skipped check
does not trigger rollback.

**Timeouts**: Each check has a 2-minute timeout. If a check exceeds this,
it is treated as a failure and triggers rollback.

### Auto-Detection Rules

**Node.js projects** (detected by `package.json`):
- Build: `{pm} run build` if `scripts.build` exists
- Test: `{pm} run test` if `scripts.test` exists
- Lint: `{pm} run lint` if `scripts.lint` exists
- Type: `{pm} run typecheck` or `npx tsc --noEmit` if `tsconfig.json` exists
- Package manager: bun (bun.lock/bun.lockb) > pnpm (pnpm-lock.yaml) > yarn (yarn.lock) > npm

**Python projects** (detected by `pyproject.toml`, `requirements.txt`, or `setup.py`):
- Test: `python -m pytest`
- Lint: `ruff check .` if `ruff.toml` or `.flake8` exists
- Type: `mypy .` if `mypy.ini` or `pyrightconfig.json` exists

**Go projects** (detected by `go.mod`):
- Build: `go build ./...`
- Test: `go test ./...`
- Type: `go vet ./...`

**Rust projects** (detected by `Cargo.toml`):
- Build: `cargo build`
- Test: `cargo test`
- Lint: `cargo clippy`
- Type: `cargo check`

### Custom Overrides
Users can override any command in `.badger/config.json`:
```json
{
  "verify": {
    "buildCommand": "make build",
    "testCommand": "make test",
    "lintCommand": "eslint src/",
    "typeCheckCommand": "tsc --noEmit",
    "skip": ["lint"]
  }
}
```

---

## 3. Rollback Protocol (Detailed)

### Rollback Trigger
A rollback is triggered when:
1. Any verification check fails (exit code != 0)
2. A verification check times out (>2 minutes)
3. The user explicitly requests `$badger-rollback`
4. A blast radius check returns "critical" and the user declines to proceed

### Rollback Sequence
```
1. CAPTURE   — git diff {checkpoint-sha}..HEAD > discarded.diff
2. IDENTIFY  — list all files changed since checkpoint
3. REVERT    — git reset --hard {checkpoint-sha}
4. CLEAN     — git clean -fd (remove untracked files created since checkpoint)
5. LOG       — write entry to .badger/rollback-log.json
6. NOTIFY    — display rollback summary to user
```

### Rollback Strategies

**Single (default)**:
- Reverts to the most recent checkpoint
- Pops the top checkpoint from the stack
- Use when: a single task failed and the previous state was good

**Cascade**:
- Reverts to a specific checkpoint, removing all checkpoints after it
- Use when: a task failure reveals that earlier tasks were also wrong
- Example: Task 3 fails, and you realize Task 2's approach was flawed

**Full**:
- Reverts to the very first checkpoint (the initial state)
- Removes ALL checkpoints from the stack
- Use when: the entire approach needs to be reconsidered
- This is a last resort, equivalent to "start over"

### Rollback Log Entry Format
```json
{
  "id": "rollback-1712345999",
  "timestamp": "2026-04-05T10:05:00.000Z",
  "checkpointId": "checkpoint/task-001/executor/1712345678",
  "targetSha": "abc1234",
  "fromSha": "def5678",
  "strategy": "single",
  "reason": "Verification failed: test check returned exit code 1",
  "verifyResult": {
    "passed": false,
    "firstFailure": {
      "check": "test",
      "command": "bun test",
      "exitCode": 1,
      "stderr": "FAIL src/auth.test.ts > should validate JWT token"
    }
  },
  "discardedDiff": "diff --git a/src/auth.ts ...",
  "discardedFiles": ["src/auth.ts", "src/middleware/jwt.ts"]
}
```

---

## 4. Blast Radius Protocol (Detailed)

### Analysis Process
Before modifying a file:

1. **Find dependents**: Scan all source files for import/require statements
   referencing the target file. Count how many files depend on it.

2. **Check file type**: Is it a config file (package.json, tsconfig.json)?
   Is it an entry point (index.ts, main.ts, app.ts)? These get automatic
   risk score bonuses.

3. **Find test coverage**: Search for test files whose name matches the
   target file. Lack of test coverage increases risk.

4. **Compute score** (0-100):
   - Base: 5 (0 deps), 15 (1-2 deps), 35 (3-5 deps), 55 (6-10 deps), 75 (11-20 deps), 90 (21+ deps)
   - +20 if config or entry point
   - +10 if shared utility (3+ dependents)
   - +15 if no test coverage and has dependents
   - Cap at 100

5. **Classify**:
   - 0-20: Low → proceed
   - 21-45: Medium → proceed with full verification
   - 46-70: High → warn, run extended verification
   - 71-100: Critical → STOP, ask user

### Batch Analysis
When a task modifies multiple files, analyze ALL files before starting.
If ANY file is critical, the entire batch requires user approval.
Report the highest risk level found across all files.

---

## 5. Sensitive File Guardrails (Detailed)

### Detection Patterns
On `$badger init`, the guardrails engine scans for:

| Category | Patterns |
|----------|----------|
| Environment | `.env`, `.env.*`, `.env.local`, `.env.production` |
| Credentials | `*credentials*`, `*secret*`, `*secrets*` |
| Certificates | `*.pem`, `*.key`, `*.cert`, `*.crt`, `*.p12`, `*.pfx` |
| API Keys | `*api_key*`, `*apikey*`, `*token*` |
| SSH Keys | `id_rsa`, `id_rsa.pub`, `id_ed25519`, `id_ed25519.pub` |
| Cloud | `.aws/credentials`, `.aws/config`, `*service-account*.json` |
| Database | `*.sqlite`, `*.db` |
| Auth | `auth.json`, `firebase-adminsdk*.json` |

Additionally, patterns from `.gitignore` that contain keywords like "secret",
"credential", "key", ".env", or ".pem" are automatically added.

### Enforcement
The guardrail check runs BEFORE the blast radius check. The sequence is:
```
GUARDRAIL → BLAST RADIUS → CHECKPOINT → EXECUTE → VERIFY
```

If a guardrail blocks a file:
1. The agent receives an immediate BLOCK response
2. No checkpoint is created (the change never starts)
3. The user is notified with the blocked file and the reason
4. The agent must find an alternative approach that doesn't touch the protected file

### User Customization
Users can modify `.badger/protected-files.json`:
- `userAdded`: Additional files/patterns to protect
- `userExcluded`: Files to unprotect (overrides default patterns)

Example:
```json
{
  "userAdded": ["config/production.yml", "*.passwords"],
  "userExcluded": [".env.example"]
}
```

`.env.example` is often a template file without real secrets. The user can
exclude it from protection if they want agents to reference it.
