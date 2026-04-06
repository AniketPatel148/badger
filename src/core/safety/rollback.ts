/**
 * Rollback Engine — auto-reverts to the last checkpoint when verification fails.
 *
 * Supports three strategies:
 * - single: revert just the failed task (default)
 * - cascade: revert the failed task + all dependent tasks
 * - full: revert everything back to the starting state
 */

import * as fs from "fs";
import * as path from "path";
import { rollbackToCommit, getDiff, getDiffStat } from "../utils/git.js";
import {
  type Checkpoint,
  getLatestCheckpoint,
  getCheckpointById,
  popCheckpoint,
  popCheckpointsFrom,
  loadCheckpoints,
} from "./checkpoint.js";
import type { VerifySuiteResult } from "./verify.js";

export type RollbackStrategy = "single" | "cascade" | "full";

export interface RollbackEntry {
  /** Unique rollback ID */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Which checkpoint we rolled back to */
  checkpointId: string;
  /** SHA we rolled back to */
  targetSha: string;
  /** SHA we rolled back from */
  fromSha: string;
  /** Strategy used */
  strategy: RollbackStrategy;
  /** Why the rollback happened */
  reason: string;
  /** Verification result that triggered the rollback */
  verifyResult: VerifySuiteResult | null;
  /** The diff that was discarded */
  discardedDiff: string;
  /** Files that were affected */
  discardedFiles: string[];
}

export interface RollbackLog {
  entries: RollbackEntry[];
}

const BADGER_DIR = ".badger";
const ROLLBACK_LOG_FILE = "rollback-log.json";

function getRollbackLogPath(projectRoot: string): string {
  return path.join(projectRoot, BADGER_DIR, ROLLBACK_LOG_FILE);
}

function loadRollbackLog(projectRoot: string): RollbackLog {
  const filePath = getRollbackLogPath(projectRoot);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { entries: [] };
  }
}

function saveRollbackLog(projectRoot: string, log: RollbackLog): void {
  const dir = path.join(projectRoot, BADGER_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getRollbackLogPath(projectRoot);
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(log, null, 2));
  fs.renameSync(tmp, filePath);
}

/**
 * Perform a rollback to a specific checkpoint.
 *
 * @param projectRoot - The project root directory
 * @param strategy - Rollback strategy to use
 * @param reason - Human-readable reason for rollback
 * @param verifyResult - The verification result that triggered this (if any)
 * @param targetCheckpointId - Specific checkpoint to rollback to (for cascade/manual)
 * @returns The rollback entry that was created
 */
export function performRollback(
  projectRoot: string,
  strategy: RollbackStrategy,
  reason: string,
  verifyResult: VerifySuiteResult | null = null,
  targetCheckpointId?: string
): RollbackEntry {
  const stack = loadCheckpoints(projectRoot);

  let targetCheckpoint: Checkpoint | null = null;

  switch (strategy) {
    case "single": {
      // Roll back to the most recent checkpoint
      targetCheckpoint = getLatestCheckpoint(projectRoot);
      break;
    }
    case "cascade": {
      // Roll back to a specific checkpoint (and remove all after it)
      if (targetCheckpointId) {
        targetCheckpoint = getCheckpointById(projectRoot, targetCheckpointId);
      } else {
        targetCheckpoint = getLatestCheckpoint(projectRoot);
      }
      break;
    }
    case "full": {
      // Roll back to the very first checkpoint
      if (stack.checkpoints.length > 0) {
        targetCheckpoint = stack.checkpoints[0];
      }
      break;
    }
  }

  if (!targetCheckpoint) {
    throw new Error("No checkpoint available to rollback to");
  }

  // Capture what we're about to discard
  const discardedDiff = getDiff(projectRoot, targetCheckpoint.sha);
  const discardedStat = getDiffStat(projectRoot, targetCheckpoint.sha);
  const discardedFiles = discardedStat
    .split("\n")
    .filter((l) => l.includes("|"))
    .map((l) => l.split("|")[0].trim());

  // Get current SHA before rollback
  const fromSha = stack.checkpoints.length > 0
    ? stack.checkpoints[stack.checkpoints.length - 1].sha
    : targetCheckpoint.sha;

  // Perform the git rollback
  rollbackToCommit(projectRoot, targetCheckpoint.sha);

  // Update checkpoint stack based on strategy
  if (strategy === "single") {
    popCheckpoint(projectRoot);
  } else if (strategy === "cascade" || strategy === "full") {
    popCheckpointsFrom(projectRoot, targetCheckpoint.id);
  }

  // Create rollback log entry
  const entry: RollbackEntry = {
    id: `rollback-${Date.now()}`,
    timestamp: new Date().toISOString(),
    checkpointId: targetCheckpoint.id,
    targetSha: targetCheckpoint.sha,
    fromSha,
    strategy,
    reason,
    verifyResult,
    discardedDiff,
    discardedFiles,
  };

  // Save to rollback log
  const log = loadRollbackLog(projectRoot);
  log.entries.push(entry);
  saveRollbackLog(projectRoot, log);

  return entry;
}

/**
 * Get all rollback entries.
 */
export function getRollbackHistory(projectRoot: string): RollbackEntry[] {
  return loadRollbackLog(projectRoot).entries;
}

/**
 * Format a rollback entry for display.
 */
export function formatRollbackEntry(entry: RollbackEntry): string {
  const lines: string[] = [];
  lines.push(`  ROLLBACK [${entry.strategy}]`);
  lines.push(`    Time: ${entry.timestamp}`);
  lines.push(`    Reason: ${entry.reason}`);
  lines.push(`    Reverted to: ${entry.targetSha.slice(0, 8)}`);
  lines.push(`    Files discarded: ${entry.discardedFiles.length}`);

  if (entry.discardedFiles.length > 0) {
    for (const f of entry.discardedFiles.slice(0, 10)) {
      lines.push(`      - ${f}`);
    }
    if (entry.discardedFiles.length > 10) {
      lines.push(`      ... and ${entry.discardedFiles.length - 10} more`);
    }
  }

  return lines.join("\n");
}
