/**
 * Auto-detect project configuration.
 * Finds verification commands (test, build, lint, type-check) by scanning
 * project files like package.json, Makefile, pyproject.toml, etc.
 */

import * as fs from "fs";
import * as path from "path";

export interface ProjectConfig {
  /** Command to run tests */
  testCommand: string | null;
  /** Command to run build */
  buildCommand: string | null;
  /** Command to run linter */
  lintCommand: string | null;
  /** Command to run type checking */
  typeCheckCommand: string | null;
  /** Detected project type */
  projectType: "node" | "python" | "go" | "rust" | "unknown";
  /** Detected package manager */
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "cargo" | "go" | null;
}

/**
 * Auto-detect project verification commands by scanning config files.
 */
export function detectProjectConfig(projectRoot: string): ProjectConfig {
  // Try Node.js project
  const nodeConfig = tryDetectNode(projectRoot);
  if (nodeConfig) return nodeConfig;

  // Try Python project
  const pythonConfig = tryDetectPython(projectRoot);
  if (pythonConfig) return pythonConfig;

  // Try Go project
  const goConfig = tryDetectGo(projectRoot);
  if (goConfig) return goConfig;

  // Try Rust project
  const rustConfig = tryDetectRust(projectRoot);
  if (rustConfig) return rustConfig;

  return {
    testCommand: null,
    buildCommand: null,
    lintCommand: null,
    typeCheckCommand: null,
    projectType: "unknown",
    packageManager: null,
  };
}

function tryDetectNode(root: string): ProjectConfig | null {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts || {};

    // Detect package manager
    let pm: ProjectConfig["packageManager"] = "npm";
    if (fs.existsSync(path.join(root, "bun.lock")) || fs.existsSync(path.join(root, "bun.lockb"))) {
      pm = "bun";
    } else if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
      pm = "pnpm";
    } else if (fs.existsSync(path.join(root, "yarn.lock"))) {
      pm = "yarn";
    }

    const run = pm === "npm" ? "npm run" : pm === "bun" ? "bun run" : pm === "pnpm" ? "pnpm run" : "yarn";

    return {
      testCommand: scripts.test ? `${run} test` : null,
      buildCommand: scripts.build ? `${run} build` : null,
      lintCommand: scripts.lint ? `${run} lint` : null,
      typeCheckCommand: scripts.typecheck
        ? `${run} typecheck`
        : scripts["type-check"]
        ? `${run} type-check`
        : fs.existsSync(path.join(root, "tsconfig.json"))
        ? "npx tsc --noEmit"
        : null,
      projectType: "node",
      packageManager: pm,
    };
  } catch {
    return null;
  }
}

function tryDetectPython(root: string): ProjectConfig | null {
  const pyprojectPath = path.join(root, "pyproject.toml");
  const requirementsPath = path.join(root, "requirements.txt");
  const setupPath = path.join(root, "setup.py");

  if (!fs.existsSync(pyprojectPath) && !fs.existsSync(requirementsPath) && !fs.existsSync(setupPath)) {
    return null;
  }

  return {
    testCommand: "python -m pytest",
    buildCommand: null,
    lintCommand: fs.existsSync(path.join(root, ".flake8")) || fs.existsSync(path.join(root, "ruff.toml"))
      ? "ruff check ."
      : null,
    typeCheckCommand: fs.existsSync(path.join(root, "mypy.ini")) || fs.existsSync(path.join(root, "pyrightconfig.json"))
      ? "mypy ."
      : null,
    projectType: "python",
    packageManager: "pip",
  };
}

function tryDetectGo(root: string): ProjectConfig | null {
  if (!fs.existsSync(path.join(root, "go.mod"))) return null;

  return {
    testCommand: "go test ./...",
    buildCommand: "go build ./...",
    lintCommand: null,
    typeCheckCommand: "go vet ./...",
    projectType: "go",
    packageManager: "go",
  };
}

function tryDetectRust(root: string): ProjectConfig | null {
  if (!fs.existsSync(path.join(root, "Cargo.toml"))) return null;

  return {
    testCommand: "cargo test",
    buildCommand: "cargo build",
    lintCommand: "cargo clippy",
    typeCheckCommand: "cargo check",
    projectType: "rust",
    packageManager: "cargo",
  };
}
