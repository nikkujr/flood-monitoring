import assert from 'node:assert/strict';
import {residentReadiness} from './record-readiness.js';
const resident={record_status:'Active',evacuation_status:'Safe',emergency_contact_name:'Ana',emergency_contact_number:'09123456789'};
assert.deepEqual(residentReadiness(resident,[]),{flags:[],needsAssistance:false});
assert.deepEqual(residentReadiness({...resident,evacuation_status:'For Evacuation',emergency_contact_number:' ',can_swim:'No'},[]),{flags:['Emergency contact incomplete','Evacuation center not assigned'],needsAssistance:true});
assert.equal(residentReadiness({...resident,evacuation_status:'Evacuated',evacuation_shelter_id:'center'},['Senior citizen']).needsAssistance,true);
assert.deepEqual(residentReadiness({...resident,record_status:'Inactive',evacuation_status:'Evacuated'},['Senior citizen']),{flags:[],needsAssistance:false});
console.log('Resident readiness checks passed');
