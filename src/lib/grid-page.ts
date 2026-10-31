export const GRID_PAGE_SIZES = [5, 10, 20, 50] as const;

export type GridPageSize = (typeof GRID_PAGE_SIZES)[number] | "all";

export const DEFAULT_GRID_PAGE_SIZE: GridPageSize = 10;

const NUMERIC_SIZES = new Set<number>(GRID_PAGE_SIZES);

export function parseGridPageSize(
  value: string | null | undefined,
  fallback: GridPageSize = DEFAULT_GRID_PAGE_SIZE,
): GridPageSize {
  if (value === "all") return "all";
  const number = Number(value);
  if (NUMERIC_SIZES.has(number)) return number as GridPageSize;
  return fallback;
}

export function gridRowsStorageKey(form: string) {
  const safe = form.trim().replace(/[^A-Za-z0-9/_-]/g, "");
  return `fintran.form.${safe || "grid"}.rowsPerPage`;
}

export function gridPageCount(rowCount: number, pageSize: GridPageSize) {
  if (pageSize === "all") return 1;
  return Math.max(1, Math.ceil(rowCount / pageSize));
}

export function gridPageSlice<T>(rows: T[], pageIndex: number, pageSize: GridPageSize) {
  const pageCount = gridPageCount(rows.length, pageSize);
  const page = Math.min(Math.max(0, pageIndex), pageCount - 1);
  if (pageSize === "all") {
    return {
      page,
      pageCount,
      rows,
      from: rows.length === 0 ? 0 : 1,
      to: rows.length,
    };
  }
  const start = page * pageSize;
  const visible = rows.slice(start, start + pageSize);
  return {
    page,
    pageCount,
    rows: visible,
    from: rows.length === 0 ? 0 : start + 1,
    to: Math.min(rows.length, start + pageSize),
  };
}

export function pageIndexForSize(
  currentPage: number,
  currentSize: GridPageSize,
  rowCount: number,
  nextSize: GridPageSize,
) {
  if (nextSize === "all") return 0;
  const length = currentSize === "all" ? Math.max(rowCount, 1) : currentSize;
  const firstRow = Math.max(0, currentPage) * length;
  const lastIndex = Math.max(0, gridPageCount(rowCount, nextSize) - 1);
  return Math.min(lastIndex, Math.floor(firstRow / nextSize));
}
