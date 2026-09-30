import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Subscription, catchError, combineLatest, finalize, of, switchMap, timer } from 'rxjs';
import { ApiService } from './api.service';
import type { DssData } from './dss.models';

const emptyFilters = (): Record<string,string> => ({
  zone:'', risk:'', from:'', to:'', severity:'', evacuationStatus:'', vulnerability:''
});

@Component({selector:'app-dss',standalone:true,imports:[FormsModule,DatePipe],templateUrl:'./dss.component.html',styleUrl:'./dss.component.scss'})
export class DssComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly refresh = new BehaviorSubject(0);
  private subscription?: Subscription;
  data: DssData | null = null;
  loading = true;
  error = '';
  filters: Record<string,string> = emptyFilters();
  draftFilters: Record<string,string> = emptyFilters();
  activeTab: 'overview'|'zones'|'reports'|'evacuation'|'methodology' = 'overview';
  readonly tabs = [
    {id:'overview' as const,label:'Overview'},
    {id:'zones' as const,label:'Zone assessment'},
    {id:'reports' as const,label:'Reports'},
    {id:'evacuation' as const,label:'Evacuation'},
    {id:'methodology' as const,label:'Methodology'}
  ];
  zoneOptions: {id:string;name:string}[] = [];
  readonly risks = ['Low','Moderate','High','Critical'];
  readonly severities = ['Information','Minor Incident','Major Incident'];
  readonly statuses = ['Safe','For Monitoring','For Evacuation','Evacuated'];
  readonly vulnerabilities = ['Any','Senior citizen','PWD','Pregnant','Child','Morbidity','Other'];
  readonly geoAnalyticsUrl = 'https://geoanalytics.georisk.gov.ph/';
  readonly geoAnalyticsLocation = {
    region: 'Region V (Bicol Region)', province: 'Camarines Sur', municipality: 'Lupi',
    barangay: 'Colacling (Del Rosario)', hazard: 'Flood'
  };
  readonly geoAnalyticsAssessment = [
    {label:'Safe',percent:72,area:1619586,color:'#e5e7eb'},
    {label:'Low susceptibility',percent:15.4,area:346411,color:'#d9c8ff'},
    {label:'Moderate susceptibility',percent:7,area:157460,color:'#a946ed'},
    {label:'High susceptibility',percent:5.6,area:125968,color:'#5d16e8'}
  ];
  readonly geoAnalyticsTotalArea = 2249425;
  readonly geoAnalyticsProneArea = 630745;
  readonly geoAnalyticsPronePercent = 28.04;
  readonly geoAnalyticsChart = 'conic-gradient(#e5e7eb 0 72%, #d9c8ff 72% 87.4%, #a946ed 87.4% 94.4%, #5d16e8 94.4% 100%)';
  pages: Record<string,number> = {vulnerable:1,evacuation:1,households:1};
  ngOnInit() {
    this.subscription = combineLatest([timer(0,30_000),this.refresh]).pipe(switchMap(()=>{
      if (this.filters['from'] && this.filters['to'] && this.filters['from']>this.filters['to']) {
        this.loading=false;this.error='Start date must not be after end date.';return of(null);
      }
      this.loading=true; this.error='';
      return this.api.decisionSupport({...this.filters}).pipe(catchError(error=>{
        this.error=error?.error?.message ?? 'Decision-support data could not be loaded. Please retry.';
        return of(null);
      }),finalize(()=>{this.loading=false;this.cdr.markForCheck();}));
    })).subscribe(data=>{
      this.data=data;
      if (data) {
        this.zoneOptions=data.zoneOptions;
        for (const kind of ['vulnerable','evacuation','households']) this.pages[kind]=Math.min(this.pages[kind]!,this.pageCount(kind));
      }
      this.cdr.markForCheck();
    });
  }
  ngOnDestroy() { this.subscription?.unsubscribe();this.refresh.complete(); }
  changeFilters() { this.data=null;this.pages={vulnerable:1,evacuation:1,households:1};this.reload(); }
  applyFilters() {
    this.filters=Object.fromEntries(Object.entries(this.draftFilters).filter(([,value])=>value));
    this.changeFilters();
  }
  reset() {this.draftFilters=emptyFilters();this.filters=emptyFilters();this.changeFilters();}
  get activeFilterCount() {return Object.values(this.filters).filter(Boolean).length;}
  get activeFilterLabels() {
    const zoneName=this.zoneOptions.find(zone=>zone.id===this.filters['zone'])?.name;
    return [
      zoneName?`Zone: ${zoneName}`:null,
      this.filters['risk']?`Risk: ${this.filters['risk']}`:null,
      this.filters['from']?`From: ${this.filters['from']}`:null,
      this.filters['to']?`To: ${this.filters['to']}`:null,
      this.filters['severity']?`Severity: ${this.filters['severity']}`:null,
      this.filters['evacuationStatus']?`Status: ${this.filters['evacuationStatus']}`:null,
      this.filters['vulnerability']?`Vulnerability: ${this.filters['vulnerability']}`:null
    ].filter((label):label is string=>!!label);
  }
  reload() {this.refresh.next(this.refresh.value+1);}
  selectTab(tab: typeof this.activeTab) {this.activeTab=tab;}
  level(value:string|null) {return (value??'unknown').toLowerCase().replace(/ /g,'-');}
  pageCount(kind:string) {
    const total=kind==='households'?this.data?.priorityHouseholds.length:kind==='vulnerable'?this.data?.vulnerable.length:this.data?.evacuation.length;
    return Math.max(1,Math.ceil((total??0)/20));
  }
  movePage(kind:string,delta:number) {this.pages[kind]=Math.max(1,Math.min(this.pageCount(kind),this.pages[kind]!+delta));}
  get metrics() {
    if (!this.data) return [];
    const m=this.data.metrics;
    return [
      {label:'Active validated reports',value:m.activeReports,icon:'!'},
      {label:'Affected zones',value:m.affectedZones,icon:'⌖'},
      {label:'Residents needing assistance',value:m.priorityResidents,icon:'♙'},
      {label:'Potentially affected vulnerable',value:m.affectedVulnerable,icon:'♡'}
    ];
  }
  get reportStatuses() {
    if (!this.data) return [];
    const incidents=this.data.incidents;
    return [
      {label:'Active validated',value:incidents.active,className:'active'},
      {label:'Pending verification',value:incidents.pending,className:'pending'},
      {label:'Resolved',value:incidents.resolved,className:'resolved'},
      {label:'Rejected',value:incidents.rejected,className:'rejected'}
    ];
  }
  get statusDonut() {
    const values=this.reportStatuses.map(item=>item.value);
    const total=values.reduce((sum,value)=>sum+value,0);
    if (!total) return 'conic-gradient(#e5ebf2 0 100%)';
    const colors=['#1764c1','#e4a11b','#35a36f','#9aa6b5'];
    let cursor=0;
    return `conic-gradient(${values.map((value,index)=>{
      const start=cursor; cursor+=value/total*100;
      return `${colors[index]} ${start}% ${cursor}%`;
    }).join(',')})`;
  }
  get maxSeverity() { return Math.max(1,...(this.data?.incidents.bySeverity.map(item=>item.count)??[])); }
  get maxZoneReports() { return Math.max(1,...(this.data?.zones.map(zone=>zone.totalReports)??[])); }
  get zoneAxisTicks() {
    const maximum = this.maxZoneReports;
    return [maximum, maximum * .75, maximum * .5, maximum * .25, 0].map(value => Math.round(value));
  }
  get shelterSummary() {
    const shelters=this.data?.shelters??[];
    return {
      capacity:shelters.reduce((sum,item)=>sum+item.capacity,0),
      occupancy:shelters.reduce((sum,item)=>sum+(item.occupancy??0),0),
      available:shelters.reduce((sum,item)=>sum+(item.available??0),0)
    };
  }
}
