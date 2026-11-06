import { redirect } from "next/navigation";
import { mockAccessPoint } from "@/lib/access-point/adapter";
import { saveAccessPoint } from "@/lib/settings-actions";
import { getWorkspace } from "@/lib/data";
import { canManage } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import styles from "@/components/OpsPage.module.css";

export const metadata = { title: "Access Point" };

export default async function AccessPointPage() {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") redirect("/");
  const manage = canManage(workspace.current.role);
  const supabase = await createClient();
  const settings = await supabase.from("access_point_settings").select("provider_code, environment, status, participant_registered").eq("organisation_id", workspace.current.organisationId).maybeSingle();
  const row = (settings.data ?? {}) as { provider_code?: string; environment?: string; status?: string; participant_registered?: boolean };
  const fields = mockAccessPoint().fields();

  return (
    <section className={styles.stack}>
      <h1 className={styles.heading}>Access Point</h1>
      <p className={styles.lede}>Status: {row.status ?? "Not configured"}{row.participant_registered ? " · Peppol ID registered" : ""}</p>
      {manage ? (
        <form className={styles.partyFields} action={saveAccessPoint}>
          <label className={styles.field}>Provider
            <select name="provider" defaultValue={row.provider_code ?? "mock"}><option value="mock">Mock</option></select>
          </label>
          <label className={styles.field}>Environment
            <select name="environment" defaultValue={row.environment ?? "sandbox"}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </label>
          {fields.filter((field) => !field.secret).map((field) => (
            <label key={field.name} className={styles.field}>{field.label}<input name={field.name} /></label>
          ))}
          <label className={styles.field}>API key
            <input name="apiKey" type="password" autoComplete="off" placeholder="Write-only" />
          </label>
          <label className={styles.checkLine}><input type="checkbox" name="verified" /> Test connection succeeded</label>
          <button className={styles.primary} type="submit">Save</button>
        </form>
      ) : (
        <p className={styles.panelMeta}>Owners and admins configure the Access Point.</p>
      )}
    </section>
  );
}
