const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const local = path.join(
  process.cwd(),
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python =
  process.env.MACRO_PYTHON ||
  (existsSync(local)
    ? local
    : process.platform === "win32"
      ? "python"
      : "python3");
const r = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "tests", "-v"],
  { stdio: "inherit" },
);
if (r.error) console.error(r.error.message);
if (r.status !== 0) process.exit(r.status ?? 1);
const shortcuts = spawnSync(
  process.execPath,
  ["--test", "tests/shortcuts.test.cjs"],
  { stdio: "inherit" },
);
process.exit(shortcuts.status ?? 1);
