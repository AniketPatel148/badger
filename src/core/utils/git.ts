/**
 * Git operations wrapper for Badger.
 * Handles worktrees, checkpoints, rollback, and branch management.
 * Uses raw git CLI (no external dependencies).
 */

import { spawnSync } from "child_process";
import * as path from "path";

export interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a git command synchronously. Returns structured result.
 */
export function git(
  args: string[],
  cwd: string,
  tolerateFailure = false
): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    timeout: 30_000,
  });

  const stdout = result.stdout?.toString().trim() ?? "";
  const stderr = result.stderr?.toString().trim() ?? "";
  const exitCode = result.status ?? 1;

  if (exitCode !== 0 && !tolerateFailure) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr || stdout}`
    );
  }

  return { success: exitCode === 0, stdout, stderr, exitCode };
}

/**
 * Get the root of the current git repository.
 */
export function getRepoRoot(cwd: string = process.cwd()): string {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  return result.stdout;
}

/**
 * Get the current HEAD SHA.
 */
export function getHeadSha(cwd: string): string {
  const result = git(["rev-parse", "HEAD"], cwd);
  return result.stdout;
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(cwd: string): string {
  const result = git(["branch", "--show-current"], cwd, true);
  return result.stdout || "HEAD";
}

/**
 * Check if the working directory is clean (no uncommitted changes).
 */
export function isClean(cwd: string): boolean {
  const result = git(["status", "--porcelain"], cwd, true);
  return result.stdout === "";
}

/**
 * Create a lightweight checkpoint commit with all current changes.
 * Returns the SHA of the checkpoint commit.
 */
export function createCheckpointCommit(
  cwd: string,
  message: string
): string {
  // Stage all changes
  git(["add", "-A"], cwd);

  // Check if there's anything to commit
  const status = git(["status", "--porcelain"], cwd, true);
  if (status.stdout === "") {
    // Nothing to commit, return current HEAD
    return getHeadSha(cwd);
  }

  // Create checkpoint commit
  git(["commit", "-m", message, "--no-verify"], cwd);
  return getHeadSha(cwd);
}

/**
 * Rollback to a specific commit SHA, discarding all changes after it.
 */
export function rollbackToCommit(cwd: string, targetSha: string): void {
  git(["reset", "--hard", targetSha], cwd);
  git(["clean", "-fd"], cwd);
}

/**
 * Create a git worktree at the specified path, detached at HEAD.
 */
export function createWorktree(
  repoRoot: string,
  worktreePath: string
): void {
  git(["worktree", "add", "--detach", worktreePath, "HEAD"], repoRoot);
}

/**
 * Remove a git worktree.
 */
export function removeWorktree(
  repoRoot: string,
  worktreePath: string
): void {
  git(["worktree", "remove", "--force", worktreePath], repoRoot, true);
}

/**
 * Get the diff between two commits (or HEAD and a commit).
 */
export function getDiff(
  cwd: string,
  fromSha: string,
  toSha: string = "HEAD"
): string {
  const result = git(["diff", fromSha, toSha], cwd, true);
  return result.stdout;
}

/**
 * Get the diff stat (summary) between two commits.
 */
export function getDiffStat(
  cwd: string,
  fromSha: string,
  toSha: string = "HEAD"
): string {
  const result = git(["diff", "--stat", fromSha, toSha], cwd, true);
  return result.stdout;
}

/**
 * Get list of files changed between two commits.
 */
export function getChangedFiles(
  cwd: string,
  fromSha: string,
  toSha: string = "HEAD"
): string[] {
  const result = git(
    ["diff", "--name-only", fromSha, toSha],
    cwd,
    true
  );
  return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}

/**
 * Prune stale worktrees.
 */
export function pruneWorktrees(repoRoot: string): void {
  git(["worktree", "prune"], repoRoot, true);
}
