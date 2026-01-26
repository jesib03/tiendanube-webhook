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

async function getAllProducts() {
  let page = 1;
  let allProducts = [];
  let hasMore = true;

  while (hasMore) {
    const url = `${TN_API}/${STORE_ID}/products?page=${page}&per_page=50`;

    const response = await axios.get(url, {
      headers: {
        Authentication: `bearer ${TN_TOKEN}`,
        "User-Agent": "tiendanube-sync",
      },
    });

    const products = response.data;
    allProducts.push(...products);

    if (products.length < 50) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return allProducts;
}

/* ======================================================
   🔍 HELPERS
====================================================== */
async function getSheetValues(sheets, range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });
  return res.data.values || [];
}

async function findOrderRowIndex(sheets, orderId) {
  const rows = await getSheetValues(sheets, "orders!A:A");
  const index = rows.findIndex(r => r[0] === String(orderId));
  return index === -1 ? null : index + 1;
}

async function findProductRowByVariant(sheets, variantId) {
  const rows = await getSheetValues(sheets, "products!A:A");
  const index = rows.findIndex(r => String(r[0]) === String(variantId));
  return index === -1 ? null : index + 1;
}

async function wasOrderPreviouslyShipped(sheets, rowIndex) {
  if (!rowIndex) return false;

  const rows = await getSheetValues(
    sheets,
    `orders!E${rowIndex}:E${rowIndex}` // shipped_at
  );

  return Boolean(rows[0]?.[0]);
}

function isOrderShipped(order) {
  return (
    order.fulfillment_status === "fulfilled" ||
    order.shipping_status === "shipped" ||
    order.status === "shipped"
  );
}

function getLocalizedValue(value, fallback = "") {
  if (!value) return fallback;

  if (typeof value === "string") return value;

  if (typeof value === "object") {
    return (
      value.es ||
      value["es-AR"] ||
      value.pt ||
      value.en ||
      Object.values(value)[0] ||
      fallback
    );
  }

  return fallback;
}

/* ======================================================
   📦 UPDATE STOCK (products)
====================================================== */
async function updateProductStock(sheets, variantId, deltaReal, deltaReservado) {
  const rows = await getSheetValues(sheets, "products!A:H");
  const index = rows.findIndex(r => String(r[0]) === String(variantId));

  if (index === -1) {
    console.warn(`⚠️ Variant ${variantId} no existe en products`);
    return;
  }

  const real = Number(rows[index][3] || 0);
  const reservado = Number(rows[index][4] || 0);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `products!D${index + 1}:E${index + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[real + deltaReal, reservado + deltaReservado]],
    },
  });
}

/* ======================================================
   🔔 WEBHOOK
====================================================== */
app.post("/webhook", async (req, res) => {
  const { id: orderId, event } = req.body;
  console.log(`🔔 WEBHOOK ${event} ${orderId}`);

  const CREATE_EVENT = "order/created";
  const PAY_EVENT = "order/paid";
  const CANCEL_EVENT = "order/cancelled";
  const RESERVE_EVENTS = [CREATE_EVENT, "order/updated"];

  try {
    const sheets = await getSheets();
    const order = await getOrderById(orderId);
    
    console.log("📦 ORDER STATUS DEBUG", {
  status: order.status,
  shipping_status: order.shipping_status,
  fulfillment_status: order.fulfillment_status,
  shipping_lines: order.shipping_lines,
  tracking_number: order.tracking_number,
  tracking_url: order.tracking_url
});

    const now = new Date().toISOString();

    const rowIndex = await findOrderRowIndex(sheets, orderId);

    const shippedNow = isOrderShipped(order);
    const shippedBefore = await wasOrderPreviouslyShipped(sheets, rowIndex);
    const justShipped = shippedNow && !shippedBefore;

    if (justShipped) {
      console.log(`📦 Orden ${orderId} marcada como ENVIADA`);
    }

/* ======================
   📝 ORDERS (UPSERT)
====================== */
    const orderValues = [[
      String(order.id),
      shippedNow ? "shipped" : order.status || "open",
      rowIndex ? "" : now,            // created_at
      event === PAY_EVENT ? now : "", // paid_at
      justShipped ? now : "",         // shipped_at ⭐
      now,                            // updated_at
      event === PAY_EVENT,
      RESERVE_EVENTS.includes(event)
    ]];

    if (rowIndex) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `orders!A${rowIndex}:H${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: orderValues },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "orders!A:H",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: orderValues },
      });
    }

/* ======================
   📦 ITEMS + STOCK
====================== */
    for (const item of order.products) {
      const qty = Number(item.quantity);
      const variantId = item.variant_id;

      if (RESERVE_EVENTS.includes(event)) {
        await updateProductStock(sheets, variantId, 0, qty);
      }

      if (event === PAY_EVENT) {
        await updateProductStock(sheets, variantId, -qty, -qty);
      }

      if (event === CANCEL_EVENT) {
        await updateProductStock(sheets, variantId, 0, -qty);
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
   🔄 SYNC PRODUCTS (manual)
====================================================== */
app.get("/sync-products", async (req, res) => {
  res.json({ ok: true, message: "Sync endpoint activo" });
});

app.post("/sync-products", async (req, res) => {
  try {
    console.log("🔄 Sync de productos iniciado");

    const sheets = await getSheets();
    const products = await getAllProducts();
    const now = new Date().toISOString();

    for (const product of products) {
      for (const variant of product.variants) {
        const variantId = variant.id;
        const rowIndex = await findProductRowByVariant(sheets, variantId);

        const values = [[
          String(variantId),
          getLocalizedValue(product.name),
          variant.price,
          variant.stock || 0,
          0,
          variant.sku || "",
          variant.available !== false,
          now
        ]];

        if (rowIndex) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `products!A${rowIndex}:H${rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values },
          });
        } else {
          await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: "products!A:H",
            valueInputOption: "USER_ENTERED",
            requestBody: { values },
          });
        }
      }
    }

    console.log("✅ Productos sincronizados");
    res.json({ success: true });

  } catch (err) {
    console.error("❌ Error sync-products:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   🚀 SERVER
====================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
