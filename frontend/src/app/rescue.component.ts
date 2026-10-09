import {Component,EventEmitter,Input,Output,OnInit,OnDestroy,OnChanges,ViewChild,ElementRef,inject,ChangeDetectorRef} from '@angular/core';
import {DatePipe} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Subscription,timer,exhaustMap,catchError,of,finalize} from 'rxjs';
import {ApiService} from './api.service';
import type {RescueBoard,RescueMission,RescuePerson,RescueTeam,Responder,ResidentOutcome,ResponseView} from './rescue.models';

@Component({selector:'app-rescue',standalone:true,imports:[DatePipe,FormsModule],templateUrl:'./rescue.component.html',styleUrl:'./rescue.component.scss'})
export class RescueComponent implements OnInit,OnDestroy,OnChanges {
  private api=inject(ApiService);private cdr=inject(ChangeDetectorRef);private subscriptions=new Subscription();private listSubscription?:Subscription;private detailSubscription?:Subscription;
  @Output() changed=new EventEmitter<void>();
  @Output() dispatched=new EventEmitter<void>();
  assistanceRequest?:{requestId:string;revision:number;confirmed:true};
  @Output() navigate=new EventEmitter<{page:string;resource?:string}>();
  @Input() previewOnly=false;
  @Input() view:ResponseView='missions';
  @Output() viewChange=new EventEmitter<ResponseView>();
  @Output() assignedChange=new EventEmitter<Set<string>>();
  @ViewChild('dispatchDialog') dispatchDialog!:ElementRef<HTMLDialogElement>;
  @ViewChild('teamDialog') teamDialog!:ElementRef<HTMLDialogElement>;
  @ViewChild('outcomeDialog') outcomeDialog!:ElementRef<HTMLDialogElement>;
  showMissions(){this.viewChange.emit('missions');}
  openTeam(){if(!this.canManage||this.saving)return;this.error='';this.resetTeam();this.loadOptions();this.teamDialog.nativeElement.showModal();}
  openOutcome(){if(!this.canManage||this.saving)return;this.error='';this.outcomeResident=null;this.outcomeCandidates=[];this.outcomeResidentSearch='';this.outcomeDialog.nativeElement.showModal();}
  recordMissionOutcome(m:RescueMission,r:RescuePerson,progress?:HTMLDialogElement){if(!this.canManage||this.saving)return;progress?.close();this.error='';this.outcomeResidentSearch='';this.selectOutcomeResident({resident_id:r.id,full_name:r.name,address_line:m.pickup});this.outcomeDialog.nativeElement.showModal();}
  arrivingResidents(m:RescueMission){return m.residents.filter(r=>r.outcome!=='Missing'&&r.outcome!=='Deceased');}
  board:RescueBoard|null=null;error='';success='';saving=false;loading=true;
  people:RescuePerson[]=[];destination:{id:string;name:string}|null=null;teamId='';pickup='';instructions='';dispatchConfirmed=false;
  team={name:'',leaderId:'',memberIds:[] as string[],vehicle:'',passengerCapacity:0};
  withVehicle=false;
  changeMovement(){this.team.vehicle='';this.team.passengerCapacity=this.withVehicle?1:0;}
  responderSearch='';teamOptions:RescueTeam[]=[];responderOptions:Responder[]=[];
  get visibleResponders(){return this.responderOptions.filter(r=>[r.full_name,r.responder_type].join(' ').toLowerCase().includes(this.responderSearch.trim().toLowerCase()));}
  get selectedResponders(){return this.responderOptions.filter(r=>this.team.memberIds.includes(r.volunteer_id));}
  toggleResponder(id:string,checked:boolean){this.team.memberIds=checked?[...this.team.memberIds,id]:this.team.memberIds.filter(i=>i!==id);if(!this.team.memberIds.includes(this.team.leaderId))this.team.leaderId='';}
  outcomeSearch='';outcomeResidentSearch='';outcomeCandidates:Record<string,any>[]=[];outcomeResident:Record<string,any>|null=null;
  outcomeForm={outcome:'Missing',source:'',notes:'',lastSeenLocation:'',observedAt:'',confirmed:false,revision:0};
  get canRecordDeath(){return ['Super Admin','Disaster Officer'].includes(this.api.user()?.role??'');}
  outcomeCount(outcome:string){return this.board?.summary.outcomeCounts[outcome]??0;}
  findOutcomeResident(){const query=this.outcomeResidentSearch.trim();if(!query)return;this.subscriptions.add(this.api.list<Record<string,any>>('residents',1,30,query,'r.full_name','asc').subscribe({next:result=>{if(this.outcomeResidentSearch.trim()===query)this.outcomeCandidates=result.items;this.cdr.markForCheck();},error:()=>{this.error='Resident search failed. Try again.';this.cdr.markForCheck();}}));}
  outcomeHistory:ResidentOutcome['history']=[];outcomeLoading=false;previousOutcome='';
  selectOutcomeResident(r:Record<string,any>){
    this.outcomeResident=r;this.outcomeCandidates=[];this.outcomeHistory=[];this.outcomeLoading=true;this.previousOutcome='';this.error='';
    this.detailSubscription?.unsubscribe();
    this.detailSubscription=this.api.get<ResidentOutcome|null>('rescue/outcomes',r['resident_id']).pipe(finalize(()=>{this.outcomeLoading=false;this.cdr.markForCheck();})).subscribe({next:old=>{this.outcomeHistory=old?.history??[];this.previousOutcome=old?.outcome??'';this.outcomeForm={outcome:old?.outcome??'Missing',source:'',notes:'',lastSeenLocation:old?.last_seen_location??r['address_line']??'',observedAt:new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),confirmed:false,revision:old?.revision??0};},error:()=>{this.error='Outcome could not be loaded. Select the resident again before saving.';this.outcomeResident=null;}});
  }
  reviewOutcome(o:ResidentOutcome){if(!this.canManage||this.saving)return;this.selectOutcomeResident({resident_id:o.resident_id,full_name:o.full_name,address_line:o.last_seen_location});this.outcomeDialog.nativeElement.showModal();}
  get canSaveOutcome(){return !this.outcomeLoading&&!this.error&&this.canManage&&!!this.outcomeResident&&this.outcomeForm.confirmed&&!!this.outcomeForm.source.trim()&&!!this.outcomeForm.notes.trim()&&!!this.outcomeForm.lastSeenLocation.trim()&&Number.isFinite(Date.parse(this.outcomeForm.observedAt))&&((this.previousOutcome!=='Deceased'&&this.outcomeForm.outcome!=='Deceased')||this.canRecordDeath);}
  saveOutcome(){if(this.saving||!this.canSaveOutcome||!this.outcomeResident)return;this.run(this.api.recordResidentOutcome(this.outcomeResident['resident_id'],{...this.outcomeForm,observedAt:new Date(this.outcomeForm.observedAt).toISOString()}),()=>{this.outcomeDialog.nativeElement.close();this.outcomeResident=null;this.changed.emit();});}
  editingTeamId='';
  editTeam(t:RescueTeam){if(!this.canManage||this.saving)return;this.loadOptions();this.editingTeamId=t.team_id;this.withVehicle=!!t.vehicle;this.team={name:t.name,leaderId:t.leader_id??'',memberIds:t.members.map(m=>m.volunteer_id),vehicle:t.vehicle??'',passengerCapacity:t.passenger_capacity};this.teamDialog.nativeElement.showModal();}
  resetTeam(){this.editingTeamId='';this.withVehicle=false;this.responderSearch='';this.team={name:'',leaderId:'',memberIds:[],vehicle:'',passengerCapacity:0};}
  mission:RescueMission|null=null;nextStatus='';note='';confirmedArrival=false;search='';
  missionPage=1;outcomePage=1;teamPage=1;
  missions:RescueMission[]=[];teams:RescueTeam[]=[];outcomes:ResidentOutcome[]=[];
  total=0;pages=1;listLoading=false;teamSearch='';missionStatus='Active';teamStatus='';outcomeStatus='';sortBy='updated';sortOrder:'asc'|'desc'='desc';optionsLoading=false;
  detailMission:RescueMission|null=null;detailOutcome:ResidentOutcome|null=null;detailLoading=false;detailError='';
  get missionPageCount(){return this.pages;}get outcomePageCount(){return this.pages;}get teamPageCount(){return this.pages;}
  get pagedMissions(){return this.missions;}get pagedOutcomes(){return this.outcomes;}get pagedTeams(){return this.teams;}
  get listPage(){return this.view==='teams'?this.teamPage:this.view==='outcomes'?this.outcomePage:this.missionPage;}
  filterList(){this.error='';this.missionPage=this.outcomePage=this.teamPage=1;this.loadList();}
  movePage(delta:number){if(this.view==='teams')this.teamPage+=delta;else if(this.view==='outcomes')this.outcomePage+=delta;else this.missionPage+=delta;this.loadList();}
  ngOnChanges(){this.loadList();}
  loadList(){
    this.listSubscription?.unsubscribe();if(!['missions','teams','outcomes'].includes(this.view))return;
    const view=this.view,page=this.listPage,search=view==='teams'?this.teamSearch:view==='outcomes'?this.outcomeSearch:this.search,status=view==='teams'?this.teamStatus:view==='outcomes'?this.outcomeStatus:this.missionStatus;
    this.listLoading=true;
    this.listSubscription=this.api.list<any>('rescue/'+view,page,20,search,this.sortBy,this.sortOrder,{status}).pipe(finalize(()=>{this.listLoading=false;this.cdr.markForCheck();})).subscribe({next:r=>{this.total=r.totalItems;this.pages=Math.max(1,r.totalPages);if(view==='teams')this.teams=r.items;else if(view==='outcomes')this.outcomes=r.items;else this.missions=r.items;if(page>this.pages){if(view==='teams')this.teamPage=this.pages;else if(view==='outcomes')this.outcomePage=this.pages;else this.missionPage=this.pages;this.loadList();}},error:e=>{this.error=e?.error?.message??'Records could not be loaded. Refresh to retry.';}});
  }
  loadOptions(){
    this.optionsLoading=true;this.teamOptions=[];this.responderOptions=[];
    this.subscriptions.add(this.api.get<Pick<RescueBoard,'teams'|'responders'>>('rescue','options').pipe(finalize(()=>{this.optionsLoading=false;this.cdr.markForCheck();})).subscribe({next:options=>{this.teamOptions=options.teams;this.responderOptions=options.responders;},error:()=>{this.error='Team options could not be loaded. Close and reopen to retry.';}}));
  }
  details(kind:'missions'|'outcomes',id:string,dialog:HTMLDialogElement){
    this.detailSubscription?.unsubscribe();this.detailMission=null;this.detailOutcome=null;this.detailError='';this.detailLoading=true;dialog.showModal();
    this.detailSubscription=this.api.get<any>('rescue/'+kind,id).pipe(finalize(()=>{this.detailLoading=false;this.cdr.markForCheck();})).subscribe({next:r=>{if(kind==='missions')this.detailMission=r;else this.detailOutcome=r;},error:()=>{this.detailError='Details could not be loaded. Close and reopen to retry.';}});
  }
  get canManage(){return !this.previewOnly&&['Super Admin','Disaster Officer','Data Encoder'].includes(this.api.user()?.role??'');}
  teamReady(t:RescueTeam){return t.availability==='Available'&&!t.active_mission_id&&t.members.some(m=>m.volunteer_id===t.leader_id)&&t.members.every(m=>m.availability_status==='Available'&&!m.active_mission_id);}
  get availableTeams(){return this.teamOptions.filter(t=>this.teamReady(t));}
  get selectedTeam(){return this.availableTeams.find(t=>t.team_id===this.teamId);}
  get hasSuitableTeam(){return this.availableTeams.some(t=>!t.vehicle||t.passenger_capacity>=this.people.length);}
  fitsTeam(t:RescueTeam){return !t.vehicle||t.passenger_capacity>=this.people.length;}
  statusLabel(m:RescueMission,status=m.status){return status==='Arrived'?`Completed · ${m.residents.filter(r=>!r.arrivalStatus||r.arrivalStatus==='Arrived').length} shelter arrivals`:status==='Transporting'&&!m.team_snapshot.vehicle?'Escorting residents':status;}
  get assignedResidentIds(){return new Set(this.board?.summary.assignedResidentIds??[]);}
  get activeMissionCount(){return this.board?.summary.activeMissions??0;}
  get teamCount(){return this.board?.summary.teamsTotal??0;}
  get awaitingUpdate(){return this.board?.summary.awaitingUpdate??0;}
  get activeResidents(){return this.assignedResidentIds.size;}
  elapsed(m:RescueMission){return Math.max(0,Math.round((Date.parse(m.arrived_at??m.updated_at)-Date.parse(m.created_at))/60000));}
  stale(m:RescueMission){return Date.now()-Date.parse(m.updated_at)>30*60*1000;}
  hasOutcomeIssue(m:RescueMission){return m.residents.some(r=>r.outcome==='Missing'||r.outcome==='Deceased');}
  acceptBoard(board:RescueBoard){this.board=board;this.assignedChange.emit(this.assignedResidentIds);this.loading=false;this.cdr.markForCheck();}
  ngOnInit(){this.subscriptions.add(timer(0,30000).pipe(exhaustMap(()=>this.api.rescueBoard().pipe(catchError(error=>{this.error=error?.error?.message??'Rescue updates could not be loaded. Refresh before acting.';return of(null);})))) .subscribe(board=>{if(board){this.acceptBoard(board);if(!this.saving)this.loadList();}else{this.loading=false;this.cdr.markForCheck();}}));}
  ngOnDestroy(){this.listSubscription?.unsubscribe();this.detailSubscription?.unsubscribe();this.subscriptions.unsubscribe();}
  refresh(){this.loadList();this.subscriptions.add(this.api.rescueBoard().subscribe({next:board=>this.acceptBoard(board),error:error=>{this.error=error?.error?.message??'Unable to refresh rescue updates.';this.cdr.markForCheck();}}));}
  prepare(people:RescuePerson[],destination:{id:string;name:string},assistanceRequest?:{requestId:string;revision:number;confirmed:true}){
    if(!this.canManage||this.saving)return;
    this.assistanceRequest=assistanceRequest;this.people=people;this.destination=destination;this.teamId='';this.pickup=[...new Set(people.map(p=>p.address).filter(Boolean))].join('; ').slice(0,500);this.instructions='';this.dispatchConfirmed=false;this.error='';this.loadOptions();this.refresh();this.dispatchDialog.nativeElement.showModal();
  }
  dispatch(dialog:HTMLDialogElement){
    if(this.saving||!this.canManage||!this.destination||!this.dispatchConfirmed||!this.selectedTeam||!this.fitsTeam(this.selectedTeam))return;
    this.run(this.api.dispatchRescue({teamId:this.teamId,shelterId:this.destination.id,residentIds:this.people.map(p=>p.id),pickup:this.pickup,instructions:this.instructions,expectedStatuses:Object.fromEntries(this.people.map(p=>[p.id,p.status])),assistanceRequest:this.assistanceRequest}),()=>{dialog.close();this.success='Team dispatched.';this.search='';this.missionPage=1;this.showMissions();this.dispatched.emit();});
  }
  addTeam(){if(!this.canManage||this.saving||this.optionsLoading)return;this.run(this.editingTeamId?this.api.editRescueTeam(this.editingTeamId,this.team):this.api.addRescueTeam(this.team),()=>{this.teamDialog.nativeElement.close();this.resetTeam();});}
  availability(id:string,value:string){if(!this.canManage||this.saving)return;this.run(this.api.setRescueTeamAvailability(id,value));}
  review(m:RescueMission,status:string,dialog:HTMLDialogElement){if(!this.canManage||this.saving)return;this.mission=m;this.nextStatus=status;this.note='';this.confirmedArrival=false;this.error='';dialog.showModal();}
  update(dialog:HTMLDialogElement){if(this.saving||!this.canManage||!this.mission||(['Blocked','Cancelled'].includes(this.nextStatus)&&!this.note.trim())||(this.nextStatus==='Arrived'&&(!this.confirmedArrival||!this.arrivingResidents(this.mission).length)))return;this.run(this.api.updateRescue(this.mission.mission_id,{status:this.nextStatus,revision:this.mission.revision,note:this.note,confirmedArrival:this.confirmedArrival,...(this.nextStatus==='Arrived'?{arrivalResidentIds:this.arrivingResidents(this.mission).map(r=>r.id)}:{})}),()=>{dialog.close();if(this.nextStatus==='Arrived')this.changed.emit();});}
  action(status:string){return ({'At pickup':'Team reached residents',Transporting:'Residents are moving to safety',Arrived:'Confirm shelter arrival',Blocked:'Report a problem',Cancelled:'Cancel mission',Dispatched:'Resume dispatch'} as Record<string,string>)[status]??status;}
  private run(request:ReturnType<ApiService['addRescueTeam']>,after:()=>void=()=>{}){this.saving=true;this.error='';this.success='';this.subscriptions.add(request.pipe(finalize(()=>{this.saving=false;this.cdr.markForCheck();})).subscribe({next:result=>{this.success=result.message;after();this.refresh();},error:error=>{this.error=error?.error?.message??'Changes were not saved. Refresh and try again.';this.refresh();}}));}
}
