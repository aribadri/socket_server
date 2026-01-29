const fs = require("fs");
const path = require("path");

const loadEnv = () => {
  // Lightweight .env loader for local dev / VPS.
  const envPath = path.resolve(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...rest] = trimmed.split("=");
    if (!key) return;
    const value = rest.join("=").trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

module.exports = { loadEnv };
