import 'dotenv/config';
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import crypto from "crypto";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

/* =========================
   🌐 CONFIG
========================= */
const PORT = process.env.PORT || 3000;
const TN_API = "https://api.tiendanube.com/v1";
const STORE_ID = process.env.TIENDANUBE_STORE_ID;
const TN_TOKEN = process.env.TN_TOKEN;
const SHEET_ID = "1DQCp7OsVgz3h6pI5Ho7fqzEy3t9fS-vyvDlbsw2M1GA";

/* =========================
   🔐 GOOGLE AUTH
========================= */
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function getSheets() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

/* =========================
   🛒 TIENDA NUBE
========================= */
async function getOrderById(orderId) {
  const url = `${TN_API}/${STORE_ID}/orders/${orderId}`;

  const res = await axios.get(url, {
    headers: {
      Authentication: `bearer ${TN_TOKEN}`,
      "User-Agent": "tiendanube-webhook"
    }
  });

  return res.data;
}

/* =========================
   🔔 WEBHOOK
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const { id: orderId, event } = req.body;

    console.log("🔔 WEBHOOK", event, orderId);

    if (!orderId) {
      return res.status(400).json({ error: "Missing order id" });
    }

    const order = await getOrderById(orderId);
    const sheets = await getSheets();

    /* -------- ORDERS -------- */
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "orders!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          String(order.id),
          order.status,
          order.created_at,
          order.paid_at,
          order.shipped_at,
          order.updated_at,
          order.stock_discounted,
          order.stock_reserved
        ]]
      }
    });

    /* -------- ITEMS -------- */
    const items = order.products.map(p => ([
      crypto.randomUUID(),
      String(order.id),
      p.variant_id,
      p.quantity,
      p.price
    ]));

    if (items.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "order_items!A:E",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: items }
      });
    }

    console.log("✅ Orden sincronizada:", orderId);
    res.json({ success: true });

  } catch (err) {
    console.error("❌ Webhook error", err.response?.data || err.message);
    res.status(500).json({ error: "Webhook failed" });
  }
});

/* ========================= */
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});









