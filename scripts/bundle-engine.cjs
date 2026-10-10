const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { existsSync } = require("node:fs");
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
const backend =
  process.platform === "win32"
    ? "win32"
    : process.platform === "darwin"
      ? "darwin"
      : "xorg";
const args = [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onedir",
  "--name",
  "macro-engine",
  "--distpath",
  "engine-dist",
  "--workpath",
  "work/engine-build",
  "--specpath",
  "work",
  "--paths",
  "engine",
  "--hidden-import",
  `pynput.keyboard._${backend}`,
  "--hidden-import",
  `pynput.mouse._${backend}`,
  "engine/service.py",
];
const r = spawnSync(python, args, { stdio: "inherit" });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
