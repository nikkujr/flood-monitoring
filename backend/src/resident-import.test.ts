import assert from 'node:assert/strict';
import { parseResidentCsv, residentImportSchema } from './resident-import.js';

assert.deepEqual(parseResidentCsv('\uFEFFfull_name,address_line\r\n"Ana ""Ann"" Cruz","Zone 1, Colacling"\r\n'), [
  { full_name: 'Ana "Ann" Cruz', address_line: 'Zone 1, Colacling' }
]);
assert.equal(parseResidentCsv('name,address\nAna,"Line 1\nLine 2"')[0]!.address, 'Line 1\nLine 2');
for (const csv of ['a,a\n1,2', 'a,b\n1', 'a\n"unclosed', 'a\n"closed"junk', 'a\n', 'a\n' + 'x\n'.repeat(501)]) {
  assert.throws(() => parseResidentCsv(csv));
}
const resident = { household_number: 'Z1-1', full_name: 'Ana Cruz', date_of_birth: '2000-02-29', sex: 'Female', address_line: 'Colacling', priority_level: 'Low' };
assert.ok(residentImportSchema.safeParse(resident).success);
for (const invalid of [{ date_of_birth: '2001-02-29' }, { date_of_birth: '2999-01-01' }, { full_name: '' }, { full_name: 'x'.repeat(161) }, { priority_level: 'Urgent' }, { sex: 'unknown' }, { unexpected: 'ignored?' }]) {
  assert.equal(residentImportSchema.safeParse({ ...resident, ...invalid }).success, false);
}
console.log('Resident CSV and validation checks passed.');
