export async function syncShelterOccupancy(connection:any,shelterIds:Array<string|null|undefined>){
  for(const shelterId of [...new Set(shelterIds.filter(Boolean) as string[])])await connection.execute(
    `UPDATE shelters s SET current_occupancy=(SELECT COUNT(*) FROM residents r
     WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active'),
     status=CASE
       WHEN s.record_status='Inactive' OR s.status='Unavailable' THEN 'Unavailable'
       WHEN (SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') >= s.capacity THEN 'Full'
       WHEN (SELECT COUNT(*) FROM residents r WHERE r.evacuation_shelter_id=s.shelter_id AND r.evacuation_status='Evacuated' AND r.record_status='Active') >= CEIL(s.capacity * 0.8) THEN 'Near Capacity'
       ELSE 'Available' END WHERE s.shelter_id=?`,[shelterId]);
}
