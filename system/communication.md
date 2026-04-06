# Badger Communication Protocol

This document defines how agents communicate, hand off work, and report status
within the Badger system. All agents inherit these rules.

---

## 1. Communication Flow

Agents do NOT communicate directly with each other. All communication flows
through the Manager:

```
User
  │
  ▼
Manager (orchestrator)
  │
  ├──→ Architect ──→ (plan) ──→ Manager
  │
  ├──→ Executor ──→ (code) ──→ Manager
  │
  ├──→ Reviewer ──→ (review) ──→ Manager
  │
  ├──→ QA ──→ (tests) ──→ Manager (Phase 2)
  │
  ├──→ Security ──→ (audit) ──→ Manager (Phase 2)
  │
  └──→ PM ──→ (tickets) ──→ Manager (Phase 2)
```

**Why:** Centralized communication ensures the Manager maintains full visibility
into the workflow state. It prevents agents from making side agreements that
bypass safety checks.

---

## 2. Task Assignment Format

When the Manager assigns a task to an agent, it MUST include:

```markdown
## Task Assignment

**Task ID:** task-{NNN}
**Assigned To:** {agent role}
**Priority:** {P0|P1|P2}
**Description:** {what to do, in specific terms}

### Context
{relevant background — what was done before, what decisions were made}

### Scope
**Files in scope:** {list of files this agent is allowed to modify}
**Files out of scope:** {files this agent must NOT touch}

### Acceptance Criteria
{specific, testable criteria for "done"}

### Safety Notes
{any blast radius warnings, protected file concerns, or prior rollbacks}
```

**File scope is mandatory.** The Manager MUST specify which files an agent
is allowed to modify. An agent MUST NOT modify files outside its assigned scope.
If an agent discovers it needs to modify an out-of-scope file, it reports back
to the Manager with a NEEDS_CONTEXT status.

---

## 3. Task Completion Report

When an agent finishes a task, it reports back to the Manager:

```markdown
## Task Completion

**Task ID:** task-{NNN}
**Agent:** {role}
**Status:** {DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT}

### What Was Done
{concrete description of changes made}

### Files Modified
- {file1} — {what changed}
- {file2} — {what changed}

### Verification Result
- Build: {PASS|FAIL|SKIPPED}
- Test: {PASS|FAIL|SKIPPED}
- Lint: {PASS|FAIL|SKIPPED}
- Type: {PASS|FAIL|SKIPPED}

### Checkpoints Created
- {checkpoint-id-1}: {description}
- {checkpoint-id-2}: {description}

### Concerns (if any)
{issues the next agent should be aware of}

### Rollbacks (if any)
{any rollbacks that occurred and what was learned}
```

---

## 4. Status Codes

| Status | Meaning | What Happens Next |
|--------|---------|-------------------|
| **DONE** | Task completed successfully. All verification passed. | Manager assigns next task or reports to user. |
| **DONE_WITH_CONCERNS** | Task completed, but there are issues. | Manager reviews concerns before proceeding. May ask user. |
| **BLOCKED** | Cannot proceed. Something is preventing progress. | Manager evaluates blocker. May reassign, ask user, or adjust plan. |
| **NEEDS_CONTEXT** | Missing information required to continue. | Manager provides context or asks user for clarification. |

---

## 5. Handoff Protocol

When one agent's work feeds into another's (e.g., Architect → Executor):

### Step 1: Outgoing Agent Reports
The outgoing agent (Architect) completes its task and reports to Manager
with the full completion report.

### Step 2: Manager Validates
The Manager checks:
- Did the outgoing agent's verification pass?
- Are there any concerns that need to be addressed first?
- Is the work ready for the next agent?

### Step 3: Manager Creates Handoff
The Manager creates a task assignment for the incoming agent (Executor)
that includes:
- The outgoing agent's output (e.g., the architecture plan)
- Relevant context from the outgoing agent's report
- File scope for the new task
- Any concerns to be aware of

### Step 4: Incoming Agent Acknowledges
The incoming agent reads the assignment, confirms understanding, and begins
work. If anything is unclear, it reports NEEDS_CONTEXT immediately,
before making any changes.

---

## 6. Workflow Sequence (Default)

The standard workflow for a task is:

```
1. USER         → $badger "Add user authentication with JWT"
2. MANAGER      → Parses request, creates git worktree, creates initial checkpoint
3. MANAGER      → Assigns planning task to ARCHITECT
4. ARCHITECT    → Produces architecture plan (files, structure, approach)
                → Reports DONE with plan artifact
5. MANAGER      → Validates plan, assigns implementation to EXECUTOR (task by task)
6. EXECUTOR     → For each task in the plan:
                   a. Guardrail check on target files
                   b. Blast radius analysis
                   c. Create checkpoint
                   d. Implement the change
                   e. Run verification
                   f. If PASS → commit, report DONE
                   g. If FAIL → rollback, report BLOCKED or retry
7. MANAGER      → After all tasks: assigns review to REVIEWER
8. REVIEWER     → Reviews all changes since initial checkpoint
                → Reports DONE with findings, or DONE_WITH_CONCERNS
9. MANAGER      → If concerns: assigns fixes to EXECUTOR
                → If clean: summarizes results to user
10. MANAGER     → Presents final summary: diff, verification results, checkpoint history
                → Offers: create PR, merge, keep branch, or discard
```

---

## 7. Error Recovery

When an agent encounters an error:

### Verification Failure
```
Agent detects failure
  → Rollback engine activates
  → Agent reports BLOCKED to Manager with:
    - What was attempted
    - The verification failure details
    - The rollback that occurred
  → Manager decides: retry (up to 2 times), reassign, or ask user
```

### Guardrail Block
```
Agent attempts to access protected file
  → Guardrail engine blocks immediately
  → Agent reports BLOCKED to Manager with:
    - The file that was blocked
    - Why it was needed
    - Suggested alternative approach
  → Manager decides: ask user to unprotect, find alternative, or skip
```

### Critical Blast Radius
```
Agent needs to modify critical file
  → Blast radius engine flags critical risk
  → Agent reports NEEDS_CONTEXT to Manager with:
    - The file and its risk analysis
    - Why the modification is needed
    - Impact assessment (which dependents are affected)
  → Manager asks user for explicit approval
  → If approved: agent proceeds with extra verification
  → If denied: agent finds alternative approach or reports BLOCKED
```

---

## 8. User Interaction Rules

Only the Manager communicates directly with the user. Other agents do NOT
interact with the user directly.

The Manager presents information to the user in this format:

```
BADGER STATUS
════════════════════════════════════════
Phase:      {current phase}
Agent:      {which agent is active}
Task:       {current task description}
Checkpoint: {latest checkpoint SHA short}
Risk:       {highest blast radius level}
════════════════════════════════════════
```

When asking the user a question, the Manager MUST:
1. State what is happening (1 sentence)
2. Explain why input is needed (1 sentence)
3. Present clear options
4. Include a recommendation
