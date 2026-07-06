const express = require("express");
const axios = require("axios");
const QRCode = require("qrcode");
const pino = require("pino");
const path = require("path");
const cors = require("cors");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
let sock;
let isConnected = false;
let qrCodeDataUrl = null;

let SHEET_ID = "1-BQAJSSu4sdwsFewDYxwD_-UzCIigB99C0ARq9SZgdA";
let SHEET_GID = "0";

function getSheetCsvUrl() {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
}

function parseSheetUrl(url) {
  const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;

  const gidMatch = url.match(/gid=([0-9]+)/);

  return {
    id: idMatch[1],
    gid: gidMatch ? gidMatch[1] : "0",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvToJson(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const obj = {};

    headers.forEach((header, index) => {
      obj[header] = values[index] ? values[index].trim() : "";
    });

    return obj;
  });
}

async function getSheetData() {
  const response = await axios.get(getSheetCsvUrl());
  const data = csvToJson(response.data);

  return data.filter((row) => {
    return (
      row.Name ||
      row.name ||
      row.Phone ||
      row.phone ||
      row.Mobile ||
      row.mobile ||
      row.Company ||
      row.company
    );
  });
}

function personalizeMessage(template, { name, company }) {
  return template
    .replace(/{{\s*name\s*}}/gi, name || "Friend")
    .replace(/{{\s*company\s*}}/gi, company || "your company");
}

const DEFAULT_MESSAGE_TEMPLATE = `Hey {{name}},

Just wanted to share something I've been working on. 😊

We've launched YourEA—an executive assistant service that helps busy professionals save time by taking care of the work that slows them down.

Sharing our social pages below. Would love for you to check them out and follow if you find it relevant.

𝕏 : https://x.com/YourEA_official

LinkedIn: https://www.linkedin.com/company/yourea/

Instagram: https://www.instagram.com/yourea.official?igsh=MTd2NHVtaHZnd2Jkeg==

Shriram Sharma (CA, CFA, FRM)
Founder - YourEA`;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

    // QR only set once, so frontend will not keep changing fast
    if (qr && !qrCodeDataUrl) {
      try {
        qrCodeDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          scale: 6,
        });
        console.log("📱 QR code ready");
      } catch (err) {
        console.log("QR generation error:", err.message);
      }
    }

    if (connection === "open") {
      isConnected = true;
      qrCodeDataUrl = null;
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      isConnected = false;
      qrCodeDataUrl = null;

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("❌ Connection Closed");

      if (shouldReconnect) {
        setTimeout(() => {
          startWhatsApp();
        }, 5000);
      }
    }
  });
}

app.get("/status", (req, res) => {
  res.json({
    connected: isConnected,
  });
});

app.get("/qr", (req, res) => {
  if (isConnected) {
    return res.json({
      connected: true,
      qr: null,
    });
  }

  res.json({
    connected: false,
    qr: qrCodeDataUrl,
  });
});

app.post("/set-sheet", (req, res) => {
  const { sheetUrl } = req.body || {};

  if (!sheetUrl) {
    return res.status(400).json({
      success: false,
      message: "sheetUrl is required",
    });
  }

  const parsed = parseSheetUrl(sheetUrl);

  if (!parsed) {
    return res.status(400).json({
      success: false,
      message: "Couldn't read spreadsheet ID from that URL.",
    });
  }

  SHEET_ID = parsed.id;
  SHEET_GID = parsed.gid;

  res.json({
    success: true,
    message: "Sheet updated",
    sheetId: SHEET_ID,
    gid: SHEET_GID,
  });
});

app.get("/preview-sheet", async (req, res) => {
  try {
    const rows = await getSheetData();

    res.json({
      success: true,
      count: rows.length,
      rows: rows.slice(0, 25),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/send-from-google-sheet", async (req, res) => {
  try {
    if (!isConnected || !sock) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp not connected",
      });
    }

    const { message, sheetUrl } = req.body || {};

    if (sheetUrl) {
      const parsed = parseSheetUrl(sheetUrl);
      if (parsed) {
        SHEET_ID = parsed.id;
        SHEET_GID = parsed.gid;
      }
    }

    const template =
      typeof message === "string" && message.trim().length > 0
        ? message
        : DEFAULT_MESSAGE_TEMPLATE;

    const rows = await getSheetData();

    console.log(`Total Records: ${rows.length}`);

    const results = [];

    for (const row of rows) {
      try {
        const phone = String(
          row.Phone || row.phone || row.Mobile || row.mobile || ""
        ).replace(/\D/g, "");

        const name = row.Name || row.name || "Friend";
        const company = row.Company || row.company || "your company";

        if (!phone) {
          results.push({
            name,
            phone,
            status: "skipped",
            reason: "Phone missing",
          });
          continue;
        }

        const whatsappNumber = phone.startsWith("91")
          ? `${phone}@s.whatsapp.net`
          : `91${phone}@s.whatsapp.net`;

        const text = personalizeMessage(template, {
          name,
          company,
        });

        await sock.sendMessage(whatsappNumber, { text });

        console.log(`✅ Sent to ${name} (${phone})`);

        results.push({
          name,
          phone,
          status: "sent",
        });

        await sleep(30000);
      } catch (err) {
        results.push({
          name: row.Name || row.name || "",
          phone: row.Phone || row.phone || row.Mobile || row.mobile || "",
          status: "failed",
          error: err.message,
        });
      }
    }

    res.json({
      success: true,
      totalSheetRecords: rows.length,
      totalProcessed: results.length,
      results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

startWhatsApp();

app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});