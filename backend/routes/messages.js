const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");

const router = express.Router();

async function copyChecklistToOrganization(client, sourceChecklistId, targetOrganizationId) {
  const source = await client.query(
    `
    SELECT id, title, image_path
    FROM checklists
    WHERE id = $1
  `,
    [sourceChecklistId]
  );

  const checklist = source.rows[0];
  if (!checklist) {
    throw Object.assign(new Error("Shared template not found"), { statusCode: 404 });
  }

  const checklistResult = await client.query(
    `
    INSERT INTO checklists (organization_id, title, image_path, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id
  `,
    [targetOrganizationId, checklist.title, checklist.image_path || ""]
  );

  const nextChecklistId = checklistResult.rows[0].id;
  const sections = await client.query(
    `
    SELECT id, title, sort_order
    FROM checklist_sections
    WHERE checklist_id = $1
    ORDER BY sort_order
  `,
    [sourceChecklistId]
  );

  for (const section of sections.rows) {
    const sectionResult = await client.query(
      `
      INSERT INTO checklist_sections (checklist_id, title, sort_order)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [nextChecklistId, section.title, section.sort_order]
    );

    const nextSectionId = sectionResult.rows[0].id;
    const items = await client.query(
      `
      SELECT question, answer_type, options_json, sort_order
      FROM checklist_items
      WHERE checklist_id = $1 AND section_id = $2
      ORDER BY sort_order
    `,
      [sourceChecklistId, section.id]
    );

    for (const item of items.rows) {
      await client.query(
        `
        INSERT INTO checklist_items
          (checklist_id, section_id, question, answer_type, options_json, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [
          nextChecklistId,
          nextSectionId,
          item.question,
          item.answer_type || "FORMAT1",
          item.options_json || "[]",
          item.sort_order,
        ]
      );
    }
  }

  return {
    id: nextChecklistId,
    title: checklist.title,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    type: row.message_type,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
    senderName: row.sender_name || "",
    templateTitle: row.template_title || "",
    templateShareId: row.template_share_id,
    importedAt: row.imported_at,
    expiresAt: row.expires_at,
  };
}

router.get("/", authRequired, async (req, res, next) => {
  try {
    const rows = await db.many(
      `
      SELECT
        m.*,
        sender.name AS sender_name,
        c.title AS template_title,
        ts.imported_at,
        ts.expires_at
      FROM app_messages m
      LEFT JOIN users sender ON sender.id = m.sender_user_id
      LEFT JOIN template_shares ts ON ts.id = m.template_share_id
      LEFT JOIN checklists c ON c.id = ts.checklist_id
      WHERE m.recipient_user_id = $1
      ORDER BY m.created_at DESC
      LIMIT 100
    `,
      [req.user.id]
    );

    res.json({
      messages: rows.map(mapMessage),
      unreadCount: rows.filter((row) => !row.read_at).length,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const rawRecipientIds = Array.isArray(req.body?.recipientUserIds)
      ? req.body.recipientUserIds
      : [];
    const recipientUserIds = [...new Set(rawRecipientIds.map(Number).filter(Boolean))];
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();

    if (recipientUserIds.length === 0) {
      return res.status(400).json({ message: "At least one recipient is required" });
    }

    if (!title || !body) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    if (title.length > 160) {
      return res.status(400).json({ message: "Subject must be 160 characters or fewer" });
    }

    if (body.length > 4000) {
      return res.status(400).json({ message: "Message must be 4000 characters or fewer" });
    }

    const scopeIds = await db.getManagedOrganizationIds(req.user);
    if (scopeIds.length === 0) {
      return res.status(403).json({ message: "No managed organizations found" });
    }

    const recipients = await db.many(
      `
      SELECT id
      FROM users
      WHERE id = ANY($1::int[])
        AND organization_id = ANY($2::int[])
        AND role IN ('admin', 'user')
        AND active = TRUE
        AND approval_status = 'approved'
      ORDER BY id
    `,
      [recipientUserIds, scopeIds]
    );

    if (recipients.length === 0) {
      return res.status(400).json({ message: "No eligible recipients were found" });
    }

    await db.transaction(async (client) => {
      for (const recipient of recipients) {
        await client.query(
          `
          INSERT INTO app_messages
            (recipient_user_id, sender_user_id, message_type, title, body)
          VALUES ($1, $2, 'general', $3, $4)
        `,
          [recipient.id, req.user.id, title, body]
        );
      }
    });

    res.status(201).json({
      success: true,
      sentCount: recipients.length,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/read", authRequired, async (req, res, next) => {
  try {
    const messageId = Number(req.params.id);
    if (!messageId) return res.status(400).json({ message: "Invalid message id" });

    const message = await db.one(
      `
      UPDATE app_messages
      SET read_at = COALESCE(read_at, NOW())
      WHERE id = $1 AND recipient_user_id = $2
      RETURNING id
    `,
      [messageId, req.user.id]
    );

    if (!message) return res.status(404).json({ message: "Message not found" });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/import-template", authRequired, adminOnly, async (req, res, next) => {
  try {
    const messageId = Number(req.params.id);
    if (!messageId) return res.status(400).json({ message: "Invalid message id" });
    if (!req.user.organizationId) {
      return res.status(400).json({ message: "Your account is not linked to an organization" });
    }

    const imported = await db.transaction(async (client) => {
      const messageResult = await client.query(
        `
        SELECT
          m.id,
          m.template_share_id,
          ts.checklist_id,
          ts.imported_at,
          ts.expires_at
        FROM app_messages m
        JOIN template_shares ts ON ts.id = m.template_share_id
        WHERE m.id = $1
          AND m.recipient_user_id = $2
          AND m.message_type = 'template_share'
        LIMIT 1
      `,
        [messageId, req.user.id]
      );

      const message = messageResult.rows[0];
      if (!message) {
        throw Object.assign(new Error("Message not found"), { statusCode: 404 });
      }

      if (message.imported_at) {
        throw Object.assign(new Error("Shared template was already imported"), {
          statusCode: 400,
        });
      }

      if (new Date(message.expires_at).getTime() < Date.now()) {
        throw Object.assign(new Error("Shared template link has expired"), { statusCode: 400 });
      }

      const nextChecklist = await copyChecklistToOrganization(
        client,
        message.checklist_id,
        req.user.organizationId
      );

      await client.query(
        `
        UPDATE template_shares
        SET imported_by_user_id = $1, imported_at = NOW()
        WHERE id = $2
      `,
        [req.user.id, message.template_share_id]
      );

      await client.query(
        `
        UPDATE app_messages
        SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1
      `,
        [message.id]
      );

      return nextChecklist;
    });

    res.json({
      success: true,
      checklistId: imported.id,
      title: imported.title,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
