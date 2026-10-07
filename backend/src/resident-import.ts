import { z } from 'zod';

export const residentImportSchema = z.object({
  household_number: z.string().min(1).max(40), full_name: z.string().min(1).max(160),
  date_of_birth: z.iso.date().refine(value => value <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()), 'Date of birth cannot be in the future'),
  sex: z.enum(['Female', 'Male', 'Intersex', 'Prefer not to say', 'Not recorded']),
  address_line: z.string().min(1).max(255), priority_level: z.enum(['Low', 'Medium', 'High']),
  contact_number: z.string().max(30).optional(),
  vulnerability_type: z.enum(['', 'Elderly', 'Child', 'Disability', 'Pregnant', 'Mobility-limited', 'Other']).optional(),
  emergency_contact_name: z.string().max(160).optional(), emergency_contact_number: z.string().max(30).optional()
}).strict();

// CSV exported by Excel supports quoted commas, escaped quotes and multiline cells.
export function parseResidentCsv(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (char !== ',') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed || char === '"') throw new Error('Invalid CSV quoting. Export the file as CSV again.');
    else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted cell.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift();
  if (!headers || !rows.length) throw new Error('CSV must contain headers and at least one resident.');
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be nonempty and unique.');
  if (rows.length > 500) throw new Error('Import at most 500 residents per file.');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2}: column count does not match the headers.`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]!]));
  });
}
