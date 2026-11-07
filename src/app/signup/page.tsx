import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/Forms";
import styles from "@/components/auth.module.css";
import { getWorkspace } from "@/lib/data";

export const metadata = { title: "Create account" };

export default async function SignUpPage() {
  const workspace = await getWorkspace();
  if (workspace.status !== "signed-out" && workspace.status !== "error") redirect("/");

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <Image src="/qula-logo.png" alt="" width={40} height={40} priority className={styles.brandMark} />
          <div>
            <strong>Qula Tran</strong>
            <span>TRANSACTIONS</span>
          </div>
        </div>
        <div className={styles.body}>
          <p className={styles.intro}>
            Create an account, then set up the tenant and first organisation you will manage.
          </p>
          <SignUpForm />
          <p className={styles.switch}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
