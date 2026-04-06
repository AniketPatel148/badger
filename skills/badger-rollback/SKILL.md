---
name: badger-rollback
description: "Manually rollback to any Badger checkpoint — undo agent changes safely"
version: 0.1.0
allowed-tools:
  - bash
  - file_read
---

# $badger-rollback — Manual Rollback

Manually rollback to a Badger checkpoint. Undoes agent changes and restores
your code to a known-good state.

---

## Instructions

When the user runs `$badger-rollback`, execute the rollback workflow.

### Step 1: Check State

```bash
if [ ! -d .badger ]; then
  echo "Badger is not initialized. Nothing to rollback."
  exit 0
fi

echo "=== CHECKPOINTS ==="
cat .badger/checkpoints.json 2>/dev/null || echo "No checkpoints found"

echo "=== CURRENT STATE ==="
git status --short
git log --oneline -10
```

If no checkpoints exist, tell the user: "No Badger checkpoints found. Nothing to rollback."

### Step 2: Show Available Checkpoints

Present the checkpoints to the user:

```
BADGER ROLLBACK
════════════════════════════════════════
Available Checkpoints:
════════════════════════════════════════

  [1] {SHA short} — {description}
      Created: {timestamp}
      Agent: {agent role}

  [2] {SHA short} — {description}
      Created: {timestamp}
      Agent: {agent role}

  ...

════════════════════════════════════════

Options:
  1-N  — Rollback to that specific checkpoint
  last — Rollback to the most recent checkpoint (default)
  full — Rollback to the FIRST checkpoint (undo everything Badger did)

Which checkpoint? (enter number, "last", or "full")
```

### Step 3: Confirm with User

Before rolling back, show what will be lost:

```bash
# Show the diff that will be discarded
git diff {target-checkpoint-sha}..HEAD --stat
```

```
WARNING: This will discard the following changes:
────────────────────────────────────────
{diff stat output}
────────────────────────────────────────
{N} files changed, {M} insertions(+), {K} deletions(-)

This action cannot be undone (the discarded diff will be logged
in .badger/rollback-log.json for reference).

Proceed? (Y/N)
```

**Wait for explicit user confirmation.** Do NOT rollback without "Y".

### Step 4: Execute Rollback

```bash
# Capture the diff before reverting (for the rollback log)
DIFF=$(git diff {target-sha}..HEAD)
FROM_SHA=$(git rev-parse --short HEAD)

# Revert to the checkpoint
git reset --hard {target-sha}
git clean -fd
```

### Step 5: Log the Rollback

Update `.badger/rollback-log.json` with:
```json
{
  "id": "rollback-{timestamp}",
  "timestamp": "{ISO timestamp}",
  "strategy": "manual",
  "targetSha": "{target SHA}",
  "fromSha": "{previous HEAD SHA}",
  "reason": "User-initiated manual rollback via $badger-rollback",
  "discardedDiff": "{the captured diff}",
  "discardedFiles": ["{list of files that were reverted}"]
}
```

Update `.badger/checkpoints.json` — remove all checkpoints that were
after the target checkpoint (they no longer exist in git history).

### Step 6: Confirm

```
BADGER ROLLBACK COMPLETE
════════════════════════════════════════
Rolled back from: {from-SHA} to {target-SHA}
Strategy: {manual-single | manual-full}
Files reverted: {N}
════════════════════════════════════════

Current state:
  Branch: {branch}
  HEAD:   {SHA short} — {commit message}
  Status: Clean

The discarded diff has been saved to .badger/rollback-log.json
in case you need to review what was reverted.

Commands:
  $badger "<task>"   — Start a new task
  $badger-status     — View current state
════════════════════════════════════════
```

---

## Argument Handling

The user may pass arguments:

- `$badger-rollback` — Interactive mode (show checkpoints, ask which one)
- `$badger-rollback last` — Rollback to most recent checkpoint (still confirm)
- `$badger-rollback full` — Rollback to first checkpoint (still confirm)
- `$badger-rollback {SHA}` — Rollback to a specific checkpoint SHA (still confirm)

In all cases, ALWAYS confirm with the user before executing.

---

## Safety Rules

1. **Always confirm before rollback.** Show what will be lost. Wait for "Y".
2. **Always log the rollback.** The discarded diff must be saved.
3. **Always update the checkpoint stack.** Remove invalidated checkpoints.
4. **Never rollback to a SHA that isn't a Badger checkpoint.** If the user
   provides a SHA that isn't in the checkpoint stack, warn them and refuse.
5. **Never rollback if there are uncommitted changes.** Tell the user to
   commit or stash first:
   ```
   WARNING: You have uncommitted changes. Please commit or stash them
   before rolling back, or they will be lost permanently.
   ```
