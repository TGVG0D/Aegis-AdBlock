/**
 * CSV export with a BOM and semicolon separator (Excel pt-BR friendly).
 * Formula injection is neutralised by prefixing dangerous leading characters.
 */
function protectFormula(value) {
  const text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

function escapeCell(value) {
  const text = protectFormula(value);
  if (/[;"\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers, rows) {
  const lines = [];
  if (headers?.length) lines.push(headers.map(escapeCell).join(';'));
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function parseCsv(text) {
  // Minimal RFC 4180 parser, used by tests and potential imports.
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ';' || char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
