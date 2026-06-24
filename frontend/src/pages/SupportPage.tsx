import React, { useState } from "react";
import DashboardShell from "../components/DashboardShell";
import { styles } from "../styles/appStyles";
import { User } from "../types";
import { createSupportTicket } from "../services/emailService";

type Props = {
  user: User;
  onLogout: () => Promise<void>;
};

type RoleGuide = {
  key: "user" | "admin" | "topLevel";
  title: string;
  description: string;
  items: string[];
};

const ROLE_GUIDES: RoleGuide[] = [
  {
    key: "user",
    title: "User",
    description: "Complete day-to-day control and on-site inspection work.",
    items: [
      "Open and complete checklists assigned to you, including answers, notes, and photos.",
      "View organization reports available to you and export them as PDF or Excel files.",
      "Select and use templates shared with you by your administrator.",
      "Create walkthrough lists for on-site checks, save drafts, and complete them later.",
      "Follow announcements and shared templates from your organization in Messages.",
    ],
  },
  {
    key: "admin",
    title: "Organization Admin",
    description: "Manage control processes and users in your organization.",
    items: [
      "Create, edit, and share checklist templates in Templates.",
      "Assign control tasks by choosing a template and a user in Assignments.",
      "Create, edit, approve, and assign roles to users in User Management.",
      "Review completed reports, export PDF or Excel files, and create action plans.",
      "Manage flexible on-site inspection lists in Walkthrough.",
    ],
  },
  {
    key: "topLevel",
    title: "Top Level Admin (Enterprise)",
    description: "An Enterprise top-level administrator can manage connected units separately.",
    items: [
      "Create a new sub-organization from Sub Organizations with Create Sub-Organization.",
      "Enter administrator details in the form to create the first admin for that sub-organization in the same flow.",
      "Choose the relevant organization in User Management to create new users and assign admin access when needed.",
      "Assign templates you create to the correct users and organizations through Assignments.",
      "Track reports and users for each sub-organization within their own access boundaries.",
    ],
  },
];

export default function SupportPage({ user, onLogout }: Props) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const submitTicket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");

    try {
      setSending(true);
      await createSupportTicket({ subject, message });
      setSubject("");
      setMessage("");
      setStatus("Your ticket has been sent to the Inspectria Support team. We will get back to you as soon as possible.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Your ticket could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <div className="support-page">
        <div className="support-hero">
          <div>
            <span>INSPECTRIA SUPPORT</span>
            <h1>How can we help?</h1>
            <p>
              Explore what you can do based on your role, or send an issue directly to our
              Support team.
            </p>
          </div>
          <button type="button" style={styles.secondaryButton} onClick={() => { window.location.hash = "top"; }}>
            Back to dashboard
          </button>
        </div>

        <section className="support-section" aria-labelledby="support-roles-title">
          <div className="support-section-heading">
            <span>ROLE GUIDE</span>
            <h2 id="support-roles-title">What can you do in Inspectria?</h2>
          </div>
          <div className="support-role-grid">
            {ROLE_GUIDES.map((guide) => {
              const isCurrentRole = guide.key === user.role || (guide.key === "topLevel" && user.role === "admin");
              return (
                <article className={`support-role-card${isCurrentRole ? " support-role-card-current" : ""}`} key={guide.key}>
                  {isCurrentRole ? <div className="support-current-role">YOUR ROLE</div> : null}
                  <h3>{guide.title}</h3>
                  <p>{guide.description}</p>
                  <ul>
                    {guide.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>

        <section className="support-ticket-section" aria-labelledby="ticket-title">
          <div className="support-ticket-copy">
            <span>CREATE A TICKET</span>
            <h2 id="ticket-title">Are you experiencing an issue?</h2>
            <p>
              Describe your issue in as much detail as possible. Your ticket will be sent to
              the Inspectria Support team together with your account, role, and organization details.
            </p>
            <p className="support-ticket-email">Sent to: info@inspectria.com</p>
          </div>
          <form className="support-ticket-form" onSubmit={submitTicket}>
            <label>
              Subject
              <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} required placeholder="For example: I cannot see my checklist assignment" />
            </label>
            <label>
              Your issue
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} required placeholder="Tell us what you were trying to do and what happened." />
            </label>
            {status ? <div className={status.startsWith("Your ticket has") ? "support-ticket-success" : "support-ticket-error"}>{status}</div> : null}
            <button type="submit" style={styles.button} disabled={sending}>
              {sending ? "Sending..." : "Send support ticket"}
            </button>
          </form>
        </section>
      </div>
    </DashboardShell>
  );
}
