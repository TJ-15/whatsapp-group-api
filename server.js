const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode-terminal");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const supabase = createClient(
 SUPABASE_URL = "https://hqurzlfogskyagkiyhpi.supabase.co",
  SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxdXJ6bGZvZ3NreWFna2l5aHBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzM2ODQsImV4cCI6MjA5NDg0OTY4NH0.QSvjI2a5kunltdp3Om9HvC4F16ezPnVHASjaY9_T1Q0"
);

let sock;

// WhatsApp connect
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ["Windows", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, qr }) => {
    if (qr) {
      console.log("📱 Scan this QR:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      console.log("❌ WhatsApp Disconnected. Reconnecting...");
      startBot();
    }
  });
}

startBot();

app.get("/", (req, res) => {
  res.send("Server Working ✅");
});

// Create WhatsApp group after registration
app.post("/create-group", async (req, res) => {
  let userId = req.body.user_id;

  try {
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "user_id is required"
      });
    }

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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
