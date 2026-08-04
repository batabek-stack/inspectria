import React, { useState } from "react";
import { sendContactMessage } from "../services/emailService";

type Props = {
  onSignIn: () => void;
  onRegister: () => void;
};

const inspectionFlows = [
  "Room readiness",
  "Maintenance follow-up",
  "Housekeeping standards",
  "Manager approvals",
];

const featureBlocks = [
  {
    title: "Checklist control",
    body: "Create consistent inspection templates for each property, department, or operating standard.",
  },
  {
    title: "Evidence-rich reports",
    body: "Capture notes, scores, photos, and action points in one operational record.",
  },
  {
    title: "Multi-property oversight",
    body: "Keep organizations separated while giving leaders a clean view of quality performance.",
  },
];

const productFeatures = [
  {
    title: "Import your Excel checklist",
    body: "Upload existing Excel checklist questions and turn them into reusable digital inspection templates.",
  },
  {
    title: "AI creates your action plan",
    body: "Convert failed inspection items into a structured action plan with priority, department, owner, due date, root cause, and corrective action.",
  },
  {
    title: "Assigned Action Plan follow-up",
    body: "Create action items, assign one or more responsible users, attach photos, set due dates, and track open work until it is marked Done.",
  },
  {
    title: "Photo evidence for every finding",
    body: "Attach inspection photos directly to checklist answers so every report carries clear visual proof.",
  },
  {
    title: "Save drafts and continue later",
    body: "Inspectors can pause an inspection, keep a draft, and finish the same assignment later without losing work.",
  },
  {
    title: "PDF inspection reports",
    body: "Download professional PDF reports with answers, notes, scores, and attached photos.",
  },
  {
    title: "Excel exports for reports and action plans",
    body: "Export completed reports or AI-generated action plans to Excel for meetings, follow-up, and record keeping.",
  },
  {
    title: "Action Plan email reminders",
    body: "Notify assigned people when an action plan is created, remind them before the due date, and continue overdue reminders until completion.",
  },
  {
    title: "Role-based access",
    body: "Platform admins, organization admins, and users each get the right level of access for their responsibilities.",
  },
  {
    title: "Multi-organization structure",
    body: "Keep each hotel or company account separated with organization-level users, reports, checklists, and assignments.",
  },
];

const industryUseCases = [
  {
    title: "Hotels and resorts",
    body: "Run room inspections, MOD audits, housekeeping checks, brand standard reviews, and guest area quality controls from one digital checklist system.",
  },
  {
    title: "Housekeeping and rooms division",
    body: "Standardize room readiness, minibar, linen, amenities, maintenance defects, and supervisor follow-up with photo-supported reports.",
  },
  {
    title: "Facility and maintenance teams",
    body: "Track preventive maintenance inspections, safety checks, equipment defects, repair follow-up, and recurring operational issues.",
  },
  {
    title: "Restaurants, bars, and kitchens",
    body: "Use digital checklists for hygiene, opening and closing duties, food safety observations, service standards, and corrective actions.",
  },
  {
    title: "Spa, wellness, and recreation",
    body: "Inspect treatment rooms, pool areas, fitness equipment, cleanliness, guest safety, and daily operating standards.",
  },
  {
    title: "Retail and multi-site operations",
    body: "Keep store visits, branch audits, visual standards, staff checklists, and regional quality reports consistent across locations.",
  },
];

const metrics = [
  { value: "24/7", label: "inspection access" },
  { value: "1", label: "source of truth" },
  { value: "PDF", label: "report export" },
];

const pricingPlans = [
  {
    name: "Starter",
    price: "$29",
    period: "per month",
    yearlyPrice: "$290 per year",
    detail: "Small teams starting digital inspection workflows.",
    limits: "5 users | 25 templates | 90 days retention",
  },
  {
    name: "Professional",
    price: "$79",
    period: "per month",
    yearlyPrice: "$790 per year",
    detail: "Hotels and departments running daily inspection operations.",
    limits: "25 users | Unlimited templates | 365 days retention",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "$149",
    period: "per month",
    yearlyPrice: "$1,490 per year",
    detail: "Multi-property operations with extended retention and controlled scale.",
    limits: "100 users | Unlimited templates | 1095 days retention",
  },
];

export default function LandingPage({ onSignIn, onRegister }: Props) {
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactOrganization, setContactOrganization] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactWebsite, setContactWebsite] = useState("");
  const [contactStatus, setContactStatus] = useState("");
  const [contactError, setContactError] = useState("");
  const [contactSending, setContactSending] = useState(false);

  const submitContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setContactStatus("");
    setContactError("");
    setContactSending(true);

    try {
      await sendContactMessage({
        name: contactName,
        email: contactEmail,
        organization: contactOrganization,
        message: contactMessage,
        website: contactWebsite,
      });
      setContactStatus("Thanks. Your message has been sent to info@inspectria.com.");
      setContactName("");
      setContactEmail("");
      setContactOrganization("");
      setContactMessage("");
      setContactWebsite("");
    } catch (error) {
      setContactError(error instanceof Error ? error.message : "Message could not be sent.");
    } finally {
      setContactSending(false);
    }
  };

  return (
    <main className="marketing-page">
      <header className="marketing-nav" aria-label="Inspectria">
        <a className="marketing-brand" href="#top" aria-label="Inspectria home">
          <img src="/inspectra-logo.png" alt="" />
          <span>Inspectria</span>
        </a>
        <nav className="marketing-links" aria-label="Primary navigation">
          <a href="#platform">Platform</a>
          <a href="#features">Features</a>
          <a href="#industries">Industries</a>
          <a href="#workflow">Workflow</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </nav>
        <button className="marketing-signin" type="button" onClick={onSignIn}>
          Sign in
        </button>
      </header>

      <section className="marketing-hero" id="top">
        <div className="hero-copy">
          <p className="hero-kicker">Hotel inspection operations</p>
          <h1>Inspectria</h1>
          <p className="hero-lede">
            A focused quality-control workspace for hotel teams that need clean checklists,
            reliable evidence, and fast management follow-up.
          </p>
          <div className="hero-actions" aria-label="Primary actions">
            <button className="primary-action" type="button" onClick={onSignIn}>
              Open workspace
            </button>
            <button className="secondary-action" type="button" onClick={onRegister}>
              Create user request
            </button>
          </div>
        </div>

        <div className="hero-visual" aria-label="Inspectria inspection dashboard preview">
          <div className="device-frame">
            <div className="device-toolbar">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-header">
              <img src="/inspectra-logo.png" alt="" />
              <div>
                <strong>Daily MOD Audit</strong>
                <span>Sofitel Istanbul Taksim</span>
              </div>
            </div>
            <div className="score-panel">
              <div>
                <span className="score-label">Current score</span>
                <strong>94%</strong>
              </div>
              <span className="score-status">Ready</span>
            </div>
            <div className="checklist-preview">
              {inspectionFlows.map((item, index) => (
                <div className="check-row" key={item}>
                  <span className="check-dot" />
                  <span>{item}</span>
                  <strong>{index === 1 ? "2 open" : "OK"}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="metrics-band" aria-label="Inspectria highlights">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </section>

      <section className="content-section" id="platform">
        <div className="section-heading">
          <p>Platform</p>
          <h2>Built for inspections that turn into action.</h2>
        </div>
        <div className="feature-grid">
          {featureBlocks.map((feature) => (
            <article className="feature-card" key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="features-section" id="features">
        <div className="section-heading">
          <p>Product Features</p>
          <h2>Everything your inspection team needs in one place.</h2>
        </div>
        <div className="product-feature-grid">
          {productFeatures.map((feature) => (
            <article className="product-feature" key={feature.title}>
              <span aria-hidden="true">✓</span>
              <div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="industries-section" id="industries">
        <div className="section-heading">
          <p>Industries</p>
          <h2>Inspection software for service, safety, and quality teams.</h2>
        </div>
        <p className="seo-intro">
          Inspectria is built for businesses that need digital inspection checklists,
          operational audit reports, photo evidence, and AI-generated action plans.
          Hospitality teams, facility managers, housekeeping supervisors, restaurant
          operators, and multi-location businesses can use Inspectria to replace paper
          checklists and scattered Excel files with a clearer inspection workflow.
        </p>
        <div className="industry-grid">
          {industryUseCases.map((industry) => (
            <article className="industry-card" key={industry.title}>
              <h3>{industry.title}</h3>
              <p>{industry.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading">
          <p>Workflow</p>
          <h2>From checklist to accountable report.</h2>
        </div>
        <div className="workflow-steps">
          <div>
            <span>01</span>
            <h3>Assign</h3>
            <p>Send the right checklist to the right user or department.</p>
          </div>
          <div>
            <span>02</span>
            <h3>Inspect</h3>
            <p>Record findings, upload supporting photos, and keep drafts moving.</p>
          </div>
          <div>
            <span>03</span>
            <h3>Improve</h3>
            <p>Review reports, assign action plan owners, and follow each item through to completion.</p>
          </div>
        </div>
      </section>

      <section className="pricing-section" id="pricing">
        <div className="section-heading">
          <p>Pricing</p>
          <h2>Start with 7 days free trial.</h2>
        </div>
        <div className="pricing-grid">
          {pricingPlans.map((plan) => (
            <article
              className={plan.featured ? "pricing-card pricing-card-featured" : "pricing-card"}
              key={plan.name}
            >
              {plan.featured ? <span className="pricing-badge">Popular</span> : null}
              <h3>{plan.name}</h3>
              <div className="pricing-price">
                <strong>{plan.price}</strong>
                <span>{plan.period}</span>
              </div>
              <div className="promotion-pill">{plan.yearlyPrice}</div>
              <p>{plan.detail}</p>
              <p>{plan.limits}</p>
              <button className="primary-action" type="button" onClick={onSignIn}>
                Start free trial
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div className="contact-copy">
          <p>Ready when your team is.</p>
          <h2>Bring Inspectria into the daily rhythm of hotel quality.</h2>
          <a href="mailto:info@inspectria.com">info@inspectria.com</a>
        </div>
        <form className="contact-form" onSubmit={submitContact}>
          <input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            placeholder="Name"
            required
          />
          <input
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="Email"
            type="email"
            required
          />
          <input
            value={contactOrganization}
            onChange={(event) => setContactOrganization(event.target.value)}
            placeholder="Organization"
          />
          <input
            className="contact-hidden"
            value={contactWebsite}
            onChange={(event) => setContactWebsite(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
          <textarea
            value={contactMessage}
            onChange={(event) => setContactMessage(event.target.value)}
            placeholder="How can we help?"
            rows={5}
            required
          />
          {contactStatus ? <div className="contact-success">{contactStatus}</div> : null}
          {contactError ? <div className="contact-error">{contactError}</div> : null}
          <div className="contact-actions">
            <button className="primary-action" type="submit" disabled={contactSending}>
              {contactSending ? "Sending..." : "Send message"}
            </button>
            <button className="secondary-action" type="button" onClick={onSignIn}>
              Continue to Inspectria
            </button>
          </div>
        </form>
      </section>

      <footer className="marketing-footer">
        <div>
          <a className="marketing-brand" href="#top" aria-label="Inspectria home">
            <img src="/inspectra-logo.png" alt="" />
            <span>Inspectria</span>
          </a>
          <p>Digital inspection software for checklists, reports, and AI action plans.</p>
        </div>
        <nav aria-label="Legal links">
          <a href="#terms">Terms</a>
          <a href="#privacy">Privacy</a>
          <a href="#cookies">Cookies</a>
          <a href="#refund">Refunds</a>
        </nav>
      </footer>
    </main>
  );
}
