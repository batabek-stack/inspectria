const Iyzipay = require("iyzipay");

let client = null;

function getIyzicoClient() {
  if (!client) {
    client = new Iyzipay({
      apiKey: process.env.IYZICO_API_KEY,
      secretKey: process.env.IYZICO_SECRET_KEY,
      uri: process.env.IYZICO_BASE_URL || "https://sandbox-api.iyzipay.com",
    });
  }

  return client;
}

module.exports = getIyzicoClient;
