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
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://hqurzlfogskyagkiyhpi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxdXJ6bGZvZ3NreWFna2l5aHBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzM2ODQsImV4cCI6MjA5NDg0OTY4NH0.QSvjI2a5kunltdp3Om9HvC4F16ezPnVHASjaY9_T1Q0";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
  let userId = req.body.user_id;

  // try {
  //   // if (!userId) {
  //   //   return res.status(400).json({
  //   //     success: false,
  //   //     error: "user_id is required"
  //   //   });
  //   }

    if (!sock || !sock.user) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp not connected. Please scan QR first."
      });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const userName = user.name || user["Full name"] || "User";
    const phone = user.Mobile || user.mobile || user.phone;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "User phone number missing"
      });
    }

    if (user.wa_group_created === true) {
      return res.json({
        success: true,
        message: "Group already created",
        group_id: user.wa_group_id,
        group_name: user.wa_group_name
      });
    }

    const { data: membersData, error: memberError } = await supabase
      .from("whatsapp_members")
      .select("*")
      .eq("is_active", true);

    if (memberError) {
      console.log("Member fetch error:", memberError.message);
    }

    const teamMembers = (membersData || [])
      .filter(member => member.mobile)
      .map(member => {
        const number = member.mobile.toString().replace(/\D/g, "");
        return `91${number}@s.whatsapp.net`;
      });

    const cleanUserPhone = phone.toString().replace(/\D/g, "");
    const userPhone = `91${cleanUserPhone}@s.whatsapp.net`;

    const allMembers = [...teamMembers, userPhone];
    const uniqueMembers = [...new Set(allMembers)];

    const validParticipants = [];

    for (const jid of uniqueMembers) {
      const number = jid.split("@")[0];
      const check = await sock.onWhatsApp(number);

      if (check && check.length) {
        validParticipants.push(jid);
      } else {
        console.log("❌ Invalid WhatsApp:", jid);
      }
    }

    if (validParticipants.length < 1) {
      return res.status(400).json({
        success: false,
        error: "No valid WhatsApp participants found"
      });
    }

    const groupName = `YourEA - ${userName}`;

    const group = await sock.groupCreate(groupName, validParticipants);

    await sock.sendMessage(group.id, {
      text: `Hi ${userName} 👋

Welcome to YourEA!

We're excited to have you onboard.

This group will be used for:
✅ Updates
✅ Support
✅ Communication

Team YourEA 🚀`
    });

    const { error: updateError } = await supabase
      .from("users")
      .update({
        wa_group_id: group.id,
        wa_group_name: groupName,
        wa_group_created: true,
        wa_group_created_at: new Date().toISOString(),
        wa_welcome_sent: true,
        wa_last_error: null
      })
      .eq("id", user.id);

    if (updateError) {
      console.log("Update error:", updateError.message);
    }

    return res.json({
      success: true,
      message: "Group created successfully",
      group_id: group.id,
      group_name: groupName
    });

  } catch (err) {
    console.log("Create group error:", err.message);

    if (userId) {
      await supabase
        .from("users")
        .update({
          wa_last_error: err.message
        })
        .eq("id", userId);
    }

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
app.post("/add-number-to-bulk-groups", async (req, res) => {
  try {
    const { groupIds, name, phone, user_id } = req.body;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "groupIds array required"
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone required"
      });
    }

    if (!sock || !sock.user) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp not connected"
      });
    }

    const cleanPhone = String(phone).replace(/\D/g, "");

    const whatsappNumber = cleanPhone.startsWith("91")
      ? `${cleanPhone}@s.whatsapp.net`
      : `91${cleanPhone}@s.whatsapp.net`;

    const results = [];

    for (const groupId of groupIds) {
      try {
        const waResult = await sock.groupParticipantsUpdate(
          groupId,
          [whatsappNumber],
          "add"
        );

        const { data: existing } = await supabase
          .from("whatsapp_members")
          .select("id")
          .eq("wa_group_id", groupId)
          .eq("mobile", cleanPhone)
          .maybeSingle();

        if (!existing) {
          const { error: insertError } = await supabase
            .from("whatsapp_members")
            .insert({
              user_id: user_id || null,
              wa_group_id: groupId,
              name: name || null,
              mobile: cleanPhone,
              role: "member",
              is_active: true,
              added_at: new Date().toISOString()
            });

          if (insertError) {
            results.push({
              groupId,
              success: false,
              message: "WhatsApp me add ho gaya, but Supabase insert failed",
              error: insertError.message
            });
            continue;
          }
        }

        results.push({
          groupId,
          success: true,
          message: existing
            ? "Already saved in Supabase"
            : "Added and saved successfully",
          whatsappResult: waResult
        });

      } catch (error) {
        results.push({
          groupId,
          success: false,
          message: "Failed to add in this group",
          error: error.message
        });
      }
    }

    return res.json({
      success: true,
      message: "Bulk group add completed",
      phone: cleanPhone,
      results
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/remove-number-from-bulk-groups", async (req, res) => {
  try {
    const { groupIds, phone } = req.body;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0 || !phone) {
      return res.status(400).json({
        success: false,
        message: "groupIds array and phone required"
      });
    }

    const cleanPhone = phone.replace(/\D/g, "");

    const whatsappNumber = cleanPhone.startsWith("91")
      ? `${cleanPhone}@s.whatsapp.net`
      : `91${cleanPhone}@s.whatsapp.net`;

    const results = [];

    for (const groupId of groupIds) {
      try {
        const waResult = await sock.groupParticipantsUpdate(
          groupId,
          [whatsappNumber],
          "remove"
        );

        const { error } = await supabase
          .from("whatsapp_members")
          .update({
            is_active: false
          })
          .eq("wa_group_id", groupId)
          .eq("mobile", cleanPhone);

        results.push({
          groupId,
          success: !error,
          message: error
            ? "WhatsApp se remove ho gaya, Supabase update failed"
            : "Removed successfully",
          error: error?.message || null,
          whatsappResult: waResult
        });

      } catch (err) {
        results.push({
          groupId,
          success: false,
          message: "Failed to remove from this group",
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      message: "Bulk remove completed",
      phone: cleanPhone,
      results
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server on :${PORT}`);
  startSock().catch((e) => console.error("startSock failed:", e));
});
