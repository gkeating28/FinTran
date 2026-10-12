"use client";

import { useMemo, useState, type ReactNode } from "react";
import styles from "@/components/OpsPage.module.css";

export type GridColumn<T> = {
  key: string;
  label: string;
  sortValue: (row: T) => string;
  render: (row: T) => ReactNode;
  mono?: boolean;
  width?: string;
};

const PAGE_SIZE = 10;

export default function DataGrid<T extends { id: string }>({
  rows,
  columns,
  searchText,
  searchPlaceholder,
  emptyLabel,
  toolbar,
  actions,
  actionsWidth,
}: {
  rows: T[];
  columns: GridColumn<T>[];
  searchText: (row: T) => string;
  searchPlaceholder: string;
  emptyLabel: string;
  toolbar?: ReactNode;
  actions?: (row: T) => ReactNode;
  actionsWidth?: string;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pageIndex, setPageIndex] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? rows.filter((row) => searchText(row).toLowerCase().includes(needle))
      : rows;
    const column = columns.find((item) => item.key === sortKey) ?? columns[0];
    if (!column) return matched;

    return [...matched].sort((left, right) => {
      const result = column.sortValue(left).localeCompare(column.sortValue(right), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });
  }, [columns, query, rows, searchText, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pageIndex, pageCount - 1);
  const start = page * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : start + 1;
  const to = Math.min(filtered.length, start + PAGE_SIZE);

  function sortBy(key: string) {
    setPageIndex(0);
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  }

  return (
    <div className={styles.panel}>
      <div className={styles.gridToolbar}>
        <label className={styles.search}>
          <span className="sr-only">Search</span>
          <input
            type="search"
            autoComplete="off"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setPageIndex(0);
            }}
          />
        </label>
        {toolbar}
      </div>
      <table className={actionsWidth ? `${styles.table} ${styles.tableFixed}` : styles.table}>
        {actionsWidth ? (
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
            <col style={{ width: actionsWidth }} />
          </colgroup>
        ) : null}
        <thead>
          <tr>
            {columns.map((column) => {
              const active = column.key === sortKey;
              return (
                <th key={column.key} aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                  <button className={styles.sortButton} type="button" onClick={() => sortBy(column.key)}>
                    {column.label}
                    <span className={styles.sortMark} aria-hidden>
                      {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
            {actions ? <th className={styles.actionsHead}>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (actions ? 1 : 0)} className={styles.empty}>
                {query.trim() ? "No matches." : emptyLabel}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key} className={column.mono ? styles.mono : undefined}>
                    {column.render(row)}
                  </td>
                ))}
                {actions ? <td className={styles.actionsCell}><div className={styles.actions}>{actions(row)}</div></td> : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className={styles.gridFooter}>
        <span>
          {from}–{to} of {filtered.length}
        </span>
        <div className={styles.pager}>
          <button
            className={styles.quiet}
            type="button"
            disabled={page === 0}
            onClick={() => setPageIndex(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <button
            className={styles.quiet}
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPageIndex(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
