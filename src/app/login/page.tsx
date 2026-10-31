import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/Forms";
import styles from "@/components/auth.module.css";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const workspace = await getWorkspace();
  if (workspace.status !== "signed-out" && workspace.status !== "error") redirect("/");

  const params = await searchParams;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <img src="/qula-logo.png" alt="" width={40} height={40} className={styles.brandMark} />
          <div>
            <strong>Qula</strong>
            <span>TRANSACTIONS</span>
          </div>
        </div>
        <div className={styles.body}>
          <p className={styles.intro}>Sign in to open the organisations you have access to.</p>
          <SignInForm initialError={params.error} />
          <p className={styles.switch}>
            New here? <Link href="/signup">Create an account</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
