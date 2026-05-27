// WhatsApp Bot Backend — Baileys + Express
// Endpoints: GET /status  POST /pair  POST /logout  POST /create-group
import express from "express";
import cors from "cors";
import qrcode from "qrcode";
import pino from "pino";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || "./auth_info";

const app = express();
app.use(cors());
app.use(express.json());

let sock = null;
let state = {
  status: "disconnected", // disconnected | connecting | qr | connected
  connected: false,
  qr: null,                // data URL
  pairingCode: null,
  user: null,
};

async function startSock() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["WA-Bot", "Chrome", "1.0"],
  });

  state.status = "connecting";

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        state.qr = await qrcode.toDataURL(qr);
        state.status = "qr";
        state.connected = false;
      } catch (e) {
        console.error("QR encode failed:", e);
      }
    }

    if (connection === "open") {
      state.status = "connected";
      state.connected = true;
      state.qr = null;
      state.pairingCode = null;
      state.user = sock.user ? { id: sock.user.id, name: sock.user.name } : null;
      console.log("✅ WhatsApp connected:", state.user?.id);
    }

    if (connection === "close") {
      state.connected = false;
      state.user = null;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("❌ Connection closed. Reconnect:", shouldReconnect);
      state.status = shouldReconnect ? "connecting" : "disconnected";
      if (shouldReconnect) setTimeout(startSock, 2000);
    }
  });
}

// ---------- Routes ----------
app.get("/", (_req, res) => res.json({ ok: true, service: "wa-bot" }));

app.get("/status", (_req, res) => res.json(state));

app.post("/pair", async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ success: false, error: "phone required" });
    if (!sock) return res.status(503).json({ success: false, error: "socket not ready" });
    if (state.connected) return res.status(400).json({ success: false, error: "already connected" });

    const code = await sock.requestPairingCode(String(phone).replace(/\D/g, ""));
    state.pairingCode = code;
    res.json({ success: true, code });
  } catch (e) {
    console.error("pair error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/logout", async (_req, res) => {
  try {
    if (sock) await sock.logout().catch(() => {});
    state = { status: "disconnected", connected: false, qr: null, pairingCode: null, user: null };
    setTimeout(startSock, 1000);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/create-group", async (req, res) => {
  try {
    const { user_id, name } = req.body || {};
    if (!user_id) return res.status(400).json({ success: false, error: "user_id required" });
    if (!state.connected || !sock) {
      return res.status(503).json({ success: false, error: "WhatsApp not connected" });
    }
    const groupName = name || `Group-${user_id.slice(0, 8)}`;
    const me = sock.user?.id?.split(":")[0];
    if (!me) return res.status(500).json({ success: false, error: "no self id" });

    const result = await sock.groupCreate(groupName, [`${me}@s.whatsapp.net`]);
    res.json({ success: true, group_id: result.id, name: groupName });
  } catch (e) {
    console.error("create-group error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server on :${PORT}`);
  startSock().catch((e) => console.error("startSock failed:", e));
});
