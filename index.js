import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("✅ Webhook Tienda Nube activo");
});


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
app.post("/webhook", (req, res) => {
  console.log("🔔 WEBHOOK RECIBIDO");
  console.log(req.body);

  res.status(200).json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});




