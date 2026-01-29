const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { loadEnv } = require("./env");
const { verifyTelegramInitData } = require("./telegramAuth");
const { createSocketServer } = require("./socketServer");

loadEnv();

const PORT = process.env.PORT || 8081;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ALLOW_ANON = process.env.TELEGRAM_ALLOW_ANON === "true";
const TELEGRAM_AUTH_MAX_AGE_SEC =
  Number(process.env.TELEGRAM_AUTH_MAX_AGE_SEC) || 0;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use((req, res, next) => {
  // Simple CORS for miniapp -> socket server.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

io.use((socket, next) => {
  // Optional Telegram auth at connection time.
  const initData =
    socket.handshake &&
    socket.handshake.auth &&
    socket.handshake.auth.initData
      ? String(socket.handshake.auth.initData)
      : "";

  if (!initData) {
    if (TELEGRAM_ALLOW_ANON) {
      socket.data.telegram = { ok: false };
      return next();
    }
    return next(new Error("unauthorized"));
  }

  const result = verifyTelegramInitData(
    initData,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_AUTH_MAX_AGE_SEC,
  );
  if (!result.ok) {
    if (TELEGRAM_ALLOW_ANON) {
      socket.data.telegram = { ok: false };
      return next();
    }
    return next(new Error("unauthorized"));
  }

  socket.data.telegram = result;
  if (result.user) {
    socket.data.user = result.user;
  }
  return next();
});

createSocketServer(io);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Socket server listening on http://localhost:${PORT}`);
});
