const db = require("../db");

async function logEmailEvent({
  organizationId,
  sentByUserId,
  senderEmail,
  senderName,
  recipientEmail,
  recipientName,
  ccEmail,
  subject,
  status,
  errorMessage,
  emailType = "other",
  reportType,
  reportId,
}) {
  await db.query(
    `
    INSERT INTO email_logs
      (
        organization_id,
        sent_by_user_id,
        sender_email,
        sender_name,
        recipient_email,
        recipient_name,
        cc_email,
        subject,
        status,
        error_message,
        email_type,
        report_type,
        report_id
      )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `,
    [
      organizationId || null,
      sentByUserId || null,
      senderEmail || "",
      senderName || "",
      recipientEmail || "",
      recipientName || "",
      ccEmail || "",
      subject || "",
      status,
      errorMessage || "",
      emailType,
      reportType || null,
      reportId || null,
    ]
  );
}

module.exports = {
  logEmailEvent,
};
