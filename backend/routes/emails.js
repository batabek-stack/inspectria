const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const { getMailFrom, sendReportEmail } = require("../services/emailService");
const { logEmailEvent } = require("../services/emailLogService");

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

function parseRecipientList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\s,;]+/)
        .filter(Boolean);

  return [...new Set(values.map(cleanEmail).filter(Boolean))];
}

function validateRecipients(value, fieldName) {
  const emails = parseRecipientList(value);

  if (emails.length === 0) {
    throw new Error(`${fieldName} must include at least one valid email address.`);
  }

  const invalidEmail = emails.find((email) => !emailPattern.test(email));
  if (invalidEmail) {
    throw new Error(`${fieldName} includes an invalid email address: ${invalidEmail}`);
  }

  return emails;
}

function validateOptionalRecipient(value, fieldName) {
  const email = cleanEmail(value);
  if (!email) return "";
  if (!emailPattern.test(email)) {
    throw new Error(`${fieldName} must be a valid email address.`);
  }
  return email;
}

function getContactRecipient() {
  return process.env.CONTACT_TO || process.env.SMTP_USER || "info@inspectria.com";
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
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

function decodePdfAttachment(value) {
  const raw = String(value || "").trim();
  const base64 = (raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw).replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length < 4 || buffer.slice(0, 4).toString("utf8") !== "%PDF") {
    throw new Error("PDF attachment is invalid.");
  }

  return buffer;
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

router.post("/contact", async (req, res, next) => {
  const {
    name = "",
    email = "",
    organization = "",
    message = "",
    website = "",
  } = req.body || {};

  try {
    if (website) {
      return res.json({ success: true });
    }

    const cleanName = cleanText(name, 120);
    const senderEmail = validateRecipient(email, "email");
    const cleanOrganization = cleanText(organization, 160);
    const cleanMessage = cleanText(message, 4000);

    if (!cleanName || !cleanMessage) {
      return res.status(400).json({ message: "Name, email, and message are required." });
    }

    const contactRecipient = validateRecipient(getContactRecipient(), "contact recipient");
    const subject = `Inspectria contact request from ${cleanName}`;
    const plainText = [
      "New Inspectria contact message",
      "",
      `Name: ${cleanName}`,
      `Email: ${senderEmail}`,
      cleanOrganization ? `Organization: ${cleanOrganization}` : "",
      "",
      "Message:",
      cleanMessage,
    ]
      .filter(Boolean)
      .join("\n");

    await sendReportEmail({
      to: contactRecipient,
      subject,
      replyTo: senderEmail,
      text: plainText,
      html: `<p>${escapeHtml(plainText).replace(/\n/g, "<br />")}</p>`,
    });

    res.json({ success: true });
  } catch (error) {
    if (error.message && (error.message.includes("valid email") || error.message.includes("invalid email"))) {
      return res.status(400).json({ message: error.message });
    }

    if (error.message === "Email delivery is not configured.") {
      return res.status(503).json({
        message: "Email delivery is not configured. Please try again later.",
      });
    }

    next(error);
  }
});

router.post("/support-ticket", authRequired, async (req, res, next) => {
  const { subject = "", message = "" } = req.body || {};

  try {
    const cleanSubject = cleanText(subject, 180);
    const cleanMessage = cleanText(message, 4000);
    const senderEmail = validateRecipient(req.user.email, "account email");

    if (!cleanSubject || !cleanMessage) {
      return res.status(400).json({ message: "Subject and message are required." });
    }

    const supportRecipient = "info@inspectria.com";
    const userName = cleanText(req.user.name || req.user.username, 120);
    const organizationName = cleanText(req.user.organizationName, 160);
    const plainText = [
      "New Inspectria support ticket",
      "",
      `Subject: ${cleanSubject}`,
      `User: ${userName}`,
      `Email: ${senderEmail}`,
      `Role: ${req.user.role}`,
      organizationName ? `Organization: ${organizationName}` : "",
      "",
      "Message:",
      cleanMessage,
    ]
      .filter(Boolean)
      .join("\n");

    await sendReportEmail({
      to: supportRecipient,
      replyTo: senderEmail,
      subject: `[Support] ${cleanSubject}`,
      text: plainText,
      html: `<p>${escapeHtml(plainText).replace(/\n/g, "<br />")}</p>`,
    });

    res.json({ success: true });
  } catch (error) {
    if (error.message && (error.message.includes("valid email") || error.message.includes("invalid email"))) {
      return res.status(400).json({ message: error.message });
    }

    if (error.message === "Email delivery is not configured.") {
      return res.status(503).json({
        message: "Email delivery is not configured. Please try again later.",
      });
    }

    next(error);
  }
});

router.get("/report-recipients", authRequired, async (req, res, next) => {
  try {
    const organizationIds = db.isPlatformAdmin(req.user)
      ? await db.getManagedOrganizationIds(req.user)
      : [req.user.organizationId].filter(Boolean);

    if (organizationIds.length === 0) return res.json([]);

    const recipients = await db.many(
      `
      SELECT
        u.id,
        u.name,
        u.username,
        u.email,
        u.role,
        o.name AS "organizationName"
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE u.organization_id = ANY($1::int[])
        AND u.role IN ('admin', 'user')
        AND u.active = TRUE
        AND u.approval_status = 'approved'
        AND COALESCE(u.email, '') <> ''
      ORDER BY o.name, u.name, u.username
    `,
      [organizationIds]
    );

    res.json(recipients);
  } catch (error) {
    next(error);
  }
});

router.get("/logs", authRequired, async (req, res, next) => {
  try {
    if (!db.isPlatformAdmin(req.user)) {
      return res.status(403).json({ message: "Platform admin access is required." });
    }

    const scopeIds = await db.getManagedOrganizationIds(req.user);
    const params = [];
    const scopeFilter = scopeIds.length
      ? `WHERE (el.organization_id IS NULL OR el.organization_id = ANY($1::int[]))`
      : "";
    if (scopeIds.length) params.push(scopeIds);

    const rows = await db.many(
      `
      SELECT
        el.id,
        el.email_type AS "emailType",
        el.report_type AS "reportType",
        el.report_id AS "reportId",
        el.sender_email AS "senderEmail",
        el.sender_name AS "senderName",
        COALESCE(sender.email, '') AS "sentByEmail",
        COALESCE(sender.name, sender.username, '') AS "sentByName",
        el.recipient_email AS "recipientEmail",
        el.recipient_name AS "recipientName",
        el.cc_email AS "ccEmail",
        el.subject,
        el.status,
        el.error_message AS "errorMessage",
        el.sent_at AS "sentAt",
        o.name AS "organizationName"
      FROM email_logs el
      LEFT JOIN users sender ON sender.id = el.sent_by_user_id
      LEFT JOIN organizations o ON o.id = el.organization_id
      ${scopeFilter}
      ORDER BY el.sent_at DESC
      LIMIT 300
    `,
      params
    );

    res.json({
      logs: rows.map((row) => ({
        ...row,
        senderEmail: row.senderEmail || row.sentByEmail || "",
        senderName: row.senderName || row.sentByName || "",
      })),
    });
  } catch (error) {
    next(error);
  }
});

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
  let recipients = [];
  let ccRecipient = "";
  let emailSubject = "";
  let organizationId = req.user.organizationId || null;

  try {
    if (!cleanReportId) {
      return res.status(400).json({ message: "reportId is required." });
    }

    recipients = validateRecipients(to, "to");
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
      attachments.push({
        filename: sanitizeFileName(attachmentFileName || `${report.title}.pdf`),
        content: decodePdfAttachment(attachmentBase64),
        contentType: "application/pdf",
      });
    }

    await sendReportEmail({
      to: recipients,
      cc: ccRecipient,
      subject: emailSubject,
      text: plainText,
      html: `<p>${escapeHtml(plainText).replace(/\n/g, "<br />")}</p>`,
      attachments,
    });

    await logEmailEvent({
      organizationId,
      sentByUserId: req.user.id,
      senderEmail: req.user.email,
      senderName: req.user.name || req.user.username,
      recipientEmail: recipients.join(", "),
      recipientName: "",
      ccEmail: ccRecipient,
      emailType: "report",
      reportType: cleanReportType,
      reportId: cleanReportId,
      subject: emailSubject,
      status: "sent",
    });

    res.json({ success: true });
  } catch (error) {
    if (recipients.length > 0 && emailSubject) {
      await logEmailEvent({
        organizationId,
        sentByUserId: req.user.id,
        senderEmail: req.user.email,
        senderName: req.user.name || req.user.username,
        recipientEmail: recipients.join(", "),
        recipientName: "",
        ccEmail: ccRecipient,
        emailType: "report",
        reportType: cleanReportType,
        reportId: cleanReportId || 0,
        subject: emailSubject,
        status: "failed",
        errorMessage: error.message,
      }).catch(() => {});
    }

    if (error.message && (error.message.includes("valid email") || error.message.includes("invalid email"))) {
      return res.status(400).json({ message: error.message });
    }

    if (error.message === "Email delivery is not configured.") {
      return res.status(503).json({
        message: "Email delivery is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM.",
      });
    }

    if (error.message === "PDF attachment is invalid.") {
      return res.status(400).json({
        message: "PDF attachment could not be prepared. Please try generating the report again.",
      });
    }

    next(error);
  }
});

module.exports = router;
