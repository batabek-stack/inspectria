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
      "Open Community Templates to use templates shared by other Inspectria users, and share your own templates with the community.",
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
      "Use Community Templates to find templates shared by other Inspectria users, copy them into your organization, and share your own templates with the community.",
      "Assign control tasks by choosing a template and a user in Assignments.",
      "Create, edit, approve, and assign roles to users in User Management.",
      "Review completed reports, export PDF or Excel files, and create Action Plan items with responsible parties, photos, due dates, and email reminders.",
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
      "Review Community Templates shared by Inspectria users and copy useful templates into the relevant organization before editing.",
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

        <section className="support-section" aria-labelledby="support-action-plan-title">
          <div className="support-section-heading">
            <span>ACTION PLAN</span>
            <h2 id="support-action-plan-title">How to use Action Plan</h2>
          </div>
          <div className="support-role-grid">
            <article className="support-role-card">
              <h3>For organization admins</h3>
              <p>
                Use Action Plan to turn follow-up work into assigned, trackable items.
              </p>
              <ul>
                <li>Open the Action Plan menu from the admin dashboard.</li>
                <li>Select the organization and due date, then enter the item, action, and remarks.</li>
                <li>Choose responsible parties from the user dropdown or enter manual email addresses.</li>
                <li>Attach photos when visual evidence or repair context is needed.</li>
                <li>Use Add Item to prepare multiple items, then Create &amp; Send to save and email them.</li>
                <li>Edit existing Action Plan items, update owners, change due dates, add photos, or delete items when needed.</li>
              </ul>
            </article>
            <article className="support-role-card">
              <h3>For assigned users</h3>
              <p>
                Assigned users only see Action Plan items connected to their email address.
              </p>
              <ul>
                <li>Open the Action Plan menu after signing in to Inspectria.</li>
                <li>Review the item, required action, remarks, due date, responsible parties, and photos.</li>
                <li>Update Remarks if you need to leave a progress note or explanation.</li>
                <li>Change Status to In Progress, Blocked, or Done as the work moves forward.</li>
                <li>Mark the item Done once the action is completed.</li>
              </ul>
            </article>
            <article className="support-role-card">
              <h3>Email notifications</h3>
              <p>
                Inspectria sends Action Plan emails automatically when email delivery is configured.
              </p>
              <ul>
                <li>Responsible people receive one email containing their assigned items when the plan is created.</li>
                <li>The creator also receives an email summary of the created Action Plan items.</li>
                <li>Assigned users receive a reminder one day before the due date.</li>
                <li>If an item passes its due date and is not marked Done, overdue reminders continue daily.</li>
                <li>Organization admins are alerted when overdue items remain incomplete.</li>
              </ul>
            </article>
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
