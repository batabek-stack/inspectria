import React, { useMemo, useState } from "react";
import { ReportEmailRecipient } from "../services/emailService";
import { styles } from "../styles/appStyles";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  title: string;
  recipients: ReportEmailRecipient[];
  isSending: boolean;
  onCancel: () => void;
  onSend: (emails: string[]) => Promise<void>;
};

function parseEmailEntries(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export default function ReportEmailDialog({
  title,
  recipients,
  isSending,
  onCancel,
  onSend,
}: Props) {
  const [freeEntry, setFreeEntry] = useState("");
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<number[]>([]);
  const [error, setError] = useState("");

  const eligibleRecipients = useMemo(
    () => recipients.filter((recipient) => Boolean(recipient.email)),
    [recipients]
  );
  const selectedRecipientSet = useMemo(
    () => new Set(selectedRecipientIds),
    [selectedRecipientIds]
  );
  const allSelected =
    eligibleRecipients.length > 0 &&
    selectedRecipientIds.length === eligibleRecipients.length;

  const toggleRecipient = (recipientId: number) => {
    setSelectedRecipientIds((current) =>
      current.includes(recipientId)
        ? current.filter((candidateId) => candidateId !== recipientId)
        : [...current, recipientId]
    );
  };

  const toggleAll = () => {
    setSelectedRecipientIds(
      allSelected ? [] : eligibleRecipients.map((recipient) => recipient.id)
    );
  };

  const submit = async () => {
    const manualEmails = parseEmailEntries(freeEntry);
    const invalidEmail = manualEmails.find((email) => !emailPattern.test(email));

    if (invalidEmail) {
      setError(`Please enter a valid email address: ${invalidEmail}`);
      return;
    }

    const selectedEmails = eligibleRecipients
      .filter((recipient) => selectedRecipientSet.has(recipient.id))
      .map((recipient) => recipient.email.trim().toLowerCase());
    const emails = [...new Set([...manualEmails, ...selectedEmails])];

    if (emails.length === 0) {
      setError("Please enter an email address or select at least one user.");
      return;
    }

    setError("");
    await onSend(emails);
  };

  return (
    <div className="app-modal-backdrop" role="presentation">
      <div className="app-modal" role="dialog" aria-modal="true" aria-labelledby="report-email-title">
        <div className="app-modal-heading">
          <span>Email report</span>
          <h3 id="report-email-title">{title}</h3>
        </div>
        <div className="app-modal-body report-email-dialog">
          <label>
            Free entry
            <input
              type="text"
              placeholder="name@example.com"
              value={freeEntry}
              onChange={(event) => setFreeEntry(event.target.value)}
              disabled={isSending}
            />
          </label>

          <div className="message-recipient-toolbar">
            <label className="message-recipient-check">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={isSending || eligibleRecipients.length === 0}
                onChange={toggleAll}
              />
              Send to all organization users
            </label>
            <span>{selectedRecipientIds.length} selected</span>
          </div>

          {eligibleRecipients.length === 0 ? (
            <div style={styles.small}>No organization users with email addresses found.</div>
          ) : (
            <div className="message-recipient-list" aria-label="Report email recipients">
              {eligibleRecipients.map((recipient) => (
                <label key={recipient.id} className="message-recipient-row">
                  <input
                    type="checkbox"
                    checked={selectedRecipientSet.has(recipient.id)}
                    disabled={isSending}
                    onChange={() => toggleRecipient(recipient.id)}
                  />
                  <span>
                    <strong>{recipient.name || recipient.username}</strong>
                    <small>
                      {recipient.email} | {recipient.role}
                      {recipient.organizationName ? ` | ${recipient.organizationName}` : ""}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          )}

          {error ? <div style={styles.error}>{error}</div> : null}
        </div>
        <div className="app-modal-actions">
          <button type="button" onClick={onCancel} disabled={isSending}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={isSending}>
            {isSending ? "Sending..." : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}
