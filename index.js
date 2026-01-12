import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

// ===============================
// 🔐 Google Sheets Auth
// ===============================
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const SHEET_ID = "1DQCp7OsVgz3h6pI5Ho7fqzEy3t9fS-vyvDlbsw2M1GA";

async function getSheets() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ===============================
// 🔄 SYNC ORDER
// ===============================
async function syncOrder(order) {
  const sheets = await getSheets();

  const orderId = String(order.id);

  // ---------- ORDERS ----------
  const ordersRow = [
    orderId,
    order.status || "",
    order.paid_at || "",
    order.shipped_at || "",
    new Date().toISOString(),
    false,
    false
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "orders!A:G",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [ordersRow]
    }
  });

  // ---------- ORDER ITEMS ----------
  const itemsRows = order.items.map(item => ([
    crypto.randomUUID(),
    orderId,
    item.variant_id || item.product_id,
    item.quantity,
    item.price
  ]));

  if (itemsRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "order_items!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: itemsRows
      }
    });
  }
}

// ===============================
// 🔔 WEBHOOK
// ===============================
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 WEBHOOK RECIBIDO");
    console.log("Order ID:", req.body.id);

    await syncOrder(req.body);

    res.json({ success: true });
  } catch (error) {
    console.error("❌ ERROR:", error.message);
    res.status(500).json({ success: false });
  }
});

// ===============================
app.listen(3000, () => {
  console.log("🚀 Server listening on port 3000");
});




