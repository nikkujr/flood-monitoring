import { z } from 'zod';
export const reportTransitions: Record<string, string[]> = {
  Submitted:['Under Review','Validated','Rejected'],
  'Under Review':['Under Review','Validated','Rejected'],
  Validated:['Validated','Resolved'],
  Rejected:['Rejected','Under Review'],
  Resolved:['Resolved','Under Review']
};
export const reportReviewInput = z.object({
  expectedStatus:z.enum(['Submitted','Under Review','Validated','Rejected','Resolved']),
  status:z.enum(['Under Review','Validated','Rejected','Resolved']),
  severityLevel:z.enum(['Information','Minor Incident','Major Incident']),
  validationNotes:z.string().trim().max(2000).optional().default(''),
  zoneIds:z.array(z.string().uuid()).default([])
}).superRefine((input,context)=>{
  if (!reportTransitions[input.expectedStatus]?.includes(input.status)) context.addIssue({code:'custom',path:['status'],message:'This status change is not allowed. Reopen completed reports for review first.'});
  if (['Validated','Resolved'].includes(input.status) && !input.zoneIds.length) context.addIssue({code:'custom',path:['zoneIds'],message:'Select at least one affected Barangay Zone.'});
  if (['Rejected','Resolved'].includes(input.status) && !input.validationNotes) context.addIssue({code:'custom',path:['validationNotes'],message:'Explain the rejection or resolution in reviewer notes.'});
});
