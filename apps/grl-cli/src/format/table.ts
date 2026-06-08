/**
 * Plain-text table formatter for GRL CLI output.
 *
 * Produces aligned, deterministic ASCII tables with no colour, no spinners,
 * no ANSI codes unless the caller explicitly includes them.
 */

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
}

type Row = Record<string, unknown>;

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length);
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Render an array of rows as an aligned text table.
 * Column widths are inferred from the data unless explicitly specified.
 */
export function renderTable(columns: TableColumn[], rows: Row[]): string {
  // Compute column widths
  const widths: number[] = columns.map((col: TableColumn) => {
    if (col.width) return col.width;
    const maxData: number = rows.reduce((max: number, row: Row) => {
      const cell: string = stringify(row[col.key]);
      return Math.max(max, cell.length);
    }, 0);
    return Math.max(col.header.length, maxData);
  });

  // Header
  const header: string = columns.map((col: TableColumn, i: number) => pad(col.header, widths[i] as number)).join('   ');
  const separator: string = widths.map((w: number) => '-'.repeat(w)).join('   ');

  if (rows.length === 0) {
    return [header, separator, '(none)'].join('\n');
  }

  const dataRows = rows.map((row) =>
    columns.map((col: TableColumn, i: number) => pad(stringify(row[col.key]), widths[i] as number)).join('   ')
  );

  return [header, separator, ...dataRows].join('\n');
}

/** Print a table to stdout. */
export function printTable(columns: TableColumn[], rows: Row[]): void {
  process.stdout.write(renderTable(columns, rows) + '\n');
}

/** Print a single key/value pair list (for detail views). */
export function printKeyValue(pairs: Array<[string, unknown]>): void {
  const keyWidth: number = Math.max(...pairs.map(([k]: [string, unknown]) => k.length));
  for (const [key, value] of pairs) {
    process.stdout.write(`${pad(key, keyWidth)}   ${stringify(value)}\n`);
  }
}
