const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config();

const { getMailFrom, verifyEmailConnection } = require("../services/emailService");

async function main() {
  await verifyEmailConnection();
  console.log(`SMTP connection verified for ${getMailFrom()}.`);
}

main().catch((error) => {
  console.error(`SMTP connection failed: ${error.message}`);
  process.exitCode = 1;
});
