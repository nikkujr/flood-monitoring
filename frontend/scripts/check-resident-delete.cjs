// Run from frontend: node scripts/check-resident-delete.cjs. No API requests or records are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('app.ts', fs.readFileSync(path.join(__dirname, '../src/app/app.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const app = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'App');
const method = app.members.find(node => node.name?.getText(source) === 'deleteSelectedResident');
const code = ts.transpileModule(`class Check { ${method.getText(source)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
let confirms = [], calls = [], allow = true, fail = false;
const check = vm.runInNewContext(`${code}; new Check()`, {
  window: { confirm: message => { confirms.push(message); return allow; } },
  finalize: fn => fn
});
const reset = () => {
  confirms = []; calls = []; allow = true; fail = false;
  Object.assign(check, {
    activePage: 'residents', isHistoricalResidentYear: false, canManageCurrentResource: true,
    loading: false, editorId: 'editor-resident', editorOpen: false,
    editorValues: { fullName: 'Editor name' }, errorMessage: '', successMessage: '',
    closeEditor() { calls.push('close'); }, loadResource() { calls.push('reload'); }, finishLoading() {},
    api: { delete(resource, id) { calls.push([resource, id]); return { pipe() { return { subscribe(handlers) { fail ? handlers.error({ error: { message: 'Delete blocked' } }) : handlers.next(); } }; } }; } }
  });
};
const row = { id: 'row-resident', name: 'Row name' };
reset(); check.deleteSelectedResident(row);
assert.deepEqual(calls, [['residents', row.id], 'reload']);
assert.match(confirms[0], /Delete Row name/);
reset(); check.editorOpen = true; check.deleteSelectedResident();
assert.deepEqual(calls, [['residents', 'editor-resident'], 'close', 'reload']);
reset(); allow = false; check.deleteSelectedResident(row);
assert.deepEqual(calls, []); assert.equal(check.loading, false);
for (const changes of [{ isHistoricalResidentYear: true }, { canManageCurrentResource: false }, { activePage: 'dss' }, { loading: true }]) {
  reset(); Object.assign(check, changes); check.deleteSelectedResident(row);
  assert.deepEqual(calls, []); assert.deepEqual(confirms, []);
}
reset(); fail = true; check.deleteSelectedResident(row);
assert.deepEqual(calls, [['residents', row.id]]); assert.equal(check.errorMessage, 'Delete blocked');
console.log('PASS: correct resident row, editor reuse, cancellation, permissions/history/loading guards, and failed-delete retention.');
