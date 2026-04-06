---
name: badger-status
description: "Show Badger checkpoint history, current state, and safety audit trail"
version: 0.1.0
allowed-tools:
  - bash
  - file_read
---

# $badger-status — View Badger State

Show the current Badger safety state: checkpoints, rollbacks, protected files,
and blast radius history.

---

## Instructions

When the user runs `$badger-status`, display the current Badger state.

### Step 1: Check if Badger is initialized

```bash
if [ -d .badger ]; then
  echo "Badger is initialized"
else
  echo "Badger is not initialized. Run \$badger to start a task first."
  exit 0
fi
```

If `.badger/` does not exist, tell the user and stop.

### Step 2: Gather state

Read the following files (if they exist):

```bash
# Checkpoint history
echo "=== CHECKPOINTS ==="
cat .badger/checkpoints.json 2>/dev/null || echo "No checkpoints"

# Rollback history
echo "=== ROLLBACKS ==="
cat .badger/rollback-log.json 2>/dev/null || echo "No rollbacks"

# Protected files
echo "=== PROTECTED FILES ==="
cat .badger/protected-files.json 2>/dev/null || echo "No guardrails config"

# Blast radius history
echo "=== BLAST RADIUS ==="
cat .badger/blast-radius.json 2>/dev/null || echo "No blast radius data"

# Workflow state
echo "=== WORKFLOW STATE ==="
cat .badger/state.json 2>/dev/null || echo "No active workflow"

# Git status
echo "=== GIT ==="
git branch --show-current
git log --oneline -10
```

### Step 3: Display formatted output

Present the state in this format:

```
BADGER STATUS
════════════════════════════════════════
Branch:       {current branch}
Active Task:  {task description or "None"}
Last Activity: {timestamp of latest checkpoint}
════════════════════════════════════════

CHECKPOINTS ({N} total)
────────────────────────────────────────
  {SHA short}  {description}              {timestamp}
  {SHA short}  {description}              {timestamp}
  ...
  (showing last 10)

ROLLBACKS ({N} total)
────────────────────────────────────────
  {rollback-id}  {reason}                 {timestamp}
  ...
  (showing last 5, or "None — no rollbacks have occurred")

PROTECTED FILES ({N} total)
────────────────────────────────────────
  {file1}
  {file2}
  ...
  (or "None detected")

BLAST RADIUS CHECKS ({N} total)
────────────────────────────────────────
  {file}  Risk: {LOW|MEDIUM|HIGH|CRITICAL}  Score: {N}/100
  ...
  (showing last 10, or "None performed yet")

RECENT COMMITS
────────────────────────────────────────
  {git log --oneline -10}
════════════════════════════════════════

Commands:
  $badger "<task>"      — Start a new task
  $badger-rollback      — Rollback to a checkpoint
  $badger-status        — This screen
```

### Notes

- This is a **read-only** command. It does NOT modify any files.
- If a section has no data, show "None" — do not skip the section.
- Show timestamps in a human-readable relative format if possible
  (e.g., "2 minutes ago", "1 hour ago"). Otherwise use ISO format.
- If the checkpoint stack is very large (>10), show only the last 10 with
  a note: "({N} more checkpoints not shown)"
