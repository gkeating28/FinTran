import Link from "next/link";
import { redirect } from "next/navigation";
import { DocumentIcon } from "@/components/icons";
import styles from "@/components/OpsPage.module.css";
import { listFormMenu, type FormMenuTile } from "@/lib/form-data";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Forms" };

export default async function FormsPage() {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const { tiles, error } = await listFormMenu();

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Forms</h1>
        <p className={styles.lede}>
          Printable layouts for {workspace.current.organisationName}.
        </p>
      </div>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {tiles.length === 0 ? (
        <p className={styles.empty}>No transaction types yet. Add them under Admin, then design a form for each one.</p>
      ) : (
        <div className={styles.menuGroups}>
          <FormGroup title="Purchase transactions" tiles={tiles.filter((tile) => tile.type === "Purchases")} />
          <hr className={styles.menuDivider} />
          <FormGroup title="Sales transactions" tiles={tiles.filter((tile) => tile.type === "Sales")} />
        </div>
      )}
    </section>
  );
}

function FormGroup({ title, tiles }: { title: string; tiles: FormMenuTile[] }) {
  return (
    <section className={styles.menuSection}>
      <h2 className={styles.menuHeading}>{title}</h2>
      {tiles.length === 0 ? (
        <p className={styles.panelMeta}>No {title.toLowerCase()} yet.</p>
      ) : (
        <div className={styles.adminGrid}>
          {tiles.map((tile) => (
            <Link key={tile.id} href={`/forms/${tile.code}`} className={styles.adminTile}>
              <span className={styles.adminTileIcon}>
                <DocumentIcon size={22} />
              </span>
              <span className={styles.adminTileLabel}>{tile.description}</span>
              <span className={styles.adminTileCount}>{tile.code}</span>
              <span className={styles.adminTileMeta}>{tile.custom ? "Custom layout" : "Standard layout"}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

