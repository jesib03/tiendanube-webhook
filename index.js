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
const TN_TOKEN = process.env.TN_TOKEN;

// Google Sheets
const SHEET_ID = "1DQCp7OsVgz3h6pI5Ho7fqzEy3t9fS-vyvDlbsw2M1GA";

/* ======================================================
   🔐 GOOGLE SHEETS AUTH
====================================================== */
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

/* ======================================================
   🛒 TIENDA NUBE API
====================================================== */
async function getOrderById(orderId) {
  const url = `${TN_API}/${STORE_ID}/orders/${orderId}`;

  const response = await axios.get(url, {
    headers: {
      Authentication: `bearer ${TN_TOKEN}`,
      "User-Agent": "tiendanube-webhook",
    },
  });

  return response.data;
}

/* ======================================================
   🔍 HELPERS GOOGLE SHEETS
====================================================== */
async function getSheetValues(sheets, range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  return res.data.values || [];
}

/* ======================================================
   🚫 DUPLICADOS (order_id + event)
====================================================== */
async function isDuplicateOrderEvent(sheets, orderId, event) {
  const rows = await getSheetValues(sheets, "orders!A:C");
  return rows.some(
    r => r[0] === String(orderId) && r[2] === event
  );
}

/* ======================================================
   📦 UPDATE STOCK (products)
====================================================== */
async function updateProductStock(sheets, variantId, deltaReal, deltaReservado) {
  const rows = await getSheetValues(sheets, "products!A:H");

  const rowIndex = rows.findIndex(
    r => String(r[0]) === String(variantId)
  );

  if (rowIndex === -1) {
    console.warn(`⚠️ Variant ${variantId} no existe en products`);
    return;
  }

  const stockReal = Number(rows[rowIndex][3] || 0);
  const stockReservado = Number(rows[rowIndex][4] || 0);

  const newReal = stockReal + deltaReal;
  const newReservado = stockReservado + deltaReservado;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `products!D${rowIndex + 1}:E${rowIndex + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[newReal, newReservado]],
    },
  });
}

/* ======================================================
   🔔 WEBHOOK
====================================================== */
app.post("/webhook", async (req, res) => {
  const { id: orderId, event } = req.body;
  console.log(`🔔 WEBHOOK ${event} ${orderId}`);

  try {
    const sheets = await getSheets();

    if (await isDuplicateOrderEvent(sheets, orderId, event)) {
      console.log("⏭️ Evento duplicado ignorado");
      return res.json({ ignored: true });
    }

    const order = await getOrderById(orderId);

    /* ======================
       📝 ORDERS
    ====================== */
    const orderRow = [[
      String(order.id),
      event === "order/paid" ? "paid" : order.status,
      event,
      order.created_at || "",
      order.paid_at || "",
      new Date().toISOString(),
      event === "order/paid",   // stock_discounted
      event === "order/created" // stock_reserved
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "orders!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: orderRow },
    });

    /* ======================
       📦 ITEMS + STOCK
    ====================== */
    for (const item of order.products) {
      const qty = Number(item.quantity);
      const variantId = item.variant_id;

      if (event === "order/created") {
        await updateProductStock(sheets, variantId, 0, qty);
      }

      if (event === "order/paid") {
        await updateProductStock(sheets, variantId, -qty, -qty);
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "order_items!A:F",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            crypto.randomUUID(),
            String(order.id),
            variantId,
            qty,
            item.price,
            event
          ]],
        },
      });
    }

    console.log(`✅ Orden sincronizada: ${orderId}`);
    res.json({ success: true });

  } catch (err) {
    console.error("❌ Error en webhook:", err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   🚀 SERVER
====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
