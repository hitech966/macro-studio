const fs = require("node:fs");
const path = require("node:path");
class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }
  file(name) {
    return path.join(this.directory, name + ".json");
  }
  read(name, fallback) {
    const file = this.file(name);
    for (const candidate of [file, file + ".bak"]) {
      try {
        return JSON.parse(fs.readFileSync(candidate, "utf8"));
      } catch {}
    }
    return fallback;
  }
  write(name, value) {
    const file = this.file(name),
      temp = file + ".tmp";
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > 8_000_000)
      throw new Error("Library exceeds 8 MB limit");
    const fd = fs.openSync(temp, "w", 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
    fs.renameSync(temp, file);
  }
  remove(name) {
    for (const suffix of ["", ".bak", ".tmp"]) {
      try {
        fs.unlinkSync(this.file(name) + suffix);
      } catch {}
    }
  }
}
module.exports = { Store };
