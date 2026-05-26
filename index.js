const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const qrcode = require("qrcode-terminal");

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("auth_info");

  const { version } =
    await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ["Windows", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on(
    "connection.update",
    async (update) => {

      const {
        connection,
        qr
      } = update;

      // Show QR
      if (qr) {
        console.log("📱 Scan QR:");
        qrcode.generate(qr, {
          small: true
        });
      }

      // Connected
      if (connection === "open") {

  console.log(
    "✅ WhatsApp Connected"
  );

  // Create Group
  const group =
    await sock.groupCreate(
      "YourEA - {username}",
      [
        "{phone}@s.whatsapp.net"
      ]
    );

  console.log(
    "✅ Group Created"
  );

  console.log(group);
}

      if (connection === "close") {
        console.log(
          "❌ Disconnected"
        );
        startBot();
      }
    }
  );
}

startBot();