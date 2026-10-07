import assert from 'node:assert/strict';
import { reportReviewInput, reportTransitions } from './report-review.js';
const zone='11111111-1111-4111-8111-111111111111';
const input={expectedStatus:'Submitted',status:'Under Review',severityLevel:'Information',zoneIds:[],validationNotes:''};
for (const from of ['Submitted','Under Review','Validated','Rejected','Resolved']) {
  for (const to of ['Under Review','Validated','Rejected','Resolved']) {
    assert.equal(reportReviewInput.safeParse({...input,expectedStatus:from,status:to,zoneIds:[zone],validationNotes:'Field assessment completed.'}).success,reportTransitions[from]!.includes(to),`${from} -> ${to}`);
  }
}
assert.equal(reportReviewInput.safeParse(input).success,true);
assert.equal(reportReviewInput.safeParse({...input,status:'Validated'}).success,false);
assert.equal(reportReviewInput.safeParse({...input,status:'Rejected'}).success,false);
assert.equal(reportReviewInput.safeParse({...input,status:'Rejected',validationNotes:'Duplicate report confirmed.'}).success,true);
assert.equal(reportReviewInput.safeParse({...input,expectedStatus:'Validated',status:'Resolved',zoneIds:[zone]}).success,false);
assert.equal(reportReviewInput.safeParse({...input,validationNotes:'x'.repeat(2001)}).success,false);
assert.equal(reportReviewInput.safeParse({...input,zoneIds:['not-a-zone-id']}).success,false);
console.log('Review transitions, required evidence, note limits, and zone IDs passed.');
