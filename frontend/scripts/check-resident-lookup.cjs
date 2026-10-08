// Run from frontend: node scripts/check-resident-lookup.cjs. Uses no API or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('app.ts', fs.readFileSync(path.join(__dirname, '../src/app/app.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const app = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'App');
const names = ['selectedAccountResidentLabel','loadResidentLookup','selectAccountResident','canSelectAccountResident','registerResident','reviewRegistration','editAccountProfile','saveAccountProfile','accountTabKey'];
const code = ts.transpileModule(`class Check { ${app.members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n')} }`, {compilerOptions:{target:ts.ScriptTarget.ES2023}}).outputText;
const check = vm.runInNewContext(`${code}; new Check()`, {document:{getElementById(id){return {focus(){}};}},FormData:class {constructor(form){this.form=form;}entries(){return Object.entries(this.form.values);}},finalize: fn => fn, shortRecordId: id => id.slice(0,8)});
let call, handlers, closed = false, saved = false;
Object.assign(check, {
  editorValues:{}, fieldErrors:{residentId:'Required'}, residentLookupQuery:'  Test household  ',
  editorValue(name){return this.editorValues[name] || '';},
  changeDetector:{detectChanges(){}}, saveEditorDraft(){saved = true;},
  api:{list(...args){call=args; return {pipe(){return {subscribe(value){handlers=value;}};}};}}
});
check.loadResidentLookup(2);
assert.deepEqual(Array.from(call), ['residents',2,20,'Test household','r.full_name','asc']);
assert.equal(check.residentLookupLoading,true);
call = null; check.loadResidentLookup(3); assert.equal(call,null,'Ignore duplicate requests while loading');
const resident = {resident_id:'resident-1',full_name:'Test Resident',household_number:'HH-1',record_status:'Active'};
handlers.next({items:[resident],totalPages:3,totalItems:45});
assert.equal(check.residentLookupRows[0],resident); assert.equal(check.residentLookupPages,3);
check.selectAccountResident({...resident,record_status:'Inactive'},{close(){closed=true;}});
assert.equal(closed,false); assert.equal(saved,false);
check.selectAccountResident(resident,{close(){closed=true;}});
assert.equal(check.editorValues.residentId,'resident-1'); assert.equal(check.selectedAccountResidentLabel,'Test Resident · HH-1');
assert.equal(check.fieldErrors.residentId,undefined); assert.equal(check.editorDirty,true); assert.equal(saved,true); assert.equal(closed,true);
check.residentLookupLoading=false; check.loadResidentLookup(); handlers.error({error:{message:'Unavailable'}});
assert.equal(check.residentLookupError,'Unavailable'); assert.equal(check.residentLookupRows.length,0);
check.activePage='registrations'; check.registrationReview={user_id:'applicant'};
assert.equal(check.canSelectAccountResident({...resident,verification_status:'Pending Verification'}),false);
assert.equal(check.canSelectAccountResident({...resident,verification_status:'Verified',linked_user_id:'another-account'}),false);
assert.equal(check.canSelectAccountResident({...resident,verification_status:'Verified',linked_user_id:'applicant'}),true);
assert.equal(check.canSelectAccountResident({...resident,verification_status:'Verified'}),true);
check.residentLookupLoading=false; check.loadResidentLookup(); assert.equal(call[0],'resident-registrations/residents');
console.log('PASS: paged search, loading guard, selection, inactive rejection, field errors, saved selection and retryable failure.');

let registrationBody, registrationHandlers, navigated, formReset=false;
check.loginLoading=false;
check.finishLoginLoading=()=>{};
check.navigatePublic=page=>{navigated=page;};
check.api.register=body=>{registrationBody=body;return {pipe(){return {subscribe(value){registrationHandlers=value;}};}};};
check.registerResident({preventDefault(){},currentTarget:{values:{username:'resident',password:'Password123456',confirmation:'Password123456'},reset(){formReset=true;}}});
assert.equal(registrationBody.confirmation,undefined);
registrationHandlers.next({message:'Registration submitted. Sign in after approval.'});
assert.equal(navigated,'login');assert.equal(formReset,true);assert.equal(check.successMessage,'Registration submitted. Sign in after approval.');
console.log('PASS: registration clears the form and shows approval confirmation on the login page.');

let reviewBody, reviewHandlers, reviewClosed=false;
check.registrationReview={user_id:'pending-account'};check.registrationReviewBusy=false;
check.registrationAddResident=true;
check.registrationResident={householdId:'household',fullName:'New resident',dateOfBirth:'2000-01-01',sex:'Female',addressLine:'Barangay Colacling',contactNumber:'09123456789',priorityLevel:'Low'};
check.api.create=(resource,body)=>{assert.equal(resource,'resident-registrations/pending-account/review');reviewBody=body;return {pipe(){return {subscribe(value){reviewHandlers=value;}};}};};
const reviewDialog={close(){reviewClosed=true;}};
check.reviewRegistration('Approved','Validated',false,reviewDialog);assert.equal(reviewBody,undefined);
check.registrationResident.householdId='';check.reviewRegistration('Approved','Validated',true,reviewDialog);assert.equal(reviewBody,undefined);
check.registrationResident.householdId='household';check.reviewRegistration('Approved','Validated',true,reviewDialog);
assert.equal(reviewBody.residentId,undefined);assert.equal(reviewBody.newResident.fullName,'New resident');assert.equal(reviewClosed,false);
reviewHandlers.error({error:{message:'Duplicate resident record'}});assert.equal(check.registrationReviewError,'Duplicate resident record');assert.equal(reviewClosed,false);
check.registrationReviewBusy=false;check.reviewRegistration('Rejected','Cannot validate',false,reviewDialog);assert.equal(reviewBody.newResident,undefined);
check.registrationReviewBusy=false;check.registrationAddResident=false;check.reviewRegistration('Approved','Validated',true,reviewDialog);assert.equal(reviewBody.residentId,'resident-1');assert.equal(reviewBody.newResident,undefined);
check.activePage='registrations';check.registrationAddResident=true;check.selectAccountResident({...resident,verification_status:'Verified'}, {close(){}});assert.equal(check.registrationAddResident,false);
console.log('PASS: new resident approval validates fields and confirmation, sends only the chosen mode, preserves review on failure and switches to existing resident when selected.');

let session={userId:'own-account',email:'old@example.test',username:'resident',fullName:'Old name'}, profileHandlers,profileBody,profileCalls=0,accountReloaded=false;
check.api.user=()=>session;check.api.user.set=value=>session=value;
check.account={resident:{full_name:'Resident name',date_of_birth:'2000-01-01',sex:'Female',address_line:'Colacling address'}};
check.accountProfileBusy=false;check.editAccountProfile();assert.equal(check.accountProfileEditing,true);assert.equal(check.accountProfile.email,session.email);assert.equal(check.accountProfile.contactNumber,'');
check.api.update=(resource,id,body)=>{assert.equal(resource,'auth');assert.equal(id,'profile');profileBody=body;profileCalls++;return {pipe(){return {subscribe(value){profileHandlers=value;}};}};};
const saveEvent={preventDefault(){},currentTarget:{reportValidity(){return true;}}};
check.accountProfile.fullName=' Updated name ';check.accountProfile.email=' NEW@example.test ';
check.saveAccountProfile(saveEvent);assert.equal(profileBody.fullName,' Updated name ');check.saveAccountProfile(saveEvent);assert.equal(profileCalls,1);
profileHandlers.error({error:{message:'Email already used',fieldErrors:{email:'Email already used'}}});assert.equal(check.accountProfileEditing,true);assert.equal(check.accountProfileFieldErrors.email,'Email already used');
check.accountProfileBusy=false;check.loadAccount=()=>{accountReloaded=true;check.accountProfile={};check.accountProfileEditing=false;};
check.saveAccountProfile(saveEvent);check.accountProfile={};profileHandlers.next();assert.equal(session.fullName,'Updated name');assert.equal(session.email,'new@example.test');assert.equal(accountReloaded,true);assert.equal(check.accountProfileSuccess,'Your information has been updated.');
console.log('PASS: profile prefill, save guard, error retention, saved session details and account refresh.');

check.accountTabs=[{id:'profile'},{id:'household'},{id:'assistance'},{id:'security'}];check.accountTab='profile';check.accountProfileBusy=false;check.loginLoading=false;
check.accountTabKey({key:'ArrowLeft',preventDefault(){}});assert.equal(check.accountTab,'security');
check.accountTabKey({key:'ArrowRight',preventDefault(){}});assert.equal(check.accountTab,'profile');
check.accountTabKey({key:'End',preventDefault(){}});assert.equal(check.accountTab,'security');
check.accountTabKey({key:'Home',preventDefault(){}});assert.equal(check.accountTab,'profile');
check.accountProfileBusy=true;check.accountTabKey({key:'End',preventDefault(){}});assert.equal(check.accountTab,'profile');
check.accountProfileBusy=false;check.accountTab='household';check.editAccountProfile();assert.equal(check.accountTab,'profile');assert.equal(check.accountProfile.philsysNumber,'');assert.equal(check.accountProfile.canSwim,'');
console.log('PASS: account tab keyboard navigation, save guard, profile edit tab and extended profile fields.');
