import React from "react";

type LegalPageKey = "terms" | "privacy" | "cookies" | "refund";

type Props = {
  page: LegalPageKey;
};

type LegalSection = {
  title: string;
  paragraphs: string[];
};

type LegalDocument = {
  title: string;
  intro: string;
  sections: LegalSection[];
};

const lastUpdated = "May 11, 2026";

const legalDocuments: Record<LegalPageKey, LegalDocument> = {
  terms: {
    title: "Terms of Service",
    intro:
      "These Terms of Service explain the rules for using Inspectria, a digital inspection and quality-control software platform.",
    sections: [
      {
        title: "1. Acceptance of these terms",
        paragraphs: [
          "By accessing or using Inspectria, you agree to these Terms of Service. If you use Inspectria on behalf of a company or organization, you confirm that you have authority to accept these terms for that organization.",
          "If you do not agree with these terms, you should not use the service.",
        ],
      },
      {
        title: "2. The service",
        paragraphs: [
          "Inspectria provides tools for digital checklists, inspections, assignments, reports, photo evidence, Excel imports and exports, PDF reports, and AI-assisted action plan generation.",
          "We may improve, modify, suspend, or discontinue parts of the service as needed for security, reliability, legal, or business reasons.",
        ],
      },
      {
        title: "3. Accounts and organizations",
        paragraphs: [
          "You are responsible for keeping account credentials secure and for all activity that happens through your account.",
          "Organization administrators are responsible for managing users, permissions, checklists, assignments, reports, and data within their organization workspace.",
        ],
      },
      {
        title: "4. Customer data",
        paragraphs: [
          "You retain ownership of data, files, reports, photos, checklist content, and other materials submitted to Inspectria.",
          "You grant Inspectria the limited right to process customer data only as needed to provide, secure, maintain, support, and improve the service.",
        ],
      },
      {
        title: "5. File storage and retention",
        paragraphs: [
          "Inspection photos and uploaded files may be stored by Inspectria so they can be attached to drafts, checklists, completed reports, PDF exports, and related service features.",
          "To control storage use and improve performance, uploaded images may be resized, compressed, converted to another image format such as WebP, and stored at a reduced quality level. Video uploads are not permitted unless expressly enabled for the applicable service plan or deployment.",
          "Files uploaded temporarily but not linked to a draft, checklist, report, or other active record may be automatically deleted after 24 hours. Attachments linked to deleted reports may be retained for up to 30 days before permanent deletion, unless a longer period is required for backup, legal, security, or operational reasons.",
          "System logs and diagnostic records may be rotated, compressed, and deleted on a scheduled basis. Logs may include technical information needed to operate, troubleshoot, secure, and audit the service.",
        ],
      },
      {
        title: "6. Acceptable use",
        paragraphs: [
          "You must not misuse the service, attempt unauthorized access, interfere with service operations, upload malicious files, violate applicable law, or use Inspectria to process data you are not authorized to handle.",
          "You are responsible for ensuring that inspection content, uploaded photos, and exported reports comply with your internal policies and applicable laws.",
        ],
      },
      {
        title: "7. AI-generated action plans",
        paragraphs: [
          "AI-assisted outputs may help summarize findings and suggest action plans, but they may be incomplete or inaccurate.",
          "You are responsible for reviewing AI-generated content before relying on it for operational, safety, legal, employment, or compliance decisions.",
        ],
      },
      {
        title: "8. Subscriptions and payment",
        paragraphs: [
          "Paid plans, trial periods, renewal terms, taxes, and cancellation options are shown at checkout or in the applicable order process.",
          "Access to paid features may be limited, suspended, or terminated if payment fails, a trial expires, or an account violates these terms.",
        ],
      },
      {
        title: "9. Limitation of liability",
        paragraphs: [
          "To the maximum extent permitted by law, Inspectria is provided on an as-is and as-available basis.",
          "Inspectria is not responsible for indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost revenue, lost data, or business interruption.",
        ],
      },
      {
        title: "10. Changes to these terms",
        paragraphs: [
          "We may update these terms from time to time. When changes are material, we will take reasonable steps to notify users or make the updated terms available through the service.",
          "Continued use of Inspectria after the updated terms become effective means you accept the updated terms.",
        ],
      },
      {
        title: "11. Contact",
        paragraphs: [
          "Questions about these terms can be sent to support@inspectria.com.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro:
      "This Privacy Policy describes how Inspectria collects, uses, stores, and protects personal information when you visit our website or use our software.",
    sections: [
      {
        title: "1. Information we collect",
        paragraphs: [
          "We may collect account information such as name, username, organization name, email address, role, password credentials, subscription status, and support communications.",
          "When you use the service, we may process checklist templates, assignments, reports, photos, notes, scores, uploaded files, usage logs, device information, IP address, and technical diagnostics.",
        ],
      },
      {
        title: "2. How we use information",
        paragraphs: [
          "We use information to provide the service, authenticate users, manage organizations, process subscriptions, generate reports, support customers, improve reliability, detect abuse, and comply with legal obligations.",
          "We may use aggregated or de-identified information to understand product performance and improve Inspectria.",
        ],
      },
      {
        title: "3. Legal bases and customer responsibility",
        paragraphs: [
          "Where applicable privacy laws require a legal basis, processing may be based on contract performance, legitimate interests, consent, legal obligations, or another lawful basis depending on the context.",
          "Customers are responsible for ensuring they have appropriate rights and notices before uploading personal data, employee information, guest information, images, or inspection records into Inspectria.",
        ],
      },
      {
        title: "4. Service providers",
        paragraphs: [
          "We may use trusted service providers for hosting, database storage, analytics, payments, email delivery, AI processing, customer support, and security.",
          "Service providers are expected to process information only as needed to provide services to Inspectria and under appropriate confidentiality and security obligations.",
        ],
      },
      {
        title: "5. Payments",
        paragraphs: [
          "Payment card details should be processed by the selected payment provider and not stored directly by Inspectria.",
          "We may store payment status, plan type, subscription identifiers, invoices, renewal dates, and transaction metadata needed to manage billing.",
        ],
      },
      {
        title: "6. Security",
        paragraphs: [
          "We use reasonable technical and organizational measures designed to protect information against unauthorized access, loss, misuse, or alteration.",
          "No online service can guarantee absolute security. Users should protect passwords, limit account access, and promptly report suspected security issues.",
        ],
      },
      {
        title: "7. Retention",
        paragraphs: [
          "We keep information for as long as needed to provide the service, comply with legal obligations, resolve disputes, maintain backups, enforce agreements, and support legitimate business operations.",
          "Customers may request deletion or export of their data, subject to legal, security, backup, and contractual limitations.",
        ],
      },
      {
        title: "8. International transfers",
        paragraphs: [
          "Depending on hosting, payment, email, analytics, and AI providers, information may be processed in countries other than the country where the user is located.",
          "Where required, we aim to use appropriate safeguards for international transfers.",
        ],
      },
      {
        title: "9. Your rights",
        paragraphs: [
          "Depending on your location, you may have rights to access, correct, delete, restrict, object to processing, request portability, or withdraw consent.",
          "Requests can be sent to support@inspectria.com. We may need to verify your identity and your relationship to the relevant organization before acting on a request.",
        ],
      },
      {
        title: "10. Contact",
        paragraphs: [
          "Questions about this Privacy Policy can be sent to support@inspectria.com.",
        ],
      },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    intro:
      "This Cookie Policy explains how Inspectria may use cookies and similar technologies on its website and application.",
    sections: [
      {
        title: "1. What cookies are",
        paragraphs: [
          "Cookies are small text files stored on your device by a website or application. Similar technologies may include local storage, session storage, pixels, and device identifiers.",
        ],
      },
      {
        title: "2. Cookies we may use",
        paragraphs: [
          "Strictly necessary cookies and local storage help keep users signed in, protect sessions, remember security settings, and operate the application.",
          "Preference cookies may remember interface choices. Analytics cookies may help us understand website performance and usage if analytics tools are enabled.",
        ],
      },
      {
        title: "3. Third-party technologies",
        paragraphs: [
          "Payment, analytics, hosting, support, or embedded tools may set their own cookies or similar technologies when those services are used.",
          "Third-party providers are responsible for their own privacy and cookie practices.",
        ],
      },
      {
        title: "4. Managing cookies",
        paragraphs: [
          "Most browsers let you block, delete, or limit cookies through browser settings.",
          "Blocking strictly necessary cookies or local storage may prevent login, security features, saved drafts, or other application functions from working correctly.",
        ],
      },
      {
        title: "5. Updates",
        paragraphs: [
          "We may update this Cookie Policy as our website, application, or technology providers change.",
        ],
      },
      {
        title: "6. Contact",
        paragraphs: [
          "Questions about this Cookie Policy can be sent to support@inspectria.com.",
        ],
      },
    ],
  },
  refund: {
    title: "Refund and Cancellation Policy",
    intro:
      "This Refund and Cancellation Policy explains how trial periods, subscription cancellations, and refund requests are handled for Inspectria.",
    sections: [
      {
        title: "1. Free trial",
        paragraphs: [
          "Inspectria may offer a 7-day free trial for eligible new customers. Trial availability, duration, and requirements may be shown at signup or checkout.",
          "If payment details are required for a trial, the selected plan may automatically begin after the trial unless the subscription is canceled before the trial ends.",
        ],
      },
      {
        title: "2. Subscription renewals",
        paragraphs: [
          "Monthly, 12-month, and 24-month plans renew according to the billing terms shown at checkout unless canceled before renewal.",
          "Customers are responsible for reviewing the plan, price, billing cycle, renewal date, and taxes before completing payment.",
        ],
      },
      {
        title: "3. Cancellation",
        paragraphs: [
          "You may request cancellation by contacting support@inspectria.com or by using any available billing controls in the application.",
          "Cancellation stops future renewals. Unless required by law or expressly stated otherwise, cancellation does not automatically refund fees already paid for the active billing period.",
        ],
      },
      {
        title: "4. Refund requests",
        paragraphs: [
          "Refund requests are reviewed case by case. We may consider refunds for duplicate charges, billing errors, technical issues that prevent reasonable use of the service, or other circumstances we determine are appropriate.",
          "Refunds may be refused where the service has been used substantially, the request is made after the active billing period, the account violated our Terms of Service, or the payment provider cannot process the refund.",
        ],
      },
      {
        title: "5. Taxes and payment provider fees",
        paragraphs: [
          "Taxes, bank charges, currency conversion fees, and payment provider fees may be handled according to the rules of the applicable payment provider and local law.",
        ],
      },
      {
        title: "6. Account access after cancellation",
        paragraphs: [
          "After cancellation, access may continue until the end of the paid period unless the account is terminated for violation of the Terms of Service or another valid reason.",
          "After access ends, some features may be disabled and customer data may be retained or deleted according to the Privacy Policy and applicable data retention practices.",
        ],
      },
      {
        title: "7. Contact",
        paragraphs: [
          "Cancellation and refund questions can be sent to support@inspectria.com.",
        ],
      },
    ],
  },
};

export function isLegalPageHash(hash: string): hash is `#${LegalPageKey}` {
  return ["#terms", "#privacy", "#cookies", "#refund"].includes(hash);
}

export function getLegalPageFromHash(hash: string): LegalPageKey {
  if (hash === "#privacy") return "privacy";
  if (hash === "#cookies") return "cookies";
  if (hash === "#refund") return "refund";
  return "terms";
}

export default function LegalPage({ page }: Props) {
  const document = legalDocuments[page];

  return (
    <main className="legal-page">
      <header className="legal-header">
        <a className="marketing-brand" href="/#top" aria-label="Inspectria home">
          <img src="/inspectra-logo.png" alt="" />
          <span>Inspectria</span>
        </a>
        <nav className="legal-nav" aria-label="Legal pages">
          <a href="#terms">Terms</a>
          <a href="#privacy">Privacy</a>
          <a href="#cookies">Cookies</a>
          <a href="#refund">Refunds</a>
        </nav>
      </header>

      <article className="legal-document">
        <p className="legal-kicker">Legal</p>
        <h1>{document.title}</h1>
        <p className="legal-updated">Last updated: {lastUpdated}</p>
        <p className="legal-intro">{document.intro}</p>
        <p className="legal-note">
          This page is a general template for Inspectria and is not legal advice. Please
          review it with qualified legal counsel before public launch.
        </p>

        {document.sections.map((section) => (
          <section className="legal-section" key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
