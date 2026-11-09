import Link from "next/link";
import type { ReactNode } from "react";
import { DocumentIcon, EDocumentIcon } from "@/components/icons";
import styles from "@/components/OpsPage.module.css";
import homeStyles from "@/components/Home.module.css";
import type { AuditEntry } from "@/lib/audit-data";
import type { HomeOverview as Overview } from "@/lib/home-data";

const SHORTCUTS = [
  { href: "/transactions", label: "Transactions", meta: "Purchase and sales documents" },
  { href: "/suppliers", label: "Suppliers", meta: "Who you buy from" },
  { href: "/customers", label: "Customers", meta: "Who you sell to" },
  { href: "/e-documents", label: "E-documents", meta: "Send and receive e-invoices" },
  { href: "/admin", label: "Admin", meta: "Codes, rates, forms and access" },
];

const SEGMENTS = 20;
const AVATAR_TONES = ["toneBlue", "toneGreen", "toneOrange", "toneSlate"] as const;

function count(value: number | null) {
  return value === null ? "-" : String(value);
}

function initials(name: string) {
  const parts = name.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function greeting(name: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-IE", { hour: "numeric", hour12: false, timeZone: "Europe/Dublin" }).format(new Date()),
  ) % 24;
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ` : part;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

function ago(when: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(when).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export default function HomeOverview({
  organisationName,
  tenantName,
  role,
  organisationCount,
  memberCount,
  error,
  overview,
  userName,
  people,
  recent,
  insights,
}: {
  organisationName: string;
  tenantName: string;
  role: string;
  organisationCount: number;
  memberCount: number | null;
  error?: string | null;
  overview: Overview;
  userName: string;
  people: string[];
  /** The latest changes, or null when this person cannot read the change history. */
  recent: AuditEntry[] | null;
  /** The "Worth a look" card, streamed in by the page. */
  insights?: ReactNode;
}) {
  const drafts = overview.draftDocuments;
  const posted = overview.postedThisMonth;
  const total = (drafts ?? 0) + (posted ?? 0);
  const filled = posted === null || total === 0 ? 0 : Math.round((SEGMENTS * posted) / total);

  const weeks = overview.weeklyPosted;
  const weekCounts = weeks.map((week) => week.count ?? 0);
  const peak = Math.max(1, ...weekCounts);
  const weeksTotal = weekCounts.reduce((sum, value) => sum + value, 0);
  const current = weeks[weeks.length - 1]?.count ?? null;
  const previous = weeks[weeks.length - 2]?.count ?? null;
  const change = current !== null && previous !== null && previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;

  const waiting = (drafts ?? 0) + (overview.eDocumentsReady ?? 0);
  const shown = people.slice(0, 4);
  const more = (memberCount ?? people.length) - shown.length;

  return (
    <section className={styles.stack}>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}

      <div className={homeStyles.layout}>
        <div className={homeStyles.main}>
          <section className={homeStyles.banner} aria-label="Welcome">
            <div className={homeStyles.bannerText}>
              <h1 className={homeStyles.greeting}>
                {greeting(userName)}
                {firstName(userName) ? <span className={homeStyles.greetingName}>{firstName(userName)}</span> : null}
              </h1>
              <p className={homeStyles.bannerLede}>
                {organisationName}{" "}
                {waiting === 0
                  ? "has nothing waiting for you."
                  : `has ${drafts ?? 0} draft${drafts === 1 ? "" : "s"} and ${overview.eDocumentsReady ?? 0} e-invoice${overview.eDocumentsReady === 1 ? "" : "s"} ready to import.`}
              </p>
              <div className={homeStyles.bannerActions}>
                <Link prefetch href="/transactions" className={homeStyles.bannerPrimary}>
                  Transactions
                </Link>
                <Link prefetch href="/e-documents" className={homeStyles.bannerSecondary}>
                  E-documents
                </Link>
              </div>
            </div>
            <div className={homeStyles.bannerPeople}>
              <div className={homeStyles.avatars} aria-hidden="true">
                {shown.map((name, index) => (
                  <span key={`${name}-${index}`} className={`${homeStyles.avatar} ${homeStyles[AVATAR_TONES[index % AVATAR_TONES.length]]}`}>
                    {initials(name)}
                  </span>
                ))}
                {more > 0 ? <span className={`${homeStyles.avatar} ${homeStyles.toneSlate}`}>+{more}</span> : null}
              </div>
              <span className={homeStyles.pill}>
                {memberCount === null ? "People with access unavailable" : `${memberCount} ${memberCount === 1 ? "person has" : "people have"} access`}
              </span>
            </div>
          </section>

          <div className={homeStyles.cardGrid}>
            <section className={homeStyles.card} aria-label="Documents">
              <div className={homeStyles.cardHead}>
                <h2 className={homeStyles.cardTitle}>Documents</h2>
                <span className={homeStyles.cardMeta}>This month</span>
              </div>
              <div className={homeStyles.bigPair}>
                <Link prefetch href="/transactions" className={homeStyles.bigNumber}>
                  {count(drafts)}
                  <span className={homeStyles.bigLabel}>drafts</span>
                </Link>
                <span className={homeStyles.bigDivider} aria-hidden="true" />
                <Link prefetch href="/transactions" className={homeStyles.bigNumber}>
                  {count(posted)}
                  <span className={homeStyles.bigLabel}>posted</span>
                </Link>
              </div>
              <div
                className={homeStyles.segments}
                role="img"
                aria-label={posted === null ? "Posted documents unavailable" : `${posted} of ${total} documents posted`}
              >
                {Array.from({ length: SEGMENTS }, (_, index) => (
                  <span key={index} className={index < filled ? homeStyles.segmentOn : homeStyles.segmentOff} />
                ))}
              </div>
              <div className={homeStyles.tiles}>
                <Link prefetch href="/e-documents" className={`${homeStyles.tile} ${homeStyles.tileBlue}`}>
                  <EDocumentIcon size={24} />
                  <span className={homeStyles.tileValue}>{count(overview.eDocumentsReady)}</span>
                  <span className={homeStyles.tileLabel}>E-invoices ready</span>
                </Link>
                <Link prefetch href="/e-documents" className={`${homeStyles.tile} ${homeStyles.tileWarn}`}>
                  <DocumentIcon size={24} />
                  <span className={homeStyles.tileValue}>{count(overview.eDocumentsNeedReview)}</span>
                  <span className={homeStyles.tileLabel}>E-invoices to review</span>
                </Link>
              </div>
            </section>

            <section className={homeStyles.card} aria-label="Posted per week">
              <div className={homeStyles.cardHead}>
                <h2 className={homeStyles.cardTitle}>Posted per week</h2>
                {change !== null ? (
                  <span className={change >= 0 ? homeStyles.badgeUp : homeStyles.badgeDown}>
                    {change >= 0 ? "+" : ""}
                    {change}%
                  </span>
                ) : null}
              </div>
              <div className={homeStyles.bigPair}>
                <span className={homeStyles.bigNumber}>
                  {weeksTotal}
                  <span className={homeStyles.bigLabel}>documents in the last {weeks.length} weeks</span>
                </span>
              </div>
              <div
                className={homeStyles.bars}
                role="img"
                aria-label={`Documents posted in each of the last ${weeks.length} weeks: ${weekCounts.join(", ")}`}
              >
                {weeks.map((week, index) => (
                  <div key={week.label} className={homeStyles.barColumn}>
                    <span
                      className={index === weeks.length - 1 ? homeStyles.barNow : homeStyles.bar}
                      style={{ height: `${Math.max(8, Math.round(((week.count ?? 0) / peak) * 100))}%` }}
                    />
                    <span className={index === weeks.length - 1 ? homeStyles.barLabelNow : homeStyles.barLabel}>{week.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {insights}

          <section className={homeStyles.card} aria-label="Go to">
            <h2 className={homeStyles.cardTitle}>Go to</h2>
            <div className={homeStyles.shortcuts}>
              {SHORTCUTS.map((shortcut) => (
                <Link prefetch key={shortcut.href} href={shortcut.href} className={homeStyles.shortcut}>
                  <span className={homeStyles.shortcutLabel}>{shortcut.label}</span>
                  <span className={homeStyles.shortcutMeta}>{shortcut.meta}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <aside className={homeStyles.side}>
          <section className={homeStyles.card} aria-label="Workspace">
            <h2 className={homeStyles.cardTitle}>Workspace</h2>
            <dl className={homeStyles.facts}>
              <dt>Organisation</dt>
              <dd>{organisationName}</dd>
              <dt>Tenant</dt>
              <dd>{tenantName}</dd>
              <dt>Your role</dt>
              <dd>{role}</dd>
              <dt>Organisations</dt>
              <dd>{organisationCount}</dd>
              <dt>People with access</dt>
              <dd>{count(memberCount)}</dd>
            </dl>
          </section>

          {recent ? (
            <section className={homeStyles.card} aria-label="Recent activity">
              <div className={homeStyles.cardHead}>
                <h2 className={homeStyles.cardTitle}>Recent activity</h2>
                <Link prefetch href="/history" className={homeStyles.viewAll}>
                  View all
                </Link>
              </div>
              {recent.length === 0 ? (
                <p className={homeStyles.empty}>No changes recorded yet.</p>
              ) : (
                <ul className={homeStyles.activity}>
                  {recent.map((entry, index) => (
                    <li key={entry.id} className={homeStyles.activityItem}>
                      <span className={`${homeStyles.avatarSmall} ${homeStyles[AVATAR_TONES[index % AVATAR_TONES.length]]}`} aria-hidden="true">
                        {initials(entry.who)}
                      </span>
                      <div className={homeStyles.activityText}>
                        <span>
                          <strong>{entry.who}</strong> {entry.action.toLowerCase()} {entry.tableName.toLowerCase()}
                        </span>
                        <span className={homeStyles.activityWhen}>{ago(entry.when)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
