import OptionLookup from "@/components/OptionLookup";
import { QuietInput } from "@/components/QuietField";
import LedgerPanel from "@/components/org-settings/LedgerPanel";
import tab from "@/components/org-settings/SettingsTab.module.css";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { exact, slot } from "@/components/recordForm";
import { ACCOUNTING_ACCOUNTS, type AccountingSettings as AccountingSettingsRow } from "@/lib/journal";
import type { GlChoice } from "@/lib/journal-data";
import { getAccountingSettings } from "@/lib/journal-data";
import { getLedgerSettings, type LedgerSettings } from "@/lib/ledger-data";
import { saveAccountingSettings } from "@/lib/journal-actions";

/** The accounts the ledger and the journal export use, each a system role on a GL code. It is the Accounting tab of the organisation edit. */
export default async function AccountingSettings({
  organisationId,
  status,
  failed,
  role,
  isCurrent,
}: {
  organisationId: string;
  organisationName?: string;
  status: string | null;
  failed: boolean;
  role: string;
  isCurrent: boolean;
}) {
  const [{ settings, glCodes, error }, ledger] = await Promise.all([getAccountingSettings(organisationId), getLedgerSettings(organisationId)]);
  const message = failed ? status : (error ?? ledger.error ?? status);
  const bad = failed || Boolean(error ?? ledger.error);
  return (
    <AccountingView
      organisationId={organisationId}
      settings={settings}
      glCodes={glCodes}
      ledger={ledger.settings}
      message={message}
      bad={bad}
      role={role}
      isCurrent={isCurrent}
    />
  );
}

/** The five accounts down the left and the rest down the right, on rows shared by both sides. */
const LEFT = ["receivables", "payables", "vatSales", "vatPurchases"] as const;
const RIGHT = ["exchange", "rounding", "suspense"] as const;

export function AccountingView({
  organisationId,
  settings,
  glCodes,
  ledger,
  message,
  bad,
  role,
  isCurrent,
}: {
  organisationId: string;
  settings: AccountingSettingsRow;
  glCodes: GlChoice[];
  ledger: LedgerSettings | null;
  message: string | null;
  bad: boolean;
  role: string;
  isCurrent: boolean;
}) {
  function account(key: (typeof ACCOUNTING_ACCOUNTS)[number]["key"], side: "left" | "right", row: number) {
    const item = ACCOUNTING_ACCOUNTS.find((entry) => entry.key === key);
    if (!item) return null;
    const options = glCodes
      .filter((code) => code.accountType === item.accountType && (code.systemRole === null || code.systemRole === item.role))
      .map((code) => ({ value: code.id, label: `${code.code} — ${code.description}` }));
    return (
      <div key={item.key} className={`${recordStyles.cell} ${slot(side, row)}`}>
        <label>
          {item.label}
          <OptionLookup name={item.column} label={item.label} noneLabel={null} options={options} defaultValue={settings[item.key]} emptyText="No GL code matches." />
        </label>
        <small className={tab.help}>{item.help}</small>
      </div>
    );
  }

  return (
    <div className={tab.tab}>
      {message ? (
        <div className={styles.statusRow}>
          <p className={bad ? styles.alert : styles.notice} role={bad ? "alert" : "status"} title={message}>
            {message}
          </p>
        </div>
      ) : null}
      <form className={`${recordStyles.layout} ${tab.section}`} action={saveAccountingSettings} autoComplete="off">
        <input type="hidden" name="organisation_id" value={organisationId} />
        <p className={`${recordStyles.sectionHeading} ${slot("left", 1)}`}>Control and VAT accounts</p>
        <p className={`${recordStyles.sectionHeading} ${slot("right", 1)}`}>Other accounts and the start date</p>
        {LEFT.map((key, index) => account(key, "left", index + 2))}
        {RIGHT.map((key, index) => account(key, "right", index + 2))}
        <div className={`${tab.dateRow} ${slot("right", 5)}`}>
          <label className={recordStyles.fixed} style={exact("11rem")}>
            Start date
            <QuietInput type="date" name="start_date" defaultValue={settings.startDate} />
          </label>
          <p className={tab.help}>Nothing dated before this is exported. Leave it blank to export all history.</p>
        </div>
        <div className={tab.footer}>
          <button className={styles.primary} type="submit">
            Save
          </button>
        </div>
      </form>
      {ledger ? <LedgerPanel organisationId={organisationId} settings={ledger} role={role} isCurrent={isCurrent} /> : null}
    </div>
  );
}
