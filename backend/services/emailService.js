const nodemailer = require("nodemailer");

function getMailFrom() {
  return process.env.MAIL_FROM || '"Inspectria Reports" <reports@inspectria.com>';
}

function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransporter() {
  if (!isEmailConfigured()) {
    throw new Error("Email delivery is not configured.");
  }

  const port = Number(process.env.SMTP_PORT || 587);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendReportEmail({ to, cc, subject, text, html, attachments = [] }) {
  const transporter = createTransporter();

  return transporter.sendMail({
    from: getMailFrom(),
    to,
    cc: cc || undefined,
    subject,
    text,
    html,
    attachments,
  });
}

module.exports = {
  getMailFrom,
  isEmailConfigured,
  sendReportEmail,
};
