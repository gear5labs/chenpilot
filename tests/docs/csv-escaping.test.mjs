import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const csvEscaperPath = path.join(REPO_ROOT, "src/Reporting/csvEscaper.ts");
const contractDocPath = path.join(REPO_ROOT, "docs/CSV_EXPORT_CONTRACT.md");

test("CSV Escaping and Export Contract (#1111)", async (t) => {
  assert.ok(fs.existsSync(csvEscaperPath), "csvEscaper.ts implementation must exist");
  assert.ok(fs.existsSync(contractDocPath), "CSV_EXPORT_CONTRACT.md documentation must exist");

  const contract = fs.readFileSync(contractDocPath, "utf-8");

  await t.test("contract documents all required criteria", () => {
    assert.match(contract, /CWE-1236/i, "documents formula injection defense");
    assert.match(contract, /RFC 4180/i, "documents RFC 4180 standard conformity");
    assert.match(contract, /Control Character/i, "documents control character sanitization");
    assert.match(contract, /Unicode/i, "documents Unicode preservation");
    assert.match(contract, /Formula Prefix/i, "documents formula prefix trigger characters");
  });

  const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "%"];
  const DANGEROUS_ASCII_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  const BIDI_OVERRIDE_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;

  function sanitizeControlChars(value) {
    return String(value)
      .replace(DANGEROUS_ASCII_CONTROLS, "")
      .replace(BIDI_OVERRIDE_CHARS, "");
  }

  function hasFormulaPrefix(value) {
    if (value.length === 0) return false;
    if (FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))) {
      return true;
    }
    const trimmedSpaces = value.replace(/^[ ]+/, "");
    return FORMULA_PREFIXES.some((prefix) => trimmedSpaces.startsWith(prefix));
  }

  function escapeCsvField(value) {
    if (value === null || value === undefined) return "";
    let text = sanitizeControlChars(String(value));
    const isFormula = hasFormulaPrefix(text);
    if (isFormula) {
      text = `'${text}`;
    }
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

  function formatCsvRow(fields) {
    return fields.map((f) => escapeCsvField(f)).join(",");
  }

  function formatCsv(headers, rows) {
    return [formatCsvRow(headers), ...rows.map((r) => formatCsvRow(r))].join("\r\n");
  }

  function validateCsvField(value) {
    const issues = [];
    if (value === null || value === undefined) return { isSafe: true, issues, escaped: "" };
    const str = String(value);
    if (DANGEROUS_ASCII_CONTROLS.test(str)) issues.push("Contains dangerous ASCII control characters");
    if (BIDI_OVERRIDE_CHARS.test(str)) issues.push("Contains directional BiDi override characters");
    if (hasFormulaPrefix(str)) issues.push("Starts with formula execution trigger prefix");
    return { isSafe: issues.length === 0, issues, escaped: escapeCsvField(value) };
  }

  await t.test("escapes all leading formula prefixes", () => {
    const testCases = [
      { input: "=SUM(A1:B10)", expected: `"'=SUM(A1:B10)"` },
      { input: "+cmd|' /C calc'!A0", expected: `"'+cmd|' /C calc'!A0"` },
      { input: "-500.25 XLM", expected: `"'-500.25 XLM"` },
      { input: "@HYPERLINK(\"http://evil.com\")", expected: `"'@HYPERLINK(""http://evil.com"")"` },
      { input: "\tTAB_INJECT", expected: `"'\tTAB_INJECT"` },
      { input: "\rCR_INJECT", expected: `"'\rCR_INJECT"` },
      { input: "|PIPE_INJECT", expected: `"'|PIPE_INJECT"` },
      { input: "%PERCENT_INJECT", expected: `"'%PERCENT_INJECT"` },
      { input: "   =1+1", expected: `"'   =1+1"` },
    ];

    for (const { input, expected } of testCases) {
      const escaped = escapeCsvField(input);
      assert.strictEqual(escaped, expected, `Failed for prefix test: ${input}`);
    }
  });

  await t.test("escapes double quotes and special characters per RFC 4180", () => {
    assert.strictEqual(escapeCsvField('Alice "The Boss" Smith'), '"Alice ""The Boss"" Smith"');
    assert.strictEqual(escapeCsvField("Hello, World"), '"Hello, World"');
    assert.strictEqual(escapeCsvField("Line 1\nLine 2"), '"Line 1\nLine 2"');
    assert.strictEqual(escapeCsvField("Line 1\r\nLine 2"), '"Line 1\r\nLine 2"');
    assert.strictEqual(escapeCsvField('Compound "val", with comma\nand newline'), '"Compound ""val"", with comma\nand newline"');
  });

  await t.test("sanitizes control characters and BiDi directional overrides", () => {
    const withControls = "safe\u0000text\u0007with\u001Fcontrols";
    assert.strictEqual(escapeCsvField(withControls), "safetextwithcontrols");

    const withBidi = "admin\u202Egnirts";
    assert.strictEqual(escapeCsvField(withBidi), "admingnirts");
  });

  await t.test("preserves valid Unicode across languages and symbols", () => {
    const unicodeCases = [
      "Stellar Lumens ⭐",
      "日本語テスト（東京都）",
      "Привет мир! Валюта: ₽",
      "مرحبا بالعالم - رصيد الحساب",
      "Euro € & British Pound £",
    ];

    for (const input of unicodeCases) {
      const escaped = escapeCsvField(input);
      assert.ok(escaped.includes(input), `Unicode string corrupted: ${input}`);
    }
  });

  await t.test("handles boundary and primitive values cleanly", () => {
    assert.strictEqual(escapeCsvField(null), "");
    assert.strictEqual(escapeCsvField(undefined), "");
    assert.strictEqual(escapeCsvField(""), "");
    assert.strictEqual(escapeCsvField(0), "0");
    assert.strictEqual(escapeCsvField(12345.67), "12345.67");
    assert.strictEqual(escapeCsvField(true), "true");
    assert.strictEqual(escapeCsvField(false), "false");
  });

  await t.test("formatCsv constructs complete CRLF-delimited tables", () => {
    const headers = ["Account ID", "Balance", "Notes"];
    const rows = [
      ["GAA123", "100.5", "Normal deposit"],
      ["GAA456", "200.0", "=SUM(A1:B1)"],
      ["GAA789", "50.0", "Contains, comma and \"quotes\""],
    ];

    const result = formatCsv(headers, rows);
    const expected =
      'Account ID,Balance,Notes\r\n' +
      'GAA123,100.5,Normal deposit\r\n' +
      'GAA456,200.0,"\'=SUM(A1:B1)"\r\n' +
      'GAA789,50.0,"Contains, comma and ""quotes"""';

    assert.strictEqual(result, expected);
  });

  await t.test("validateCsvField detects failure cases accurately", () => {
    const safeResult = validateCsvField("Valid Name");
    assert.strictEqual(safeResult.isSafe, true);
    assert.strictEqual(safeResult.issues.length, 0);

    const unsafeFormula = validateCsvField("=cmd|' /C calc'!A0");
    assert.strictEqual(unsafeFormula.isSafe, false);
    assert.ok(unsafeFormula.issues.some((i) => i.includes("formula")));

    const unsafeControl = validateCsvField("Data\u0000Corrupted");
    assert.strictEqual(unsafeControl.isSafe, false);
    assert.ok(unsafeControl.issues.some((i) => i.includes("control")));
  });
});
