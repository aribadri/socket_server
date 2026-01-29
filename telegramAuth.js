const crypto = require("crypto");

const parseTelegramInitData = (initData) => {
  // Build data_check_string per Telegram WebApp auth docs.
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  const dataPairs = [];
  params.forEach((value, key) => {
    if (key === "hash") return;
    dataPairs.push(`${key}=${value}`);
  });
  dataPairs.sort();
  const dataCheckString = dataPairs.join("\n");
  let user = null;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch (err) {
      user = null;
    }
  }
  const authDate = Number(params.get("auth_date")) || 0;
  return { hash, dataCheckString, user, authDate };
};

const verifyTelegramInitData = (initData, botToken, maxAgeSec = 0) => {
  // Validate signature and (optionally) auth_date freshness.
  if (!botToken) return { ok: false, code: "missing_bot_token" };
  if (!initData) return { ok: false, code: "missing_init_data" };
  const { hash, dataCheckString, user, authDate } =
    parseTelegramInitData(initData);
  if (!hash || !dataCheckString) return { ok: false, code: "invalid_format" };
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  if (expectedHash !== hash) return { ok: false, code: "invalid_hash" };
  if (maxAgeSec > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (!authDate || now - authDate > maxAgeSec) {
      return { ok: false, code: "expired" };
    }
  }
  return { ok: true, user, authDate };
};

module.exports = {
  parseTelegramInitData,
  verifyTelegramInitData,
};
