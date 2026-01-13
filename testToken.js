import axios from "axios";
import 'dotenv/config';

const STORE_ID = process.env.TIENDANUBE_STORE_ID;
const TN_TOKEN = process.env.TN_TOKEN;

console.log("STORE_ID:", process.env.TIENDANUBE_STORE_ID);
console.log("TN_TOKEN:", process.env.TN_TOKEN);

(async () => {
  try {
    const res = await axios.get(
      `https://api.tiendanube.com/v1/${STORE_ID}/orders/1878562258`,
      {
        headers: {
          Authentication: `bearer ${TN_TOKEN}`,
          "User-Agent": "tiendanube-webhook"
        }
      }
    );

    console.log("✅ OK:", res.data.id);
  } catch (err) {
    console.error(
      "❌ ERROR",
      err.response?.status,
      err.response?.data
    );
  }
})();
