import type { ReactNode } from 'react';
import styles from './Table.module.css';

/**
 * Table — the admin table (DESIGN.md §5 Admin table; 03 §2.2 `Table`). Server Component: row
 * actions are the caller's client leaves (01 INV-08). 2px `--line-soft` outline, header row on
 * `--slab-sunk` with a 2px `--line` bottom rule, rows ≥44px separated by 2px `--table-divider`.
 * ≤ one accent per row is the caller's duty. Phone: horizontal scroll inside the
 * `overflow-x: auto` wrapper. Reordering is not a `Table` prop — use `ReorderableList` (03 §2.10).
 * Empty rows (03 G-05): `empty` is one `--mute` line in voice per 02 §1.3
 * ("No projects yet. Run a sync.").
 */
export type TableColumn = {
  key: string;
  header: string;
  align?: 'start' | 'end';
  /** CSS width for the column (e.g. `'130px'`, `'40%'`). */
  width?: string;
};

export type TableProps = {
  caption: string;
  columns: TableColumn[];
  /** Cell nodes by column `key`. The `rowKey` entry must hold a string (the React key). */
  rows: Record<string, ReactNode>[];
  rowKey: string;
  empty?: ReactNode;
};

export function Table({ caption, columns, rows, rowKey, empty }: TableProps) {
  return (
    <div className={styles['table-scroll']}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        {columns.some((column) => column.width) ? (
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={styles['table-header']}
                data-align={column.align ?? 'start'}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? empty !== undefined && (
                <tr>
                  <td className={styles['table-empty']} colSpan={columns.length}>
                    {empty}
                  </td>
                </tr>
              )
            : rows.map((row) => (
                <tr key={String(row[rowKey])} className={styles['table-row']}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={styles['table-cell']}
                      data-align={column.align ?? 'start'}
                    >
                      {row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
