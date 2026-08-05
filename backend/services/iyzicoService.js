const Iyzipay = require("iyzipay");
const getIyzicoClient = require("./iyzico");

function getConfig() {
  const apiKey = (process.env.IYZICO_API_KEY || "").trim();
  const secretKey = (process.env.IYZICO_SECRET_KEY || "").trim();

  if (!apiKey || !secretKey) {
    const error = new Error("iyzico API credentials are missing");
    error.statusCode = 503;
    throw error;
  }
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
  getConfig();

  return new Promise((resolve, reject) => {
    getIyzicoClient().subscriptionCheckoutForm.initialize(
      {
        locale: process.env.IYZICO_LOCALE || Iyzipay.LOCALE.EN,
        callbackUrl,
        pricingPlanReferenceCode,
        subscriptionInitialStatus: "ACTIVE",
        conversationId,
        customer: customerFromUser(user, organizationName),
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
  });
}

async function retrieveSubscriptionCheckout(token) {
  getConfig();

  return new Promise((resolve, reject) => {
    getIyzicoClient().subscriptionCheckoutForm.retrieve(
      {
        checkoutFormToken: token,
      },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      }
    );
  });
}

module.exports = {
  initializeSubscriptionCheckout,
  retrieveSubscriptionCheckout,
};
