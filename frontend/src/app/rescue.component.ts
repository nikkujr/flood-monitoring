import {Component,EventEmitter,Input,Output,OnInit,OnDestroy,ViewChild,ElementRef,inject,ChangeDetectorRef} from '@angular/core';
import {DatePipe} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {Subscription,timer,exhaustMap,catchError,of,finalize} from 'rxjs';
import {ApiService} from './api.service';
import type {RescueBoard,RescueMission,RescuePerson,RescueTeam,ResidentOutcome,ResponseView} from './rescue.models';

@Component({selector:'app-rescue',standalone:true,imports:[DatePipe,FormsModule],templateUrl:'./rescue.component.html',styleUrl:'./rescue.component.scss'})
export class RescueComponent implements OnInit,OnDestroy {
  private api=inject(ApiService);private cdr=inject(ChangeDetectorRef);private subscriptions=new Subscription();
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
  openTeam(){if(!this.canManage||this.saving)return;this.error='';this.resetTeam();this.teamDialog.nativeElement.showModal();}
  openOutcome(){if(!this.canManage||this.saving)return;this.error='';this.outcomeResident=null;this.outcomeCandidates=[];this.outcomeResidentSearch='';this.outcomeDialog.nativeElement.showModal();}
  recordMissionOutcome(m:RescueMission,r:RescuePerson,progress?:HTMLDialogElement){if(!this.canManage||this.saving)return;progress?.close();this.error='';this.outcomeResidentSearch='';this.selectOutcomeResident({resident_id:r.id,full_name:r.name,address_line:m.pickup});this.outcomeDialog.nativeElement.showModal();}
  arrivingResidents(m:RescueMission){return m.residents.filter(r=>r.outcome!=='Missing'&&r.outcome!=='Deceased');}
  board:RescueBoard|null=null;error='';success='';saving=false;loading=true;
  people:RescuePerson[]=[];destination:{id:string;name:string}|null=null;teamId='';pickup='';instructions='';dispatchConfirmed=false;
  team={name:'',leaderId:'',memberIds:[] as string[],vehicle:'',passengerCapacity:0};
  withVehicle=false;
  changeMovement(){this.team.vehicle='';this.team.passengerCapacity=this.withVehicle?1:0;}
  responderSearch='';
  get visibleResponders(){return this.board?.responders.filter(r=>[r.full_name,r.responder_type].join(' ').toLowerCase().includes(this.responderSearch.trim().toLowerCase()))??[];}
  get selectedResponders(){return this.board?.responders.filter(r=>this.team.memberIds.includes(r.volunteer_id))??[];}
  toggleResponder(id:string,checked:boolean){this.team.memberIds=checked?[...this.team.memberIds,id]:this.team.memberIds.filter(i=>i!==id);if(!this.team.memberIds.includes(this.team.leaderId))this.team.leaderId='';}
  outcomeSearch='';outcomeResidentSearch='';outcomeCandidates:Record<string,any>[]=[];outcomeResident:Record<string,any>|null=null;
  outcomeForm={outcome:'Missing',source:'',notes:'',lastSeenLocation:'',observedAt:'',confirmed:false,revision:0};
  get canRecordDeath(){return ['Super Admin','Disaster Officer'].includes(this.api.user()?.role??'');}
  get visibleOutcomes(){return this.board?.outcomes.filter(o=>[o.full_name,o.household_number,o.zone_name,o.outcome].join(' ').toLowerCase().includes(this.outcomeSearch.trim().toLowerCase()))??[];}
  outcomeCount(outcome:string){return this.board?.outcomes.filter(o=>o.outcome===outcome).length??0;}
  findOutcomeResident(){const query=this.outcomeResidentSearch.trim();if(!query)return;this.subscriptions.add(this.api.list<Record<string,any>>('residents',1,30,query,'r.full_name','asc').subscribe({next:result=>{if(this.outcomeResidentSearch.trim()===query)this.outcomeCandidates=result.items;this.cdr.markForCheck();},error:()=>{this.error='Resident search failed. Try again.';this.cdr.markForCheck();}}));}
  selectOutcomeResident(r:Record<string,any>){this.outcomeResident=r;this.outcomeCandidates=[];const old=this.board?.outcomes.find(o=>o.resident_id===r['resident_id']);this.outcomeForm={outcome:old?.outcome??'Missing',source:'',notes:'',lastSeenLocation:old?.last_seen_location??r['address_line']??'',observedAt:new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),confirmed:false,revision:old?.revision??0};}
  reviewOutcome(o:ResidentOutcome){if(!this.canManage||this.saving)return;this.selectOutcomeResident({resident_id:o.resident_id,full_name:o.full_name,address_line:o.last_seen_location});this.outcomeDialog.nativeElement.showModal();}
  get canSaveOutcome(){const previous=this.board?.outcomes.find(o=>o.resident_id===this.outcomeResident?.['resident_id']);return this.canManage&&!!this.outcomeResident&&this.outcomeForm.confirmed&&!!this.outcomeForm.source.trim()&&!!this.outcomeForm.notes.trim()&&!!this.outcomeForm.lastSeenLocation.trim()&&Number.isFinite(Date.parse(this.outcomeForm.observedAt))&&((previous?.outcome!=='Deceased'&&this.outcomeForm.outcome!=='Deceased')||this.canRecordDeath);}
  saveOutcome(){if(this.saving||!this.canSaveOutcome||!this.outcomeResident)return;this.run(this.api.recordResidentOutcome(this.outcomeResident['resident_id'],{...this.outcomeForm,observedAt:new Date(this.outcomeForm.observedAt).toISOString()}),()=>{this.outcomeDialog.nativeElement.close();this.outcomeResident=null;this.changed.emit();});}
  editingTeamId='';
  editTeam(t:RescueTeam){if(!this.canManage||this.saving)return;this.editingTeamId=t.team_id;this.withVehicle=!!t.vehicle;this.team={name:t.name,leaderId:t.leader_id??'',memberIds:t.members.map(m=>m.volunteer_id),vehicle:t.vehicle??'',passengerCapacity:t.passenger_capacity};this.teamDialog.nativeElement.showModal();}
  resetTeam(){this.editingTeamId='';this.withVehicle=false;this.responderSearch='';this.team={name:'',leaderId:'',memberIds:[],vehicle:'',passengerCapacity:0};}
  mission:RescueMission|null=null;nextStatus='';note='';confirmedArrival=false;search='';
  missionPage=1;outcomePage=1;teamPage=1;
  get missionPageCount(){return Math.max(1,Math.ceil(this.visibleMissions.length/3));}
  get outcomePageCount(){return Math.max(1,Math.ceil(this.visibleOutcomes.length/3));}
  get teamPageCount(){return Math.max(1,Math.ceil((this.board?.teams.length??0)/5));}
  get pagedMissions(){return this.visibleMissions.slice((Math.min(this.missionPage,this.missionPageCount)-1)*3,Math.min(this.missionPage,this.missionPageCount)*3);}
  get pagedOutcomes(){return this.visibleOutcomes.slice((Math.min(this.outcomePage,this.outcomePageCount)-1)*3,Math.min(this.outcomePage,this.outcomePageCount)*3);}
  get pagedTeams(){return this.board?.teams.slice((Math.min(this.teamPage,this.teamPageCount)-1)*5,Math.min(this.teamPage,this.teamPageCount)*5)??[];}
  get canManage(){return !this.previewOnly&&['Super Admin','Disaster Officer','Data Encoder'].includes(this.api.user()?.role??'');}
  get availableTeams(){return this.board?.teams.filter(t=>t.availability==='Available'&&!t.active_mission_id&&t.members.length&&t.leader_id&&t.members.every(m=>m.availability_status==='Available'&&!m.active_mission_id))??[];}
  get selectedTeam(){return this.availableTeams.find(t=>t.team_id===this.teamId);}
  get hasSuitableTeam(){return this.availableTeams.some(t=>!t.vehicle||t.passenger_capacity>=this.people.length);}
  fitsTeam(t:RescueTeam){return !t.vehicle||t.passenger_capacity>=this.people.length;}
  statusLabel(m:RescueMission,status=m.status){return status==='Arrived'?`Completed · ${m.residents.filter(r=>!r.arrivalStatus||r.arrivalStatus==='Arrived').length} shelter arrivals`:status==='Transporting'&&!m.team_snapshot.vehicle?'Escorting residents':status;}
  get activeMissions(){return this.board?.missions.filter(m=>!['Arrived','Cancelled'].includes(m.status))??[];}
  get assignedResidentIds(){return new Set(this.activeMissions.flatMap(m=>m.residents.map(r=>r.id)));}
  get visibleMissions(){return this.activeMissions.filter(m=>[m.team_snapshot.name,m.pickup,m.shelter_name,...m.residents.map(r=>r.name)].join(' ').toLowerCase().includes(this.search.trim().toLowerCase()));}
  get completedMissions(){return this.board?.missions.filter(m=>['Arrived','Cancelled'].includes(m.status))??[];}
  get awaitingUpdate(){return this.activeMissions.filter(m=>Date.now()-Date.parse(m.updated_at)>30*60*1000).length;}
  get activeResidents(){return this.activeMissions.reduce((n,m)=>n+m.residents.length,0);}
  get arrivedResidents(){return this.completedMissions.filter(m=>m.status==='Arrived').reduce((n,m)=>n+m.residents.filter(r=>!r.arrivalStatus||r.arrivalStatus==='Arrived').length,0);}
  elapsed(m:RescueMission){return Math.max(0,Math.round((Date.parse(m.arrived_at??m.updated_at)-Date.parse(m.created_at))/60000));}
  stale(m:RescueMission){return Date.now()-Date.parse(m.updated_at)>30*60*1000;}
  hasOutcomeIssue(m:RescueMission){return m.residents.some(r=>r.outcome==='Missing'||r.outcome==='Deceased');}
  ngOnInit(){this.subscriptions.add(timer(0,30000).pipe(exhaustMap(()=>this.api.rescueBoard().pipe(catchError(error=>{this.error=error?.error?.message??'Rescue updates could not be loaded. Refresh before acting.';return of(null);}))),finalize(()=>this.cdr.markForCheck())).subscribe(board=>{if(board){this.board=board;this.missionPage=Math.min(this.missionPage,this.missionPageCount);this.outcomePage=Math.min(this.outcomePage,this.outcomePageCount);this.teamPage=Math.min(this.teamPage,this.teamPageCount);this.assignedChange.emit(this.assignedResidentIds);}this.loading=false;this.cdr.markForCheck();}));}
  ngOnDestroy(){this.subscriptions.unsubscribe();}
  refresh(){this.subscriptions.add(this.api.rescueBoard().subscribe({next:board=>{this.board=board;this.missionPage=Math.min(this.missionPage,this.missionPageCount);this.outcomePage=Math.min(this.outcomePage,this.outcomePageCount);this.teamPage=Math.min(this.teamPage,this.teamPageCount);this.assignedChange.emit(this.assignedResidentIds);this.cdr.markForCheck();},error:error=>{this.error=error?.error?.message??'Unable to refresh rescue updates.';this.cdr.markForCheck();}}));}
  prepare(people:RescuePerson[],destination:{id:string;name:string},assistanceRequest?:{requestId:string;revision:number;confirmed:true}){
    if(!this.canManage||this.saving)return;
    this.assistanceRequest=assistanceRequest;this.people=people;this.destination=destination;this.teamId='';this.pickup=[...new Set(people.map(p=>p.address).filter(Boolean))].join('; ').slice(0,500);this.instructions='';this.dispatchConfirmed=false;this.error='';this.refresh();this.dispatchDialog.nativeElement.showModal();
  }
  dispatch(dialog:HTMLDialogElement){
    if(this.saving||!this.canManage||!this.destination||!this.dispatchConfirmed||!this.selectedTeam||!this.fitsTeam(this.selectedTeam))return;
    this.run(this.api.dispatchRescue({teamId:this.teamId,shelterId:this.destination.id,residentIds:this.people.map(p=>p.id),pickup:this.pickup,instructions:this.instructions,expectedStatuses:Object.fromEntries(this.people.map(p=>[p.id,p.status])),assistanceRequest:this.assistanceRequest}),()=>{dialog.close();this.success='Team dispatched.';this.search='';this.missionPage=1;this.showMissions();this.dispatched.emit();});
  }
  addTeam(){if(!this.canManage||this.saving)return;this.run(this.editingTeamId?this.api.editRescueTeam(this.editingTeamId,this.team):this.api.addRescueTeam(this.team),()=>{this.teamDialog.nativeElement.close();this.resetTeam();});}
  availability(id:string,value:string){if(!this.canManage||this.saving)return;this.run(this.api.setRescueTeamAvailability(id,value));}
  review(m:RescueMission,status:string,dialog:HTMLDialogElement){if(!this.canManage||this.saving)return;this.mission=m;this.nextStatus=status;this.note='';this.confirmedArrival=false;this.error='';dialog.showModal();}
  update(dialog:HTMLDialogElement){if(this.saving||!this.canManage||!this.mission||(['Blocked','Cancelled'].includes(this.nextStatus)&&!this.note.trim())||(this.nextStatus==='Arrived'&&(!this.confirmedArrival||!this.arrivingResidents(this.mission).length)))return;this.run(this.api.updateRescue(this.mission.mission_id,{status:this.nextStatus,revision:this.mission.revision,note:this.note,confirmedArrival:this.confirmedArrival,...(this.nextStatus==='Arrived'?{arrivalResidentIds:this.arrivingResidents(this.mission).map(r=>r.id)}:{})}),()=>{dialog.close();if(this.nextStatus==='Arrived')this.changed.emit();});}
  action(status:string){return ({'At pickup':'Team reached residents',Transporting:'Residents are moving to safety',Arrived:'Confirm shelter arrival',Blocked:'Report a problem',Cancelled:'Cancel mission',Dispatched:'Resume dispatch'} as Record<string,string>)[status]??status;}
  private run(request:ReturnType<ApiService['addRescueTeam']>,after:()=>void=()=>{}){this.saving=true;this.error='';this.success='';this.subscriptions.add(request.pipe(finalize(()=>{this.saving=false;this.cdr.markForCheck();})).subscribe({next:result=>{this.success=result.message;after();this.refresh();},error:error=>{this.error=error?.error?.message??'Changes were not saved. Refresh and try again.';this.refresh();}}));}
}
