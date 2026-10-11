import {randomUUID} from 'node:crypto';
import type {PoolConnection} from 'mysql2/promise';
import {z} from 'zod';

export async function createHousehold(connection:PoolConnection,input:{zoneId:string;addressLine:string;headOfHouseholdName:string;contactNumber?:string;verificationStatus?:string}) {
  // Lock the parent zone so concurrent saves allocate numbers in sequence.
  const [zones]=await connection.query<any[]>('SELECT zone_name FROM zones WHERE zone_id=? FOR UPDATE',[input.zoneId]);
  if(!zones[0])throw new z.ZodError([{code:'custom',path:['zoneId'],message:'Select an existing zone.'}]);
  const prefix=`Z${/^Zone\s+(\d+)\b/i.exec(zones[0].zone_name)?.[1] ?? input.zoneId}-`;
  const [existing]=await connection.query<any[]>('SELECT household_number FROM households WHERE zone_id=? FOR UPDATE',[input.zoneId]);
  let highest=0n;
  for(const household of existing) {
    const number=String(household.household_number);
    const suffix=number.startsWith(prefix)?number.slice(prefix.length):'';
    if(/^\d+$/.test(suffix)&&BigInt(suffix)>highest)highest=BigInt(suffix);
  }
  const householdNumber=`${prefix}${highest+1n}`,id=randomUUID();
  if(householdNumber.length>80)throw Object.assign(new Error('The household numbering sequence is full.'),{status:409});
  await connection.execute('INSERT INTO households(household_id,household_number,zone_id,address_line,head_of_household_name,contact_number,verification_status) VALUES(?,?,?,?,?,?,?)',[id,householdNumber,input.zoneId,input.addressLine,input.headOfHouseholdName,input.contactNumber || null,input.verificationStatus ?? 'Pending Verification']);
  return {id,householdNumber};
}
