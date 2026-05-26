const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const { createClient } =
require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// Supabase Config
const supabase = createClient(
  "https://hqurzlfogskyagkiyhpi.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxdXJ6bGZvZ3NreWFna2l5aHBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzM2ODQsImV4cCI6MjA5NDg0OTY4NH0.QSvjI2a5kunltdp3Om9HvC4F16ezPnVHASjaY9_T1Q0"
);

let sock;

// WhatsApp Connect
async function startBot() {

  const { state, saveCreds } =
    await useMultiFileAuthState(
      "auth_info"
    );

  const { version } =
    await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state
  });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  sock.ev.on(
    "connection.update",
    ({ connection }) => {

      if (
        connection === "open"
      ) {
        console.log(
          "✅ WhatsApp Connected"
        );
      }
    }
  );
}

startBot();

// Home Route
app.get("/", (req, res) => {
  res.send("Server Working ✅");
});

// Create Group Route
app.get(
  "/create-group",
  async (req, res) => {

    try {

      // Fetch latest new user
      const {
        data,
        error
      } = await supabase
        .from("users")
        .select("*")
        .is(
          "wa_group_created",
          null
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        )
        .limit(1);

      console.log(
        "User Data:",
        data
      );

      if (
        error ||
        !data.length
      ) {
        return res.json({
          message:
            "No new users found"
        });
      }

      const user =
        data[0];

      const userName =
        user.name;

      const phone =
        user.Mobile;

      if (!phone) {
        return res.json({
          error:
            "Phone number missing"
        });
      }

      if (!sock?.user) {
        return res.json({
          error:
            "WhatsApp not connected"
        });
      }

      // Fetch Team Members from Supabase
      // Fetch Team Members
const {
  data: membersData,
  error: memberError
} = await supabase
  .from("whatsapp_members")
  .select("*")
  .eq(
    "is_active",
    true
  );

  console.log(
  "Members Data:",
  membersData
);

console.log(
  "Member Error:",
  memberError
);

if (memberError) {
  console.log(
    "Member Error:",
    memberError
  );
}

// Team members numbers
const teamMembers =
  (membersData || [])
  .map(member =>
    `91${member.mobile.replace(/\D/g, "")}@s.whatsapp.net`
  );

// Registered user
const userPhone =
  `91${phone.replace(/\D/g, "")}@s.whatsapp.net`;

// Combine all members
const allMembers = [
  ...teamMembers,
  userPhone
];

// Remove duplicate numbers
const uniqueMembers =
  [...new Set(allMembers)];

console.log(
  "Before Validation:",
  uniqueMembers
);


// Validate WhatsApp numbers
const validParticipants = [];

for (const jid of uniqueMembers) {

  const number =
    jid.split("@")[0];

  const check =
    await sock.onWhatsApp(number);

  if (
    check &&
    check.length
  ) {
    validParticipants.push(
      jid
    );
  } else {
    console.log(
      "❌ Invalid WhatsApp:",
      jid
    );
  }
}

console.log(
  "Valid Members:",
  validParticipants
);

// Create Group
const group =
  await sock.groupCreate(
    `YourEA - ${userName}`,
    validParticipants
  );

console.log(
  "✅ Group Created:",
  group
);
      // Send Welcome Message
      await sock.sendMessage(
        group.id,
        {
          text:
`Hi ${userName} 👋

Welcome to YourEA!

We're excited to have you onboard.

This group will be used for:
✅ Updates
✅ Support
✅ Communication

Team YourEA 🚀`
        }
      );

      console.log(
        "✅ Welcome Message Sent"
      );

      // Update Supabase
      const {
        data: updateData,
        error: updateError
      } = await supabase
        .from("users")
        .update({
          wa_group_id:
            group.id,

          wa_group_name:
            `YourEA - ${userName}`,

          wa_group_created:
            true,

          wa_group_created_at:
            new Date().toISOString(),

          wa_welcome_sent:
            true,

          wa_last_error:
            null
        })
        .eq(
          "id",
          user.id
        )
        .select();

      console.log(
        "Updated:",
        updateData
      );

      console.log(
        "Update Error:",
        updateError
      );

      res.json({
        success: true,
        message:
          "Group created & DB updated",
        group:
          `YourEA - ${userName}`
      });

    } catch (err) {

      console.log(
        "Error:",
        err
      );

      // Save error in DB
      await supabase
        .from("users")
        .update({
          wa_last_error:
            err.message
        });

      res.status(500).json({
        error:
          err.message
      });
    }
  }
);
app.listen(
  3000,
  () => {
    console.log(
      "🚀 Server running on 3000"
    );
  }
);