import '@angular/compiler';
import assert from 'node:assert/strict';
import {ChangeDetectorRef, Injector, runInInjectionContext} from '@angular/core';
import {of,throwError} from 'rxjs';
import {ApiService} from './api.service';
import {DssComponent} from './dss.component';

async function checkWeeklyReport() {
const requests:Record<string,string>[]=[];
let failWeekly=false;
const record=(id:string,date:string)=>({id,code:id,createdAt:date,status:'Validated',severity:'Information',zones:['Zone 4']});
const data={generatedAt:'2026-10-12T01:00:00Z',zoneOptions:[],incidents:{records:[record('older','2026-10-07 09:00:00')]},vulnerable:[],evacuation:[],priorityHouseholds:[]};
const injector=Injector.create({providers:[
  {provide:ApiService,useValue:{decisionSupport:(filters:Record<string,string>)=>{requests.push(filters);if(failWeekly&&filters['from'])return throwError(()=>new Error('Unavailable'));return of({...data,filters,incidents:{records:filters['from']==='2026-10-12'?[record('current','2026-10-12 09:00:00')]:data.incidents.records}});}}},
  {provide:ChangeDetectorRef,useValue:{markForCheck(){}}}
]});
const component=runInInjectionContext(injector,()=>new DssComponent());
component.mode='statistics';component.weeklyDate='2026-10-12';component.filters={zone:'zone-4',severity:'Major Incident'};
try {
  component.ngOnInit();await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(component.weeklyDate,'2026-10-12','Opening statistics must retain the selected/current week even when older incidents exist.');
  assert.ok(requests.some(filters=>filters['from']==='2026-10-12'&&filters['to']==='2026-10-18'&&!filters['zone']&&!filters['severity']),'Weekly totals must fetch the complete week independently of statistics filters.');
  assert.equal(component.weeklySummary.total,1);assert.equal(component.weeklyRecords[0]?.id,'current');
  assert.equal(component.weeklyPeriodApplied,true);
  const markup=(component as any).weeklyReportMarkup();
  assert.ok(markup.includes('current'));assert.ok(!markup.includes('older'),'Export must use the refreshed weekly data, not assessment records.');
  assert.ok(markup.includes('9:00:00'),'Exported times use Philippine time.');
  component.weeklyData={...component.weeklyData!,incidents:{...component.weeklyData!.incidents,records:[
    record('start','2026-10-11T16:00:00Z'),record('last','2026-10-18 23:59:59'),record('next','2026-10-18T16:00:00Z')
  ] as any}};
  assert.deepEqual(component.weeklyRecords.map(item=>item.id),['start','last'],'Use Philippine dates at both week boundaries.');
  assert.equal(component.weeklyDailyRows[0]?.total,1);assert.equal(component.weeklyDailyRows[6]?.total,1);
  component.changeWeeklyDate('2026-10-05');await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(component.weeklyRecords[0]?.id,'older');
  failWeekly=true;component.reload();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(component.weeklyPeriodApplied,false);assert.equal(component.weeklyData,null);assert.ok(component.weeklyError);
  component.downloadWeeklyReport();
  console.log('PASS: current week, independent weekly data, Philippine date boundaries, refreshed export, selected-week refresh and failed-refresh export protection.');
} finally {component.ngOnDestroy();injector.destroy();}
}
checkWeeklyReport().catch(error=>{console.error(error);process.exitCode=1;});
