/**
 * Sensitive File Guardrails — auto-detect and block agents from touching secrets.
 *
 * On init, scans the project for sensitive files (.env, credentials, certs, etc.)
 * and creates a protected files list. Agents are blocked from reading or modifying
 * any file on the list.
 */

import * as fs from "fs";
import * as path from "path";

export interface ProtectedFilesConfig {
  /** Files and patterns that are protected */
  protectedPatterns: string[];
  /** Specific files that have been detected as sensitive */
  detectedFiles: string[];
  /** User-added files to protect */
  userAdded: string[];
  /** User-excluded files (override protection) */
  userExcluded: string[];
  /** When the config was last updated */
  lastUpdated: string;
}

export interface GuardrailCheckResult {
  /** Whether the file is allowed to be accessed */
  allowed: boolean;
  /** The file being checked */
  filePath: string;
  /** Why it was blocked (if blocked) */
  reason: string | null;
  /** Which pattern matched (if blocked) */
  matchedPattern: string | null;
}

const BADGER_DIR = ".badger";
const PROTECTED_FILES_FILE = "protected-files.json";

// Default patterns for sensitive files
const DEFAULT_SENSITIVE_PATTERNS: string[] = [
  // Environment files
  ".env",
  ".env.*",
  ".env.local",
  ".env.production",
  ".env.staging",

  // Credentials and secrets
  "*credentials*",
  "*secret*",
  "*secrets*",

  // Certificates and keys
  "*.pem",
  "*.key",
  "*.cert",
  "*.crt",
  "*.p12",
  "*.pfx",
  "*.jks",

  // API keys and tokens
  "*api_key*",
  "*apikey*",
  "*token*",

  // SSH keys
  "id_rsa",
  "id_rsa.pub",
  "id_ed25519",
  "id_ed25519.pub",

  // AWS
  ".aws/credentials",
  ".aws/config",

  // GCP
  "*service-account*.json",
  "*serviceaccount*.json",

  // Docker secrets
  "docker-compose.secrets.yml",

  // Database
  "*.sqlite",
  "*.db",

  // Auth config
  "auth.json",
  "firebase-adminsdk*.json",
];

/**
 * Get path to the protected files config.
 */
function getProtectedFilesPath(projectRoot: string): string {
  return path.join(projectRoot, BADGER_DIR, PROTECTED_FILES_FILE);
}

/**
 * Load protected files config from disk.
 */
export function loadProtectedFiles(
  projectRoot: string
): ProtectedFilesConfig {
  const filePath = getProtectedFilesPath(projectRoot);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      protectedPatterns: [...DEFAULT_SENSITIVE_PATTERNS],
      detectedFiles: [],
      userAdded: [],
      userExcluded: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save protected files config to disk.
 */
function saveProtectedFiles(
  projectRoot: string,
  config: ProtectedFilesConfig
): void {
  const dir = path.join(projectRoot, BADGER_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getProtectedFilesPath(projectRoot);
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, filePath);
}

/**
 * Check if a filename matches a glob-like pattern.
 * Supports: *, ?, and literal matching.
 */
function matchesPattern(filename: string, pattern: string): boolean {
  // Normalize both
  const normalizedFile = filename.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  // Exact match
  if (normalizedFile === normalizedPattern) return true;

  // Simple glob: convert * to regex
  const regexStr = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex chars
    .replace(/\*/g, ".*") // * → .*
    .replace(/\?/g, "."); // ? → .

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalizedFile);
}

/**
 * Scan the project for sensitive files and update the config.
 */
export function scanForSensitiveFiles(
  projectRoot: string
): ProtectedFilesConfig {
  const config = loadProtectedFiles(projectRoot);
  const detected: string[] = [];

  const skipDirs = new Set([
    "node_modules",
    "dist",
    ".git",
    ".badger",
    "vendor",
    "__pycache__",
    "target",
    ".next",
    ".nuxt",
  ]);

  function walkDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) {
            walkDir(path.join(dir, entry.name));
          }
          continue;
        }

        const relativePath = path
          .join(dir, entry.name)
          .replace(projectRoot + "/", "");

        // Check against patterns
        for (const pattern of config.protectedPatterns) {
          if (
            matchesPattern(entry.name, pattern) ||
            matchesPattern(relativePath, pattern)
          ) {
            detected.push(relativePath);
            break;
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walkDir(projectRoot);

  // Also check .gitignore for secrets-like patterns
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
      const secretsPatterns = gitignoreContent
        .split("\n")
        .filter((line) => {
          const lower = line.toLowerCase().trim();
          return (
            lower.includes("secret") ||
            lower.includes("credential") ||
            lower.includes("key") ||
            lower.includes(".env") ||
            lower.includes(".pem")
          );
        })
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      // Add any new patterns from .gitignore
      for (const pattern of secretsPatterns) {
        if (!config.protectedPatterns.includes(pattern)) {
          config.protectedPatterns.push(pattern);
        }
      }
    } catch {
      // Ignore
    }
  }

  config.detectedFiles = [...new Set(detected)];
  config.lastUpdated = new Date().toISOString();
  saveProtectedFiles(projectRoot, config);

  return config;
}

/**
 * Check if a file is allowed to be accessed by an agent.
 */
export function checkFileAccess(
  filePath: string,
  projectRoot: string
): GuardrailCheckResult {
  const config = loadProtectedFiles(projectRoot);
  const relativePath = filePath.startsWith(projectRoot)
    ? filePath.replace(projectRoot + "/", "")
    : filePath;
  const filename = path.basename(relativePath);

  // Check user exclusions first (overrides protection)
  for (const excluded of config.userExcluded) {
    if (
      matchesPattern(filename, excluded) ||
      matchesPattern(relativePath, excluded)
    ) {
      return { allowed: true, filePath: relativePath, reason: null, matchedPattern: null };
    }
  }

  // Check user-added protected files
  for (const added of config.userAdded) {
    if (
      matchesPattern(filename, added) ||
      matchesPattern(relativePath, added)
    ) {
      return {
        allowed: false,
        filePath: relativePath,
        reason: `File matches user-protected pattern: ${added}`,
        matchedPattern: added,
      };
    }
  }

  // Check default patterns
  for (const pattern of config.protectedPatterns) {
    if (
      matchesPattern(filename, pattern) ||
      matchesPattern(relativePath, pattern)
    ) {
      return {
        allowed: false,
        filePath: relativePath,
        reason: `File matches sensitive pattern: ${pattern}`,
        matchedPattern: pattern,
      };
    }
  }

  return { allowed: true, filePath: relativePath, reason: null, matchedPattern: null };
}

/**
 * Check multiple files at once. Returns all blocked files.
 */
export function checkBatchFileAccess(
  files: string[],
  projectRoot: string
): {
  allAllowed: boolean;
  blockedFiles: GuardrailCheckResult[];
  allowedFiles: GuardrailCheckResult[];
} {
  const results = files.map((f) => checkFileAccess(f, projectRoot));
  const blockedFiles = results.filter((r) => !r.allowed);
  const allowedFiles = results.filter((r) => r.allowed);

  return {
    allAllowed: blockedFiles.length === 0,
    blockedFiles,
    allowedFiles,
  };
}

/**
 * Format guardrail check results for display.
 */
export function formatGuardrailBlock(
  results: GuardrailCheckResult[]
): string {
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length === 0) return "  Guardrails: All files allowed";

  const lines: string[] = [];
  lines.push(`  GUARDRAIL BLOCK: ${blocked.length} file(s) protected`);
  for (const r of blocked) {
    lines.push(`    BLOCKED: ${r.filePath}`);
    lines.push(`      Reason: ${r.reason}`);
  }
  return lines.join("\n");
}
