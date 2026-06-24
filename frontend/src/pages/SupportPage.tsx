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
  key: "user" | "admin" | "topLevel" | "platform_admin";
  title: string;
  description: string;
  items: string[];
};

const ROLE_GUIDES: RoleGuide[] = [
  {
    key: "user",
    title: "User",
    description: "Günlük kontrol ve saha denetim çalışmalarını yürütür.",
    items: [
      "Size atanmış checklist'leri açıp doldurabilir; yanıt, not ve fotoğraf ekleyebilirsiniz.",
      "Size açık olan organizasyon raporlarını görüntüleyebilir, PDF veya Excel olarak dışa aktarabilirsiniz.",
      "Yönetici tarafından sizinle paylaşılan template'leri seçip kullanabilirsiniz.",
      "Saha kontrolleri için Walkthrough listeleri oluşturabilir, taslak kaydedip daha sonra tamamlayabilirsiniz.",
      "Mesajlar alanından organizasyonunuzdaki duyuru ve template paylaşımlarını takip edebilirsiniz.",
    ],
  },
  {
    key: "admin",
    title: "Organization Admin",
    description: "Kendi organizasyonunuzdaki kontrol süreçlerini ve kullanıcıları yönetir.",
    items: [
      "Templates alanından checklist şablonları oluşturabilir, düzenleyebilir ve paylaşabilirsiniz.",
      "Assignments alanından bir template ve kullanıcı seçerek kontrol görevleri atayabilirsiniz.",
      "User Management alanından kullanıcı oluşturabilir, düzenleyebilir, onaylayabilir ve rollerini belirleyebilirsiniz.",
      "Completed Reports alanından tamamlanan raporları inceleyebilir, PDF/Excel çıktısı alabilir ve aksiyon planı oluşturabilirsiniz.",
      "Walkthrough alanından sahada kullanılacak serbest denetim listelerini yönetebilirsiniz.",
    ],
  },
  {
    key: "topLevel",
    title: "Top Level Admin (Enterprise)",
    description: "Enterprise planındaki üst organizasyon yöneticisi, bağlı birimleri ayrı ayrı yönetebilir.",
    items: [
      "Sub Organizations alanında Create Sub-Organization ile yeni bir alt organizasyon oluşturun.",
      "Formdaki yönetici bilgilerini girerek alt organizasyonun ilk admin kullanıcısını aynı akışta tanımlayın.",
      "User Management içinde ilgili organizasyonu seçip yeni kullanıcılar oluşturun; gerektiğinde admin rolü atayın.",
      "Templates'te hazırladığınız şablonları Assignments üzerinden doğru kullanıcıya ve organizasyona atayın.",
      "Her alt organizasyonun raporlarını ve kullanıcılarını kendi erişim sınırları içinde ayrı olarak takip edin.",
    ],
  },
  {
    key: "platform_admin",
    title: "Platform Admin",
    description: "Inspectria platformundaki organizasyonları, planları ve ilk yönetici hesaplarını yönetir.",
    items: [
      "Organizations alanından üst seviye organizasyonları ve ilk admin hesaplarını oluşturabilirsiniz.",
      "Billing alanından plan, abonelik ve kullanım limitlerini takip edebilirsiniz.",
      "Organization User List üzerinden tüm organizasyonlardaki kullanıcıları görüntüleyebilirsiniz.",
      "Bir organizasyonun kendi operasyonunu yönetmesi için uygun admin kullanıcılarını tanımlayabilirsiniz.",
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
      setStatus("Ticket'ınız Inspectria Support ekibine iletildi. En kısa sürede dönüş yapacağız.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ticket gönderilemedi. Lütfen tekrar deneyin.");
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
            <h1>Nasıl yardımcı olabiliriz?</h1>
            <p>
              Rolünüze göre yapabileceklerinizi inceleyin veya yaşadığınız sorunu doğrudan
              Support ekibimize iletin.
            </p>
          </div>
          <button type="button" style={styles.secondaryButton} onClick={() => { window.location.hash = "top"; }}>
            Panele dön
          </button>
        </div>

        <section className="support-section" aria-labelledby="support-roles-title">
          <div className="support-section-heading">
            <span>ROL REHBERİ</span>
            <h2 id="support-roles-title">Inspectria'da neler yapabilirsiniz?</h2>
          </div>
          <div className="support-role-grid">
            {ROLE_GUIDES.map((guide) => {
              const isCurrentRole = guide.key === user.role || (guide.key === "topLevel" && user.role === "admin");
              return (
                <article className={`support-role-card${isCurrentRole ? " support-role-card-current" : ""}`} key={guide.key}>
                  {isCurrentRole ? <div className="support-current-role">SİZİN ROLÜNÜZ</div> : null}
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
            <span>TICKET OLUŞTURUN</span>
            <h2 id="ticket-title">Bir sorun mu yaşıyorsunuz?</h2>
            <p>
              Sorununuzu mümkün olduğunca ayrıntılı yazın. Ticket; hesabınız, rolünüz ve
              organizasyon bilgilerinizle birlikte Inspectria Support ekibine gönderilir.
            </p>
            <p className="support-ticket-email">Gönderim adresi: info@inspectria.com</p>
          </div>
          <form className="support-ticket-form" onSubmit={submitTicket}>
            <label>
              Konu
              <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} required placeholder="Örn. Checklist ataması görünmüyor" />
            </label>
            <label>
              Sorununuz
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} required placeholder="Ne yapmak istediğinizi ve karşılaştığınız durumu yazın." />
            </label>
            {status ? <div className={status.startsWith("Ticket'") ? "support-ticket-success" : "support-ticket-error"}>{status}</div> : null}
            <button type="submit" style={styles.button} disabled={sending}>
              {sending ? "Gönderiliyor..." : "Support ticket gönder"}
            </button>
          </form>
        </section>
      </div>
    </DashboardShell>
  );
}
