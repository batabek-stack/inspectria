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
  const secure =
    String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" ||
    (!process.env.SMTP_SECURE && port === 465);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendReportEmail({ to, cc, subject, text, html, replyTo, attachments = [], from }) {
  const transporter = createTransporter();

  return transporter.sendMail({
    from: from || getMailFrom(),
    to,
    cc: cc || undefined,
    replyTo: replyTo || undefined,
    subject,
    text,
    html,
    attachments,
  });
}

async function sendPasswordResetCode({ to, username, code }) {
  const safeUsername = escapeHtml(username);
  const safeCode = escapeHtml(code);

  return sendReportEmail({
    to,
    subject: "Inspectria password reset code",
    text: [
      `Hello ${username},`,
      "",
      `Your Inspectria password reset code is ${code}.`,
      "This code expires in 10 minutes. If you did not request it, you can ignore this email.",
    ].join("\n"),
    html: `
      <p>Hello ${safeUsername},</p>
      <p>Your Inspectria password reset code is:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:4px;">${safeCode}</p>
      <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    `,
  });
}

async function sendUserRegistrationRequestEmail({
  to,
  organizationName,
  requesterName,
  requesterUsername,
  requesterEmail,
  loginUrl,
}) {
  const safeOrganizationName = escapeHtml(organizationName);
  const safeRequesterName = escapeHtml(requesterName);
  const safeRequesterUsername = escapeHtml(requesterUsername);
  const safeRequesterEmail = escapeHtml(requesterEmail);
  const safeLoginUrl = escapeHtml(loginUrl);

  return sendReportEmail({
    to,
    subject: `Inspectria user request for ${organizationName}`,
    text: [
      `A new user requested access to ${organizationName}.`,
      "",
      `Name: ${requesterName}`,
      `Username: ${requesterUsername}`,
      `Email: ${requesterEmail}`,
      "",
      `Open User Management to review the request: ${loginUrl}`,
    ].join("\n"),
    html: `
      <p>A new user requested access to <strong>${safeOrganizationName}</strong>.</p>
      <p>
        <strong>Name:</strong> ${safeRequesterName}<br />
        <strong>Username:</strong> ${safeRequesterUsername}<br />
        <strong>Email:</strong> ${safeRequesterEmail}
      </p>
      <p>
        <a href="${safeLoginUrl}">Open Inspectria User Management</a>
      </p>
      <p>${safeLoginUrl}</p>
    `,
  });
}

async function sendTemplateShareEmail({ to, senderName, templateTitle, importUrl }) {
  const safeSenderName = escapeHtml(senderName);
  const safeTemplateTitle = escapeHtml(templateTitle);
  const safeImportUrl = escapeHtml(importUrl);

  return sendReportEmail({
    from: '"Inspectria" <info@inspectria.com>',
    to,
    subject: `${senderName} shared an Inspectria template with you`,
    text: [
      `${senderName} shared the ${templateTitle} template with you.`,
      "Use the Import link below to import it.",
      "",
      `Import: ${importUrl}`,
    ].join("\n"),
    html: `
      <p><strong>${safeSenderName}</strong> shared the <strong>${safeTemplateTitle}</strong> template with you.</p>
      <p>Use the Import button below to import it.</p>
      <p>
        <a
          href="${safeImportUrl}"
          style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700;"
        >
          Import
        </a>
      </p>
      <p>${safeImportUrl}</p>
    `,
  });
}

async function verifyEmailConnection() {
  const transporter = createTransporter();
  return transporter.verify();
}

module.exports = {
  getMailFrom,
  isEmailConfigured,
  sendPasswordResetCode,
  sendTemplateShareEmail,
  sendUserRegistrationRequestEmail,
  verifyEmailConnection,
  sendReportEmail,
};
