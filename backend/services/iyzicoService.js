const crypto = require("crypto");

const DEFAULT_BASE_URL = "https://sandbox-api.iyzipay.com";

function getConfig() {
  const apiKey = (process.env.IYZICO_API_KEY || "").trim();
  const secretKey = (process.env.IYZICO_SECRET_KEY || "").trim();
  const baseUrl = (process.env.IYZICO_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/$/, "");

  if (!apiKey || !secretKey) {
    const error = new Error("iyzico API credentials are missing");
    error.statusCode = 503;
    throw error;
  }

  return { apiKey, secretKey, baseUrl };
}

function authHeaders(pathname, body = "") {
  const { apiKey, secretKey } = getConfig();
  const randomKey = `${Date.now()}${crypto.randomBytes(8).toString("hex")}`;
  const payload = `${randomKey}${pathname}${body}`;
  const signature = crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
  const authorizationString = `apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`;

  return {
    Authorization: `IYZWSv2 ${Buffer.from(authorizationString, "utf8").toString("base64")}`,
    "Content-Type": "application/json",
    "x-iyzi-rnd": randomKey,
  };
}

async function iyzicoRequest(method, pathname, payload) {
  const { baseUrl } = getConfig();
  const body = payload ? JSON.stringify(payload) : "";
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: authHeaders(pathname, body),
    body: method === "GET" ? undefined : body,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.status === "failure") {
    const error = new Error(data.errorMessage || data.message || "iyzico request failed");
    error.statusCode = response.ok ? 400 : response.status;
    error.iyzico = data;
    throw error;
  }

  return data;
}

function splitName(fullName = "") {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { name: "Inspectria", surname: "Customer" };
  if (parts.length === 1) return { name: parts[0], surname: "Customer" };
  return { name: parts.slice(0, -1).join(" "), surname: parts.at(-1) };
}

function customerFromUser(user, organizationName) {
  const { name, surname } = splitName(user?.name || organizationName);
  const emailCandidate = String(user?.username || "").includes("@") ? user.username : "";
  const email = emailCandidate || (process.env.IYZICO_DEFAULT_EMAIL || "").trim();
  const gsmNumber = (process.env.IYZICO_DEFAULT_GSM_NUMBER || "").trim();
  const identityNumber = (process.env.IYZICO_DEFAULT_IDENTITY_NUMBER || "").trim();
  const address = (process.env.IYZICO_DEFAULT_ADDRESS || "Inspectria subscription").trim();
  const city = (process.env.IYZICO_DEFAULT_CITY || "Istanbul").trim();
  const country = (process.env.IYZICO_DEFAULT_COUNTRY || "Turkey").trim();
  const zipCode = (process.env.IYZICO_DEFAULT_ZIP_CODE || "").trim();

  if (!email || !gsmNumber || !identityNumber) {
    const error = new Error(
      "iyzico customer defaults are missing: IYZICO_DEFAULT_EMAIL, IYZICO_DEFAULT_GSM_NUMBER and IYZICO_DEFAULT_IDENTITY_NUMBER are required"
    );
    error.statusCode = 503;
    throw error;
  }

  const contactName = organizationName || `${name} ${surname}`;
  const billingAddress = { address, contactName, city, country };
  if (zipCode) billingAddress.zipCode = zipCode;

  return {
    name,
    surname,
    email,
    gsmNumber,
    identityNumber,
    billingAddress,
    shippingAddress: billingAddress,
  };
}

async function initializeSubscriptionCheckout({
  callbackUrl,
  conversationId,
  pricingPlanReferenceCode,
  user,
  organizationName,
}) {
  return iyzicoRequest("POST", "/v2/subscription/checkoutform/initialize", {
    locale: process.env.IYZICO_LOCALE || "tr",
    callbackUrl,
    pricingPlanReferenceCode,
    subscriptionInitialStatus: "ACTIVE",
    conversationId,
    customer: customerFromUser(user, organizationName),
  });
}

async function retrieveSubscriptionCheckout(token) {
  return iyzicoRequest("GET", `/v2/subscription/checkoutform/${encodeURIComponent(token)}`);
}

module.exports = {
  initializeSubscriptionCheckout,
  retrieveSubscriptionCheckout,
};
