import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import crypto from "crypto";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const STORE_ID = process.env.TIENDANUBE_STORE_ID;
const TN_TOKEN = process.env.TN_TOKEN;
const SHEET_ID = "1DQCp7OsVgz3h6pI5Ho7fqzEy3t9fS-vyvDlbsw2M1GA";

// ================= Google Sheets Auth =================
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

// ================= Test Auth =================
app.get("/test-auth", async (req, res) => {
  try {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "orders!A:A",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["TEST AUTH OK", new Date().toISOString()]] },
    });
    res.send("✅ AUTH OK — escritura exitosa");
  } catch (err) {
    console.error("❌ AUTH ERROR DETALLE:", err.response?.data || err.message);
    res.status(500).send("❌ AUTH ERROR");
  }
});

// ================= Webhook =================
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 WEBHOOK RECIBIDO");
    console.log(req.body);

    const { id: orderId, event } = req.body;
    if (!orderId) return res.status(400).json({ error: "Missing order id" });

    const order = await getOrderById(orderId);
    const sheets = await getSheets();

    // Orders
    const orderRow = [[
      String(order.id),
      order.status || "",
      order.created_at || "",
      order.paid_at || "",
      order.shipped_at || "",
      order.updated_at || new Date().toISOString(),
      order.stock_discounted ?? false,
      order.stock_reserved ?? false
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "orders!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: orderRow }
    });

    // Order Items
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
    res.json({ success: true });

  } catch (error) {
    console.error("❌ Error en webhook:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ================= Tienda Nube API =================
async function getOrderById(orderId) {
  const url = `https://api.tiendanube.com/v1/${STORE_ID}/orders/${orderId}`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${TN_TOKEN}`, // Esto es clave, no Authentication
      "User-Agent": "tiendanube-webhook"
    }
  });

  return response.data;
}

// ================= Server =================
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});









