const nodemailer = require("nodemailer");

function getMailFrom() {
  return process.env.MAIL_FROM || '"Inspectria Reports" <reports@inspectria.com>';
}

function getPublicAppUrl() {
  return (process.env.PUBLIC_APP_URL || "https://inspectria.com").replace(/\/+$/, "");
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

function welcomeEmailContent({ role, isEnterprise }) {
  if (isEnterprise) {
    return {
      intro:
        "Your Inspectria Enterprise account has been activated. Inspectria is a platform that enables you to manage your operational control and checklist processes in a digital, organized, and trackable way.",
      lead: "With Inspectria Enterprise, you can:",
      bullets: [
        "Create customized checklists for departments or locations.",
        "Track daily, weekly, or periodic operational controls digitally.",
        "Add answers, comments, and photos to each control item.",
        "Review completed checklists retrospectively.",
        "Export reports in Excel or PDF format.",
        "Create Sub Organizations to manage different units separately.",
        "Assign a separate admin for each Sub Organization.",
        "View a snapshot of your organization's overall status on the Dashboard.",
        "Analyze negative items in completed checklists with AI support.",
        "Receive negative items as an Action List in Excel format.",
        "Send individual or bulk messages to users within your organization.",
        "Share created templates with users within your organization.",
        "Share templates with users outside your organization when needed.",
        "Track deficiencies, responsible persons, and actions more easily.",
        "Standardize operational, quality, technical service, housekeeping, front office, F&B, and management controls.",
        "Strengthen follow-up and coordination between teams.",
      ],
      after:
        "After logging into the system, you can view the checklists assigned to you on the main screen and start completing the relevant forms.",
    };
  }

  if (role === "admin") {
    return {
      intro:
        "Your Inspectria Admin account has been activated. As an Admin User, you will be able to manage your organization's operational control and checklist processes through Inspectria in a digital, organized, and trackable way.",
      lead: "As an Inspectria Admin, you can:",
      bullets: [
        "Create and manage checklists for departments, locations, or operational areas.",
        "Assign checklists to users or teams.",
        "Track daily, weekly, or periodic operational controls digitally.",
        "Review completed checklists and monitor submission status.",
        "Add, edit, or manage users within your organization.",
        "Send individual or bulk messages to users within your organization.",
        "Share created templates with users inside your organization.",
        "Share templates with external users when needed.",
        "View your organization's snapshot on the Dashboard.",
        "Monitor checklist completion, findings, and overall performance.",
        "Analyze negative items in completed checklists with AI support.",
        "Export negative findings as an Excel-based Action List.",
        "Export reports in Excel or PDF format.",
        "Track deficiencies, responsible persons, and required actions more easily.",
        "Standardize operational, quality, technical service, housekeeping, front office, F&B, and management controls.",
        "Strengthen follow-up, accountability, and coordination between teams.",
      ],
      after:
        "After logging into the system, you can access your Admin Dashboard, manage your organization settings, review assigned users, and start creating or managing checklists and templates.",
    };
  }

  return {
    intro:
      "Your Inspectria user account has been activated. Inspectria is a platform that helps you complete your assigned operational checklists in a digital, organized, and trackable way.",
    lead: "As an Inspectria User, you can:",
    bullets: [
      "View the checklists assigned to you.",
      "Complete checklist items digitally.",
      "Add answers, comments, and photos to each control item.",
      "Submit completed checklists through the system.",
      "Review your submitted checklist records when needed.",
      "Export available reports in Excel or PDF format, if authorized.",
      "Send and receive messages within your organization.",
      "Receive individual or bulk messages from your organization.",
      "Access shared templates when they are assigned or shared with you.",
      "Follow required actions and operational instructions more easily.",
      "Support standardization of operational, quality, technical service, housekeeping, front office, F&B, and management controls.",
      "Strengthen communication and coordination with your team.",
    ],
    after:
      "After logging into the system, you can view the checklists assigned to you on the main screen and start completing the relevant forms.",
  };
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

async function sendWelcomeEmail({ to, role, isEnterprise = false }) {
  const content = welcomeEmailContent({ role, isEnterprise });
  const siteUrl = "https://inspectria.com";
  const support =
    "For any technical issues, access problems, or support needs, please feel free to contact us.";
  const closing = "We wish you an efficient experience with Inspectria.";
  const text = [
    "Hello,",
    "",
    content.intro,
    "",
    content.lead,
    "",
    ...content.bullets.map((item) => `* ${item}`),
    "",
    content.after,
    "",
    support,
    "",
    closing,
    "",
    "Best regards,",
    "Inspectria Team",
    "",
    siteUrl,
  ].join("\n");

  const htmlBullets = content.bullets
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const safeSiteUrl = escapeHtml(siteUrl);

  return sendReportEmail({
    to,
    subject: "Welcome to INSPECTRIA",
    text,
    html: `
      <p>Hello,</p>
      <p>${escapeHtml(content.intro)}</p>
      <p>${escapeHtml(content.lead)}</p>
      <ul>${htmlBullets}</ul>
      <p>${escapeHtml(content.after)}</p>
      <p>${escapeHtml(support)}</p>
      <p>${escapeHtml(closing)}</p>
      <p>Best regards,<br />Inspectria Team</p>
      <p><a href="${safeSiteUrl}">${safeSiteUrl}</a></p>
    `,
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

async function sendAppMessageEmail({ to, recipientName, senderName, title, body }) {
  const safeRecipientName = escapeHtml(recipientName || "there");
  const safeSenderName = escapeHtml(senderName || "Inspectria");
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body).replace(/\n/g, "<br />");

  return sendReportEmail({
    to,
    subject: title,
    text: [
      `Hello ${recipientName || "there"},`,
      "",
      `${senderName || "Inspectria"} sent you a message in Inspectria:`,
      "",
      title,
      "",
      body,
    ].join("\n"),
    html: `
      <p>Hello ${safeRecipientName},</p>
      <p><strong>${safeSenderName}</strong> sent you a message in Inspectria.</p>
      <p><strong>${safeTitle}</strong></p>
      <p>${safeBody}</p>
    `,
  });
}

function actionPlanRowsHtml(items) {
  const appUrl = getPublicAppUrl();
  return items
    .map((item) => {
      const photoLinks = (item.photos || [])
        .map((photo, index) => {
          const photoUrl = `${appUrl}${String(photo || "").startsWith("/") ? "" : "/"}${photo}`;
          const safePhotoUrl = escapeHtml(photoUrl);
          return `<a href="${safePhotoUrl}">Photo ${index + 1}</a>`;
        })
        .join("<br />");

      return `
        <tr>
          <td style="padding:8px;border:1px solid #dbe4ea;">${escapeHtml(item.item)}</td>
          <td style="padding:8px;border:1px solid #dbe4ea;">${escapeHtml(item.action)}</td>
          <td style="padding:8px;border:1px solid #dbe4ea;">${escapeHtml(item.remarks || "")}</td>
          <td style="padding:8px;border:1px solid #dbe4ea;">${escapeHtml(item.dueDate || item.due_date || "")}</td>
          <td style="padding:8px;border:1px solid #dbe4ea;">${escapeHtml(item.status || "Open")}</td>
          <td style="padding:8px;border:1px solid #dbe4ea;">${photoLinks || "-"}</td>
        </tr>
      `;
    })
    .join("");
}

function actionPlanRowsText(items) {
  const appUrl = getPublicAppUrl();
  return items
    .map((item, index) => {
      const photos = (item.photos || [])
        .map((photo, photoIndex) => {
          const photoUrl = `${appUrl}${String(photo || "").startsWith("/") ? "" : "/"}${photo}`;
          return `Photo ${photoIndex + 1}: ${photoUrl}`;
        })
        .join("\n");

      return `${index + 1}. Item: ${item.item}\nAction: ${item.action}\nRemarks: ${item.remarks || "-"}\nDue Date: ${item.dueDate || item.due_date || "-"}\nStatus: ${item.status || "Open"}${photos ? `\nPhotos:\n${photos}` : ""}`;
    })
    .join("\n\n");
}

async function sendActionPlanEmail({ to, organizationName, items }) {
  const safeOrganizationName = escapeHtml(organizationName || "your organization");
  const actionPlanUrl = getPublicAppUrl();
  const safeActionPlanUrl = escapeHtml(actionPlanUrl);

  return sendReportEmail({
    to,
    subject: `Inspectria Action Plan - ${organizationName || "Assigned items"}`,
    text: [
      "Hello,",
      "",
      `You have action plan item(s) assigned in ${organizationName || "Inspectria"}.`,
      "",
      actionPlanRowsText(items),
      "",
      "Please sign in to Inspectria, open the Action Plan section, and complete your assigned action plan item(s).",
      actionPlanUrl,
    ].join("\n"),
    html: `
      <p>Hello,</p>
      <p>You have action plan item(s) assigned in <strong>${safeOrganizationName}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Item</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Action</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Remarks</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Due Date</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Status</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Photos</th>
          </tr>
        </thead>
        <tbody>${actionPlanRowsHtml(items)}</tbody>
      </table>
      <p>Please sign in to Inspectria, open the <strong>Action Plan</strong> section, and complete your assigned action plan item(s).</p>
      <p>
        <a
          href="${safeActionPlanUrl}"
          style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700;"
        >
          Open Inspectria Action Plan
        </a>
      </p>
      <p>${safeActionPlanUrl}</p>
    `,
  });
}

async function sendActionPlanCreatedEmail({ to, organizationName, items }) {
  const actionPlanUrl = getPublicAppUrl();
  const safeActionPlanUrl = escapeHtml(actionPlanUrl);

  return sendReportEmail({
    to,
    subject: `Inspectria Action Plan created - ${organizationName || "Organization"}`,
    text: [
      "Hello,",
      "",
      `The following action plan item(s) were created in ${organizationName || "Inspectria"}.`,
      "",
      actionPlanRowsText(items),
      "",
      "You can review and edit them from the Action Plan section in Inspectria.",
      actionPlanUrl,
    ].join("\n"),
    html: `
      <p>Hello,</p>
      <p>The following action plan item(s) were created in <strong>${escapeHtml(organizationName || "Inspectria")}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Item</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Action</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Remarks</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Due Date</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Status</th>
            <th style="padding:8px;border:1px solid #dbe4ea;text-align:left;">Photos</th>
          </tr>
        </thead>
        <tbody>${actionPlanRowsHtml(items)}</tbody>
      </table>
      <p>You can review and edit them from the <strong>Action Plan</strong> section in Inspectria.</p>
      <p>
        <a
          href="${safeActionPlanUrl}"
          style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700;"
        >
          Open Inspectria Action Plan
        </a>
      </p>
      <p>${safeActionPlanUrl}</p>
    `,
  });
}

async function sendActionPlanReminderEmail({ to, organizationName, items }) {
  const actionPlanUrl = getPublicAppUrl();
  const safeActionPlanUrl = escapeHtml(actionPlanUrl);

  return sendReportEmail({
    to,
    subject: "Inspectria Action Plan reminder",
    text: [
      "Hello,",
      "",
      `The following action plan item(s) are due tomorrow in ${organizationName || "Inspectria"}.`,
      "",
      actionPlanRowsText(items),
      "",
      "Please sign in to Inspectria, open the Action Plan section, and complete your assigned action plan item(s).",
      actionPlanUrl,
    ].join("\n"),
    html: `
      <p>Hello,</p>
      <p>The following action plan item(s) are due tomorrow in <strong>${escapeHtml(organizationName || "Inspectria")}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
        <tbody>${actionPlanRowsHtml(items)}</tbody>
      </table>
      <p>Please sign in to Inspectria, open the <strong>Action Plan</strong> section, and complete your assigned action plan item(s).</p>
      <p>
        <a
          href="${safeActionPlanUrl}"
          style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700;"
        >
          Open Inspectria Action Plan
        </a>
      </p>
      <p>${safeActionPlanUrl}</p>
    `,
  });
}

async function sendActionPlanOverdueResponsibleEmail({ to, organizationName, items }) {
  const actionPlanUrl = getPublicAppUrl();
  const safeActionPlanUrl = escapeHtml(actionPlanUrl);

  return sendReportEmail({
    to,
    subject: "Overdue Inspectria Action Plan item(s)",
    text: [
      "Hello,",
      "",
      `The following action plan item(s) are past due in ${organizationName || "Inspectria"} and are not marked Done yet.`,
      "",
      actionPlanRowsText(items),
      "",
      "Please sign in to Inspectria, open the Action Plan section, and complete your assigned action plan item(s). Update Remarks if needed and mark the item Done when completed.",
      actionPlanUrl,
    ].join("\n"),
    html: `
      <p>Hello,</p>
      <p>The following action plan item(s) are past due in <strong>${escapeHtml(organizationName || "Inspectria")}</strong> and are not marked <strong>Done</strong> yet.</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
        <tbody>${actionPlanRowsHtml(items)}</tbody>
      </table>
      <p>Please sign in to Inspectria, open the <strong>Action Plan</strong> section, and complete your assigned action plan item(s). Update Remarks if needed and mark the item <strong>Done</strong> when completed.</p>
      <p>
        <a
          href="${safeActionPlanUrl}"
          style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700;"
        >
          Open Inspectria Action Plan
        </a>
      </p>
      <p>${safeActionPlanUrl}</p>
    `,
  });
}

async function sendActionPlanOverdueAdminEmail({ to, organizationName, items }) {
  return sendReportEmail({
    to,
    subject: `Overdue Inspectria Action Plan item(s) - ${organizationName || "Organization"}`,
    text: [
      "Hello,",
      "",
      `The following action plan item(s) are overdue and not marked Done in ${organizationName || "Inspectria"}.`,
      "",
      actionPlanRowsText(items),
    ].join("\n"),
    html: `
      <p>Hello,</p>
      <p>The following action plan item(s) are overdue and not marked <strong>Done</strong> in <strong>${escapeHtml(organizationName || "Inspectria")}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
        <tbody>${actionPlanRowsHtml(items)}</tbody>
      </table>
    `,
  });
}

async function sendBillingTrialReminderEmail({
  to,
  organizationName,
  planName,
  renewsAt,
  daysBefore,
}) {
  const billingUrl = `${getPublicAppUrl()}/#login?admin=billing`;
  const safeBillingUrl = escapeHtml(billingUrl);
  const safeOrganizationName = escapeHtml(organizationName || "your organization");
  const safePlanName = escapeHtml(planName || "your plan");
  const safeRenewsAt = escapeHtml(renewsAt ? new Date(renewsAt).toLocaleDateString("en-US") : "");
  const dayText = `${daysBefore} day${Number(daysBefore) === 1 ? "" : "s"}`;

  return sendReportEmail({
    to,
    subject: `Inspectria trial ends in ${dayText}`,
    text: [
      "Hello,",
      "",
      `${organizationName || "Your organization"} is currently using the ${planName || "selected"} trial plan.`,
      `Your 7-day trial ends in ${dayText}${renewsAt ? `, on ${new Date(renewsAt).toLocaleDateString("en-US")}` : ""}.`,
      "",
      "Please complete payment from the Billing page to activate your plan before the trial ends.",
      billingUrl,
      "",
      "Best regards,",
      "Inspectria Team",
    ].join("\n"),
    html: `
      <p>Hello,</p>
      <p><strong>${safeOrganizationName}</strong> is currently using the <strong>${safePlanName}</strong> trial plan.</p>
      <p>Your 7-day trial ends in <strong>${escapeHtml(dayText)}</strong>${safeRenewsAt ? `, on <strong>${safeRenewsAt}</strong>` : ""}.</p>
      <p>Please complete payment from the Billing page to activate your plan before the trial ends.</p>
      <p>
        <a
          href="${safeBillingUrl}"
          style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700;"
        >
          Open Billing and Pay
        </a>
      </p>
      <p>${safeBillingUrl}</p>
      <p>Best regards,<br />Inspectria Team</p>
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
  sendActionPlanCreatedEmail,
  sendActionPlanEmail,
  sendActionPlanOverdueAdminEmail,
  sendActionPlanOverdueResponsibleEmail,
  sendActionPlanReminderEmail,
  sendAppMessageEmail,
  sendBillingTrialReminderEmail,
  sendPasswordResetCode,
  sendTemplateShareEmail,
  sendUserRegistrationRequestEmail,
  sendWelcomeEmail,
  verifyEmailConnection,
  sendReportEmail,
};
