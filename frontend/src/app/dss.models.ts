export interface DssPerson {
  id:string; name:string; household:string; householdId:string; zone:string; zoneId:string; address:string;
  vulnerabilities:string[]; details:string[]; risk:string; priority:string; status:string; manualPriority:string; assistance:string[];
}
export interface DssData {
  generatedAt:string; scope:string; rules:string[]; filters:Record<string,string>; zoneOptions:{id:string;name:string}[];
  overall:{risk:string|null;explanation:string}; metrics:{residents:number;households:number;vulnerableResidents:number;activeReports:number;affectedZones:number;highRiskZones:number;priorityResidents:number;affectedVulnerable:number};
  zones:{id:string;name:string;risk:string;activeReports:number;totalReports:number;repeatReports:number;residents:number;households:number;vulnerableResidents:number;affectedResidents:number;affectedHouseholds:number;affectedVulnerable:number;populationKnown:boolean;householdsKnown:boolean;explanation:string;response:string}[];
  incidents:{total:number;active:number;resolved:number;pending:number;rejected:number;unassignedActive:number;bySeverity:{severity:string;count:number}[];recent:{id:string;code:string;location:string;severity:string;status:string;createdAt:string;zones:string[]}[]};
  vulnerable:DssPerson[]; evacuation:DssPerson[];
  priorityHouseholds:{id:string;number:string;zone:string;priority:string;risk:string;residents:number;vulnerabilities:string[];statuses:string[]}[];
  shelters:{id:string;name:string;zoneId:string;zone:string;location:string;capacity:number;occupancy:number|null;available:number|null;status:string}[];
  recommendations:{zone:string;risk:string;text:string;reason:string}[];
  alerts:{zoneId:string;zone:string;risk:string;activeReports:number;message:string}[];
  coverage:{zones:number;registeredPopulationKnown:boolean;missingPopulationZones:string[];unassignedActive:number};
}
