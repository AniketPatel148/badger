/**
 * Verify Engine — runs verification suite after every agent task.
 *
 * Checks: build, test, lint, type-check.
 * Uses auto-detected commands from the project config, or user-provided overrides.
 */

import { spawnSync } from "child_process";
import { detectProjectConfig, type ProjectConfig } from "../utils/detect.js";

export type VerifyCheckType = "build" | "test" | "lint" | "typecheck";

export interface VerifyResult {
  /** Which check was run */
  check: VerifyCheckType;
  /** Whether the check passed */
  passed: boolean;
  /** The command that was run */
  command: string;
  /** stdout from the command */
  stdout: string;
  /** stderr from the command */
  stderr: string;
  /** Exit code */
  exitCode: number;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface VerifySuiteResult {
  /** Overall pass/fail */
  passed: boolean;
  /** Individual check results */
  results: VerifyResult[];
  /** First failing check (if any) */
  firstFailure: VerifyResult | null;
  /** Total duration in milliseconds */
  totalDurationMs: number;
}

export interface VerifyConfig {
  /** Custom commands (override auto-detected) */
  buildCommand?: string | null;
  testCommand?: string | null;
  lintCommand?: string | null;
  typeCheckCommand?: string | null;
  /** Which checks to skip */
  skip?: VerifyCheckType[];
}

/**
 * Run a single verification command.
 */
function runCheck(
  check: VerifyCheckType,
  command: string,
  cwd: string
): VerifyResult {
  const start = Date.now();

  const result = spawnSync("sh", ["-c", command], {
    cwd,
    stdio: "pipe",
    timeout: 120_000, // 2 min max per check
  });

  const durationMs = Date.now() - start;

  return {
    check,
    passed: result.status === 0,
    command,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.status ?? 1,
    durationMs,
  };
}

/**
 * Run the full verification suite.
 * Runs checks in order: build → test → lint → typecheck.
 * Stops at first failure (fail-fast).
 */
export function runVerifySuite(
  projectRoot: string,
  config?: VerifyConfig
): VerifySuiteResult {
  const detected = detectProjectConfig(projectRoot);
  const skipSet = new Set(config?.skip ?? []);

  const checks: Array<{ type: VerifyCheckType; command: string | null }> = [
    {
      type: "build",
      command: config?.buildCommand ?? detected.buildCommand,
    },
    {
      type: "test",
      command: config?.testCommand ?? detected.testCommand,
    },
    {
      type: "lint",
      command: config?.lintCommand ?? detected.lintCommand,
    },
    {
      type: "typecheck",
      command: config?.typeCheckCommand ?? detected.typeCheckCommand,
    },
  ];

  const results: VerifyResult[] = [];
  let firstFailure: VerifyResult | null = null;
  const suiteStart = Date.now();

  for (const { type, command } of checks) {
    // Skip if no command available or explicitly skipped
    if (!command || skipSet.has(type)) continue;

    const result = runCheck(type, command, projectRoot);
    results.push(result);

    if (!result.passed && !firstFailure) {
      firstFailure = result;
      // Fail-fast: stop running more checks
      break;
    }
  }

  return {
    passed: firstFailure === null,
    results,
    firstFailure,
    totalDurationMs: Date.now() - suiteStart,
  };
}

/**
 * Format a verify result for display.
 */
export function formatVerifyResult(result: VerifySuiteResult): string {
  const lines: string[] = [];

  lines.push(
    result.passed
      ? "  Verification: PASSED"
      : "  Verification: FAILED"
  );

  for (const r of result.results) {
    const icon = r.passed ? "pass" : "FAIL";
    lines.push(
      `    [${icon}] ${r.check} (${r.durationMs}ms) — ${r.command}`
    );
    if (!r.passed && r.stderr) {
      const errorLines = r.stderr.split("\n").slice(0, 5);
      for (const line of errorLines) {
        lines.push(`           ${line}`);
      }
    }
  }

  lines.push(`  Total: ${result.totalDurationMs}ms`);
  return lines.join("\n");
}
