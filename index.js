import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import crypto from "crypto";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

/* ======================================================
   🌐 CONFIG
====================================================== */
const PORT = process.env.PORT || 3000;

// Tienda Nube
const TN_API = "https://api.tiendanube.com/v1";
const STORE_ID = process.env.TIENDANUBE_STORE_ID;
const TN_TOKEN = process.env.TIENDANUBE_TOKEN;

// Google Sheets
const SHEET_ID = "1DQCp7OsVgz3h6pI5Ho7fqzEy3t9fS-vyvDlbsw2M1GA";

/* ======================================================
   ✅ HEALTH CHECK
====================================================== */
app.get("/", (req, res) => {
  res.send("✅ Webhook Tienda Nube activo");
});

/* ======================================================
   🔔 WEBHOOK ENDPOINT
====================================================== */
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 WEBHOOK RECIBIDO");
    console.log(req.body);

    const { id: orderId, event } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "Missing order id" });
    }

    await syncOrderById(orderId, event);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error en webhook:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ======================================================
   🚀 SERVER
====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

/* ======================================================
   🔐 GOOGLE SHEETS AUTH
====================================================== */
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

async function getSheets() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

/* ======================================================
   🛒 TIENDA NUBE API
====================================================== */
async function getOrderById(orderId) {
  const url = `${TN_API}/${STORE_ID}/orders/${orderId}`;

  const response = await axios.get(url, {
    headers: {
      Authentication: `bearer ${TN_TOKEN}`,
      "User-Agent": "tiendanube-webhook"
    }
  });

  return response.data;
}

/* ======================================================
   🔄 SYNC ORDER BY ID
====================================================== */
async function syncOrderById(orderId, event) {
  console.log("📦 Sincronizando orden:", orderId);

  const order = await getOrderById(orderId);

  const sheets = await getSheets();

  /* ---------- ORDERS ---------- */
  const orderRow = [[
  String(order.id),                 // order_id
  order.status || "",               // status
  order.created_at || "",           // created_at
  order.paid_at || "",              // paid_at
  order.shipped_at || "",           // shipped_at
  order.updated_at || new Date().toISOString(), // updated_at
  order.stock_discounted ?? false,  // stock_discounted
  order.stock_reserved ?? false     // stock_reserved
]];

await sheets.spreadsheets.values.append({
  spreadsheetId: SHEET_ID,
  range: "orders!A:H",
  valueInputOption: "USER_ENTERED",
  requestBody: { values: orderRow }
});

  /* ---------- ORDER ITEMS ---------- */
  const itemsRows = order.items.map(item => ([
    crypto.randomUUID(),
    String(order.id),
    item.variant_id || item.product_id,
    item.quantity,
    item.price
  ]));

  if (itemsRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "order_items!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: itemsRows }
    });
  }

  console.log("✅ Orden sincronizada:", orderId);
}







