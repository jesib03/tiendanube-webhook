import axios from "axios";

const STORE_ID = process.env.TIENDANUBE_STORE_ID;
const TN_TOKEN = process.env.TN_TOKEN;

(async () => {
  const url = `https://api.tiendanube.com/v1/${STORE_ID}/orders/1878562584`;
  try {
    const res = await axios.get(url, {
      headers: {
        Authentication: `bearer ${TN_TOKEN}`,
        "User-Agent": "tiendanube-webhook"
      }
    });
    console.log(res.data);
  } catch (err) {
    console.error(err.response?.status, err.response?.data);
  }
})();
