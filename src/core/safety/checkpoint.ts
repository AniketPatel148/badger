/**
 * Checkpoint Engine — the foundation of Badger's safety layer.
 *
 * Creates git checkpoints before every agent task, maintains a LIFO stack
 * for nested rollbacks, and provides the restore points that the Rollback
 * Engine uses when verification fails.
 */

import * as fs from "fs";
import * as path from "path";
import {
  getHeadSha,
  createCheckpointCommit,
  getDiff,
  getDiffStat,
  getChangedFiles,
} from "../utils/git.js";

export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string;
  /** Git SHA at time of checkpoint */
  sha: string;
  /** Task ID this checkpoint belongs to */
  taskId: string;
  /** Agent role that was about to execute */
  agentRole: string;
  /** ISO timestamp */
  timestamp: string;
  /** Human-readable description */
  description: string;
}

export interface CheckpointStack {
  checkpoints: Checkpoint[];
  projectRoot: string;
}

const BADGER_DIR = ".badger";
const CHECKPOINTS_FILE = "checkpoints.json";

/**
 * Get the path to the checkpoints file.
 */
function getCheckpointsPath(projectRoot: string): string {
  return path.join(projectRoot, BADGER_DIR, CHECKPOINTS_FILE);
}

/**
 * Load the checkpoint stack from disk.
 */
export function loadCheckpoints(projectRoot: string): CheckpointStack {
  const filePath = getCheckpointsPath(projectRoot);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { checkpoints: [], projectRoot };
  }
}

/**
 * Save the checkpoint stack to disk.
 */
function saveCheckpoints(stack: CheckpointStack): void {
  const dir = path.join(stack.projectRoot, BADGER_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getCheckpointsPath(stack.projectRoot);
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(stack, null, 2));
  fs.renameSync(tmp, filePath);
}

/**
 * Generate a unique checkpoint ID.
 */
function generateCheckpointId(taskId: string, agentRole: string): string {
  const ts = Date.now();
  return `checkpoint/${taskId}/${agentRole}/${ts}`;
}

/**
 * Create a checkpoint before an agent task.
 * Commits all current changes and records the state.
 * Returns the created checkpoint.
 */
export function createCheckpoint(
  projectRoot: string,
  taskId: string,
  agentRole: string,
  description: string
): Checkpoint {
  const id = generateCheckpointId(taskId, agentRole);
  const commitMsg = `[badger:checkpoint] ${description}`;

  // Create a checkpoint commit (or get current HEAD if clean)
  const sha = createCheckpointCommit(projectRoot, commitMsg);

  const checkpoint: Checkpoint = {
    id,
    sha,
    taskId,
    agentRole,
    timestamp: new Date().toISOString(),
    description,
  };

  // Push onto stack
  const stack = loadCheckpoints(projectRoot);
  stack.checkpoints.push(checkpoint);
  saveCheckpoints(stack);

  return checkpoint;
}

/**
 * Get the most recent checkpoint.
 */
export function getLatestCheckpoint(
  projectRoot: string
): Checkpoint | null {
  const stack = loadCheckpoints(projectRoot);
  if (stack.checkpoints.length === 0) return null;
  return stack.checkpoints[stack.checkpoints.length - 1];
}

/**
 * Get a checkpoint by its ID.
 */
export function getCheckpointById(
  projectRoot: string,
  checkpointId: string
): Checkpoint | null {
  const stack = loadCheckpoints(projectRoot);
  return stack.checkpoints.find((c) => c.id === checkpointId) ?? null;
}

/**
 * Get all checkpoints for a specific task.
 */
export function getCheckpointsForTask(
  projectRoot: string,
  taskId: string
): Checkpoint[] {
  const stack = loadCheckpoints(projectRoot);
  return stack.checkpoints.filter((c) => c.taskId === taskId);
}

/**
 * Pop the latest checkpoint off the stack (used after successful rollback).
 * Returns the removed checkpoint.
 */
export function popCheckpoint(projectRoot: string): Checkpoint | null {
  const stack = loadCheckpoints(projectRoot);
  if (stack.checkpoints.length === 0) return null;
  const removed = stack.checkpoints.pop()!;
  saveCheckpoints(stack);
  return removed;
}

/**
 * Pop all checkpoints after (and including) a specific checkpoint ID.
 * Used for cascade rollback.
 */
export function popCheckpointsFrom(
  projectRoot: string,
  checkpointId: string
): Checkpoint[] {
  const stack = loadCheckpoints(projectRoot);
  const idx = stack.checkpoints.findIndex((c) => c.id === checkpointId);
  if (idx === -1) return [];
  const removed = stack.checkpoints.splice(idx);
  saveCheckpoints(stack);
  return removed;
}

/**
 * Get what changed since a checkpoint.
 */
export function getChangesSinceCheckpoint(
  projectRoot: string,
  checkpoint: Checkpoint
): {
  diff: string;
  diffStat: string;
  changedFiles: string[];
} {
  return {
    diff: getDiff(projectRoot, checkpoint.sha),
    diffStat: getDiffStat(projectRoot, checkpoint.sha),
    changedFiles: getChangedFiles(projectRoot, checkpoint.sha),
  };
}

/**
 * Clear all checkpoints (used when a workflow completes successfully).
 */
export function clearCheckpoints(projectRoot: string): void {
  const stack: CheckpointStack = { checkpoints: [], projectRoot };
  saveCheckpoints(stack);
}
