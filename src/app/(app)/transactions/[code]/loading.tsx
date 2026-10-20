import styles from "@/components/OpsPage.module.css";

export default function LoadingTransactionList() {
  return (
    <section className={styles.stack}>
      <h1 className={styles.heading}>Loading the transaction list</h1>
      <p className={styles.lede}>Opening the documents for this transaction type.</p>
    </section>
  );
}
