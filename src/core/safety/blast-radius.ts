/**
 * Blast Radius Analyzer — scans dependency graph before file modifications.
 *
 * Computes a risk score (low/medium/high/critical) based on how many files
 * depend on the target file, whether it's a shared utility or entry point,
 * and whether tests cover the affected paths.
 */

import * as fs from "fs";
import * as path from "path";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface BlastRadiusResult {
  /** The file being analyzed */
  targetFile: string;
  /** Computed risk level */
  riskLevel: RiskLevel;
  /** Numeric risk score (0-100) */
  riskScore: number;
  /** Files that import/reference the target */
  dependents: string[];
  /** Number of dependents */
  dependentCount: number;
  /** Whether the file is a shared utility */
  isSharedUtility: boolean;
  /** Whether the file is a config or entry point */
  isConfigOrEntryPoint: boolean;
  /** Test files that cover this file */
  relatedTests: string[];
  /** Whether adequate test coverage exists */
  hasTestCoverage: boolean;
  /** Human-readable explanation */
  explanation: string;
}

// File patterns that indicate high-risk files
const CONFIG_PATTERNS = [
  /^package\.json$/,
  /^tsconfig.*\.json$/,
  /^\.env/,
  /^docker-compose/,
  /^Dockerfile/,
  /^Makefile$/,
  /^pyproject\.toml$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
  /webpack|vite|rollup|esbuild/,
  /\.config\.(js|ts|mjs|cjs)$/,
];

const ENTRY_POINT_PATTERNS = [
  /^(src\/)?(index|main|app|server)\.(ts|js|tsx|jsx|py|go|rs)$/,
  /^(src\/)?entry/,
];

const TEST_PATTERNS = [
  /\.(test|spec)\.(ts|js|tsx|jsx)$/,
  /^test\//,
  /^tests\//,
  /^__tests__\//,
  /_test\.(go|py|rs)$/,
  /test_.*\.py$/,
];

/**
 * Find all files that import/reference the target file.
 * Uses a simple text-based search for import statements.
 */
function findDependents(
  targetFile: string,
  projectRoot: string
): string[] {
  const dependents: string[] = [];
  const targetName = path.basename(targetFile, path.extname(targetFile));
  const targetRelative = targetFile.replace(projectRoot + "/", "");

  // Patterns to search for
  const searchPatterns = [
    targetRelative,
    `./${targetRelative}`,
    `../${targetName}`,
    `/${targetName}`,
    targetName,
  ];

  // Walk the project tree (shallow, skip node_modules/dist/.git)
  const skipDirs = new Set([
    "node_modules",
    "dist",
    ".git",
    ".badger",
    "vendor",
    "__pycache__",
    "target",
  ]);

  const codeExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".rb",
  ]);

  function walkDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name) && !entry.name.startsWith(".")) {
            walkDir(path.join(dir, entry.name));
          }
          continue;
        }

        const ext = path.extname(entry.name);
        if (!codeExtensions.has(ext)) continue;

        const filePath = path.join(dir, entry.name);
        const relativePath = filePath.replace(projectRoot + "/", "");

        // Don't count the file itself
        if (relativePath === targetRelative) continue;

        try {
          const content = fs.readFileSync(filePath, "utf-8");
          for (const pattern of searchPatterns) {
            if (content.includes(pattern)) {
              dependents.push(relativePath);
              break;
            }
          }
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walkDir(projectRoot);
  return dependents;
}

/**
 * Find test files related to the target file.
 */
function findRelatedTests(
  targetFile: string,
  projectRoot: string
): string[] {
  const targetName = path.basename(targetFile, path.extname(targetFile));
  const tests: string[] = [];

  function walkDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".git") {
            walkDir(path.join(dir, entry.name));
          }
          continue;
        }

        const isTestFile = TEST_PATTERNS.some((p) => p.test(entry.name));
        if (!isTestFile) continue;

        // Check if test file name relates to target
        if (entry.name.toLowerCase().includes(targetName.toLowerCase())) {
          tests.push(path.join(dir, entry.name).replace(projectRoot + "/", ""));
        }
      }
    } catch {
      // Skip
    }
  }

  walkDir(projectRoot);
  return tests;
}

/**
 * Analyze the blast radius for a file about to be modified.
 */
export function analyzeBlastRadius(
  targetFile: string,
  projectRoot: string
): BlastRadiusResult {
  const relativePath = targetFile.startsWith(projectRoot)
    ? targetFile.replace(projectRoot + "/", "")
    : targetFile;

  const absolutePath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(projectRoot, targetFile);

  // Check if it's a config or entry point
  const isConfigOrEntryPoint =
    CONFIG_PATTERNS.some((p) => p.test(relativePath)) ||
    ENTRY_POINT_PATTERNS.some((p) => p.test(relativePath));

  // Find dependents
  const dependents = findDependents(absolutePath, projectRoot);
  const dependentCount = dependents.length;

  // Check if it's a shared utility (imported by 3+ files)
  const isSharedUtility = dependentCount >= 3;

  // Find related tests
  const relatedTests = findRelatedTests(absolutePath, projectRoot);
  const hasTestCoverage = relatedTests.length > 0;

  // Compute risk score (0-100)
  let riskScore = 0;

  // Base score from dependent count
  if (dependentCount === 0) riskScore += 5;
  else if (dependentCount <= 2) riskScore += 15;
  else if (dependentCount <= 5) riskScore += 35;
  else if (dependentCount <= 10) riskScore += 55;
  else if (dependentCount <= 20) riskScore += 75;
  else riskScore += 90;

  // Config/entry point penalty
  if (isConfigOrEntryPoint) riskScore += 20;

  // Shared utility penalty
  if (isSharedUtility) riskScore += 10;

  // No test coverage penalty
  if (!hasTestCoverage && dependentCount > 0) riskScore += 15;

  // Cap at 100
  riskScore = Math.min(riskScore, 100);

  // Determine risk level
  let riskLevel: RiskLevel;
  if (riskScore <= 20) riskLevel = "low";
  else if (riskScore <= 45) riskLevel = "medium";
  else if (riskScore <= 70) riskLevel = "high";
  else riskLevel = "critical";

  // Build explanation
  const reasons: string[] = [];
  if (dependentCount > 0) {
    reasons.push(`${dependentCount} file(s) depend on this file`);
  }
  if (isConfigOrEntryPoint) {
    reasons.push("this is a config or entry point file");
  }
  if (isSharedUtility) {
    reasons.push("this is a shared utility (3+ dependents)");
  }
  if (!hasTestCoverage && dependentCount > 0) {
    reasons.push("no test coverage found for this file");
  }
  if (hasTestCoverage) {
    reasons.push(`${relatedTests.length} related test file(s) found`);
  }

  const explanation =
    reasons.length > 0
      ? `Risk: ${riskLevel} (score: ${riskScore}/100). ${reasons.join("; ")}.`
      : `Risk: ${riskLevel} (score: ${riskScore}/100). Isolated file with no known dependents.`;

  return {
    targetFile: relativePath,
    riskLevel,
    riskScore,
    dependents,
    dependentCount,
    isSharedUtility,
    isConfigOrEntryPoint,
    relatedTests,
    hasTestCoverage,
    explanation,
  };
}

/**
 * Analyze blast radius for multiple files (batch).
 * Returns the highest risk level found.
 */
export function analyzeBatchBlastRadius(
  files: string[],
  projectRoot: string
): {
  results: BlastRadiusResult[];
  highestRisk: RiskLevel;
  criticalFiles: string[];
  highRiskFiles: string[];
} {
  const results = files.map((f) => analyzeBlastRadius(f, projectRoot));

  const riskOrder: RiskLevel[] = ["low", "medium", "high", "critical"];
  let highestIdx = 0;
  for (const r of results) {
    const idx = riskOrder.indexOf(r.riskLevel);
    if (idx > highestIdx) highestIdx = idx;
  }

  return {
    results,
    highestRisk: riskOrder[highestIdx],
    criticalFiles: results
      .filter((r) => r.riskLevel === "critical")
      .map((r) => r.targetFile),
    highRiskFiles: results
      .filter((r) => r.riskLevel === "high")
      .map((r) => r.targetFile),
  };
}

/**
 * Format blast radius result for display.
 */
export function formatBlastRadius(result: BlastRadiusResult): string {
  const lines: string[] = [];
  const icon =
    result.riskLevel === "critical"
      ? "CRITICAL"
      : result.riskLevel === "high"
      ? "HIGH"
      : result.riskLevel === "medium"
      ? "MEDIUM"
      : "LOW";

  lines.push(`  [${icon}] ${result.targetFile} (score: ${result.riskScore}/100)`);

  if (result.dependentCount > 0) {
    lines.push(`    Dependents (${result.dependentCount}):`);
    for (const d of result.dependents.slice(0, 5)) {
      lines.push(`      - ${d}`);
    }
    if (result.dependents.length > 5) {
      lines.push(`      ... and ${result.dependents.length - 5} more`);
    }
  }

  if (result.relatedTests.length > 0) {
    lines.push(`    Tests: ${result.relatedTests.join(", ")}`);
  } else if (result.dependentCount > 0) {
    lines.push(`    Tests: NONE (no test coverage detected)`);
  }

  return lines.join("\n");
}
