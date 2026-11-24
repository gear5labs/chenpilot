/**
 * CSV Escaping and Security Validation for Reporting & Data Exports
 *
 * Implements defenses against CSV / Formula Injection (CWE-1236) and ensures
 * strict adherence to RFC 4180 for tabular exports.
 *
 * Security Properties:
 * 1. Formula Prefix Neutralization:
 *    Any field beginning with spreadsheet formula triggers (`=`, `+`, `-`, `@`,
 *    `\t`, `\r`, `|`, `%`) — even after leading whitespace — is prefixed with
 *    a single quote (`'`) to force spreadsheet applications (Excel, Google Sheets,
 *    Calc) to treat the cell contents as plain text.
 *
 * 2. Control Character & BiDi Sanitization:
 *    Strips or sanitizes non-printable ASCII control characters (`\u0000-\u0008`,
 *    `\u000B\u000C`, `\u000E-\u001F`, `\u007F-\u009F`) and dangerous Unicode
 *    BiDi overrides (`\u202A-\u202E`, `\u2066-\u2069`) that could disrupt layout
 *    or disguise malicious cell commands.
 *
 * 3. RFC 4180 Conformity:
 *    Encloses fields containing commas, double quotes, line breaks (`\n`, `\r`),
 *    tabs, or formula escape prefixes in double quotes. Internal double quotes are
 *    escaped by doubling them (`""`).
 *
 * 4. Transparent Unicode Support:
 *    Preserves valid UTF-8 international text (CJK, Arabic, Cyrillic, accented
 *    Latin, currency symbols, and emojis) without corruption.
 *
 * @module Reporting/csvEscaper
 */

// Formula prefix triggers recognised by common spreadsheet engines
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "%"];

// Regex matching ASCII control characters excluding standard line breaks (\r, \n) and tab (\t)
const DANGEROUS_ASCII_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// Regex matching Unicode BiDi override and isolate characters that can alter visual ordering
const BIDI_OVERRIDE_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;

export interface CsvValidationResult {
  /** True if the raw field contained no dangerous formula triggers or control chars. */
  isSafe: boolean;
  /** List of detected safety warnings or syntax anomalies. */
  issues: string[];
  /** Fully escaped and sanitized cell value ready for CSV emission. */
  escaped: string;
}

/**
 * Sanitizes unsafe control characters and BiDi overrides from a string value.
 *
 * @param value - Raw string input
 * @returns Sanitized string with unsafe control characters removed
 */
export function sanitizeControlChars(value: string): string {
  return value
    .replace(DANGEROUS_ASCII_CONTROLS, "")
    .replace(BIDI_OVERRIDE_CHARS, "");
}

/**
 * Detects whether a string begins with any spreadsheet formula prefix,
 * checking both raw position and after leading whitespace.
 *
 * @param value - String value to inspect
 * @returns True if the value triggers formula interpretation
 */
export function hasFormulaPrefix(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  // Direct check without trimming (catches \t, \r, =, etc.)
  if (FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return true;
  }
  // Check after trimming spaces
  const trimmedSpaces = value.replace(/^[ ]+/, "");
  return FORMULA_PREFIXES.some((prefix) => trimmedSpaces.startsWith(prefix));
}

/**
 * Validates a field value against spreadsheet formula and control character risks.
 *
 * @param value - Input value to validate
 * @returns CsvValidationResult with safety status and sanitized output
 */
export function validateCsvField(value: unknown): CsvValidationResult {
  const issues: string[] = [];

  if (value === null || value === undefined) {
    return { isSafe: true, issues: [], escaped: "" };
  }

  const strValue = String(value);

  if (DANGEROUS_ASCII_CONTROLS.test(strValue)) {
    issues.push("Contains dangerous ASCII control characters");
  }

  if (BIDI_OVERRIDE_CHARS.test(strValue)) {
    issues.push("Contains directional BiDi override characters");
  }

  if (hasFormulaPrefix(strValue)) {
    issues.push("Starts with formula execution trigger prefix");
  }

  const escaped = escapeCsvField(value);
  return {
    isSafe: issues.length === 0,
    issues,
    escaped,
  };
}

/**
 * Escapes an individual cell value according to RFC 4180 and spreadsheet formula defense.
 *
 * Rules applied:
 * 1. Null / undefined become empty strings.
 * 2. Control characters and BiDi overrides are sanitized.
 * 3. Leading formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`, `|`, `%`) are escaped with `'`.
 * 4. Cells containing `,`, `"`, `\n`, `\r`, `\t`, or leading/trailing whitespace are wrapped in `"`
 *    with internal `"` doubled.
 *
 * @param value - Cell value to format
 * @returns Fully escaped cell string
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  let text = String(value);

  // 1. Sanitize dangerous control characters and BiDi overrides
  text = sanitizeControlChars(text);

  // 2. Mitigate formula injection if string starts with formula trigger
  const isFormula = hasFormulaPrefix(text);
  if (isFormula) {
    text = `'${text}`;
  }

  // 3. RFC 4180 quoting: quote if contains delimiter, quote, newline, tab, or leading/trailing whitespace
  const needsQuotes =
    isFormula ||
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    text.includes("\t") ||
    text.startsWith(" ") ||
    text.endsWith(" ");

  if (needsQuotes) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/**
 * Formats an array of field values into a single RFC 4180 compliant CSV line.
 *
 * @param fields - Array of values for a single row
 * @returns Comma-separated escaped row string
 */
export function formatCsvRow(fields: unknown[]): string {
  return fields.map((field) => escapeCsvField(field)).join(",");
}

/**
 * Formats full tabular data (headers and rows) into a complete CSV document.
 *
 * @param headers - Column headers array
 * @param rows - 2D array of row records
 * @returns Complete CSV string separated by CRLF (`\r\n`)
 */
export function formatCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = formatCsvRow(headers);
  const rowLines = rows.map((row) => formatCsvRow(row));
  return [headerLine, ...rowLines].join("\r\n");
}
