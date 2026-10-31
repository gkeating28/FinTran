"use client";

import { useMemo, useState, type ReactNode } from "react";
import GridPager from "@/components/GridPager";
import { useGridPageSize } from "@/components/useGridPageSize";
import { gridPageSlice, pageIndexForSize, type GridPageSize } from "@/lib/grid-page";
import { formatInteger } from "@/lib/numbers";
import { clickOpensRow } from "@/lib/row-click";
import styles from "@/components/OpsPage.module.css";

export type GridColumn<T> = {
  key: string;
  label: string;
  sortValue: (row: T) => string;
  render: (row: T) => ReactNode;
  mono?: boolean;
  align?: "right";
  width?: string;
};

export default function DataGrid<T extends { id: string }>({
  rows,
  columns,
  searchText,
  searchPlaceholder,
  emptyLabel,
  form,
  toolbar,
  actions,
  actionsWidth,
  minWidth,
  onOpen,
  rowOpens,
}: {
  rows: T[];
  columns: GridColumn<T>[];
  searchText: (row: T) => string;
  searchPlaceholder: string;
  emptyLabel: string;
  form: string;
  toolbar?: ReactNode;
  actions?: (row: T) => ReactNode;
  actionsWidth?: string;
  minWidth?: string;
  onOpen?: (row: T) => void;
  rowOpens?: (row: T) => boolean;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useGridPageSize(form);
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

  const paged = gridPageSlice(filtered, pageIndex, pageSize);
  const { page, pageCount, rows: visible, from, to } = paged;

  function changePageSize(next: GridPageSize) {
    setPageIndex(pageIndexForSize(page, pageSize, filtered.length, next));
    setPageSize(next);
  }

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
      <table
        className={actionsWidth ? `${styles.table} ${styles.tableFixed}` : styles.table}
        style={minWidth ? { minWidth } : undefined}
      >
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
                <th
                  key={column.key}
                  className={column.align === "right" ? styles.numeric : undefined}
                  aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button className={styles.sortButton} type="button" title={column.label} onClick={() => sortBy(column.key)}>
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
            visible.map((row) => {
              const opens = Boolean(onOpen) && (rowOpens?.(row) ?? true);
              return (
                <tr
                  key={row.id}
                  className={opens ? styles.rowClick : undefined}
                  onClick={
                    opens
                      ? (event) => {
                          if (!clickOpensRow(event.target)) return;
                          onOpen?.(row);
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={
                        [column.mono ? styles.mono : "", column.align === "right" ? styles.numeric : ""]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                    >
                      {column.render(row)}
                    </td>
                  ))}
                  {actions ? <td className={styles.actionsCell}><div className={styles.actions}>{actions(row)}</div></td> : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <GridPager
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        onPage={setPageIndex}
        onPageSize={changePageSize}
        summary={
          filtered.length === 0
            ? "No rows"
            : `Showing ${formatInteger(from)} to ${formatInteger(to)} of ${formatInteger(filtered.length)}`
        }
      />
    </div>
  );
}
