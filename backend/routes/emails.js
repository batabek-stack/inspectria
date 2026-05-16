const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const { getMailFrom, sendReportEmail } = require("../services/emailService");

const router = express.Router();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validateRecipient(value, fieldName) {
  const email = cleanEmail(value);
  if (!email || !emailPattern.test(email)) {
    throw new Error(`${fieldName} must be a valid email address.`);
  }
  return email;
}

function validateOptionalRecipient(value, fieldName) {
  const email = cleanEmail(value);
  if (!email) return "";
  if (!emailPattern.test(email)) {
    throw new Error(`${fieldName} must be a valid email address.`);
  }
  return email;
}

function sanitizeFileName(value) {
  return String(value || "Inspectria_Report")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "Inspectria_Report";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function reportAccessWhere(user, params) {
  const where = [];

  if (!db.isPlatformAdmin(user)) {
    params.push(user.organizationId);
    where.push(`r.organization_id = $${params.length}`);
  }

  if (user.role === "user") {
    params.push(user.id);
    where.push(`a.assigned_to_user_id = $${params.length}`);
  }

  return where.length ? `AND ${where.join(" AND ")}` : "";
}

async function getChecklistReportForEmail(reportId, user) {
  const params = [reportId];
  return db.one(
    `
    SELECT
      r.id,
      r.organization_id,
      r.completed_at,
      r.status,
      c.title AS "title",
      u1.name AS "completedByName",
      u2.name AS "assignedToName",
      o.name AS "organizationName"
    FROM reports r
    JOIN assignments a ON r.assignment_id = a.id
    JOIN checklists c ON a.checklist_id = c.id
    JOIN users u1 ON r.completed_by_user_id = u1.id
    JOIN users u2 ON a.assigned_to_user_id = u2.id
    LEFT JOIN organizations o ON o.id = r.organization_id
    WHERE r.id = $1
      ${reportAccessWhere(user, params)}
  `,
    params
  );
}

async function getWalkthroughForEmail(reportId, user) {
  const params = [reportId];
  const where = ["w.id = $1"];

  if (!db.isPlatformAdmin(user)) {
    params.push(user.organizationId);
    where.push(`w.organization_id = $${params.length}`);
  }

  if (user.role === "user") {
    params.push(user.id);
    where.push(`w.created_by_user_id = $${params.length}`);
  }

  return db.one(
    `
    SELECT
      w.id,
      w.organization_id,
      w.title,
      w.location,
      w.status,
      w.completed_at,
      u.name AS "completedByName",
      o.name AS "organizationName"
    FROM walkthroughs w
    JOIN users u ON u.id = w.created_by_user_id
    LEFT JOIN organizations o ON o.id = w.organization_id
    WHERE ${where.join(" AND ")}
  `,
    params
  );
}

async function logEmail({ organizationId, userId, reportType, reportId, to, cc, subject, status, errorMessage }) {
  await db.query(
    `
    INSERT INTO email_logs
      (organization_id, sent_by_user_id, report_type, report_id, recipient_email, cc_email, subject, status, error_message)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `,
    [organizationId || null, userId || null, reportType, reportId, to, cc || "", subject, status, errorMessage || ""]
  );
}

router.post("/report", authRequired, async (req, res, next) => {
  const {
    reportType = "checklist",
    reportId,
    to,
    cc = "",
    subject = "",
    message = "",
    attachmentBase64 = "",
    attachmentFileName = "",
  } = req.body || {};

  const cleanReportType = reportType === "walkthrough" ? "walkthrough" : "checklist";
  const cleanReportId = Number(reportId);
  let recipient = "";
  let ccRecipient = "";
  let emailSubject = "";
  let organizationId = req.user.organizationId || null;

  try {
    if (!cleanReportId) {
      return res.status(400).json({ message: "reportId is required." });
    }

    recipient = validateRecipient(to, "to");
    ccRecipient = validateOptionalRecipient(cc, "cc");

    const report =
      cleanReportType === "walkthrough"
        ? await getWalkthroughForEmail(cleanReportId, req.user)
        : await getChecklistReportForEmail(cleanReportId, req.user);

    if (!report) {
      return res.status(404).json({ message: "Report not found." });
    }

    organizationId = report.organization_id || organizationId;
    const reportLabel = cleanReportType === "walkthrough" ? "Walkthrough Report" : "Checklist Report";
    emailSubject = String(subject || "").trim() || `Inspectria ${reportLabel}: ${report.title}`;
    const bodyMessage = String(message || "").trim();
    const plainText = [
      bodyMessage || `Please find the ${reportLabel.toLowerCase()} attached.`,
      "",
      `Report: ${report.title}`,
      report.organizationName ? `Organization: ${report.organizationName}` : "",
      report.completedByName ? `Completed by: ${report.completedByName}` : "",
      "",
      `Sent from ${getMailFrom()}`,
    ]
      .filter(Boolean)
      .join("\n");

    const attachments = [];
    if (attachmentBase64) {
      const base64 = String(attachmentBase64).replace(/^data:application\/pdf;base64,/, "");
      attachments.push({
        filename: sanitizeFileName(attachmentFileName || `${report.title}.pdf`),
        content: Buffer.from(base64, "base64"),
        contentType: "application/pdf",
      });
    }

    await sendReportEmail({
      to: recipient,
      cc: ccRecipient,
      subject: emailSubject,
      text: plainText,
      html: `<p>${escapeHtml(plainText).replace(/\n/g, "<br />")}</p>`,
      attachments,
    });

    await logEmail({
      organizationId,
      userId: req.user.id,
      reportType: cleanReportType,
      reportId: cleanReportId,
      to: recipient,
      cc: ccRecipient,
      subject: emailSubject,
      status: "sent",
    });

    res.json({ success: true });
  } catch (error) {
    if (recipient && emailSubject) {
      await logEmail({
        organizationId,
        userId: req.user.id,
        reportType: cleanReportType,
        reportId: cleanReportId || 0,
        to: recipient,
        cc: ccRecipient,
        subject: emailSubject,
        status: "failed",
        errorMessage: error.message,
      }).catch(() => {});
    }

    if (error.message && error.message.includes("valid email")) {
      return res.status(400).json({ message: error.message });
    }

    if (error.message === "Email delivery is not configured.") {
      return res.status(503).json({
        message: "Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.",
      });
    }

    next(error);
  }
});

module.exports = router;
