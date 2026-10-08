import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Subscription, finalize } from 'rxjs';
import { RescueComponent } from './rescue.component';
import { ApiService } from './api.service';

@Component({selector:'app-community-support',standalone:true,imports:[FormsModule,DatePipe,RescueComponent],templateUrl:'./community-support.component.html',styleUrl:'./community-support.component.scss'})
export class CommunitySupportComponent implements OnInit,OnDestroy {
  @Input() resident=false;
  @Output() planner=new EventEmitter<void>();
  @ViewChild('rescueWorkspace') rescue?:RescueComponent;
  @ViewChild('reviewDialog') dialog!:ElementRef<HTMLDialogElement>;
  private api=inject(ApiService);
  private cdr=inject(ChangeDetectorRef);
  private subscriptions=new Subscription();
  private listSubscription?:Subscription;
  private historySubscription?:Subscription;
  private refreshTimer?:ReturnType<typeof setInterval>;
  tab:'requests'|'households'='requests';
  items:Record<string,any>[]=[];
  staffMembers:{user_id:string;full_name:string}[]=[];
  search='';status='';page=1;pages=0;total=0;
  loading=false;saving=false;error='';success='';historyError='';historyLoading=false;
  checkIn={kind:'Need help',location:'',needs:''};
  selected:Record<string,any>|null=null;
  review={status:'Acknowledged',assignedUserId:'',note:'',confirmed:false};
  history:Record<string,any>[]=[];
  rescueConfirmed=false;shelterId='';shelterSearch='';shelterPage=1;shelterPages=0;shelters:Record<string,any>[]=[];sheltersLoading=false;rescueOpen=false;
  canRescue(row:Record<string,any>){return !this.resident&&row['kind']==='Need help'&&row['status']!=='Closed'&&row['record_status']==='Active'&&row['evacuation_status']!=='Evacuated'&&!row['mission_id']&&!['Missing','Deceased'].includes(row['outcome']);}
  loadShelters(page=1){
    if(this.sheltersLoading)return;this.sheltersLoading=true;this.shelterPage=page;this.shelterId='';
    this.subscriptions.add(this.api.list<Record<string,any>>('shelters',page,20,this.shelterSearch,'shelter_name','asc').pipe(finalize(()=>{this.sheltersLoading=false;this.cdr.markForCheck();})).subscribe({next:r=>{this.shelters=r.items.filter(s=>s['record_status']==='Active'&&!['Full','Unavailable'].includes(s['status']));this.shelterPages=r.totalPages;},error:e=>{this.error=e?.error?.message??'Destinations could not be loaded.';}}));
  }
  prepareRescue(){
    const row=this.selected,destination=this.shelters.find(s=>s['shelter_id']===this.shelterId);
    if(this.saving||!row||!this.canRescue(row)||!this.rescueConfirmed||!destination||!this.rescue)return;
    this.dialog.nativeElement.close();this.historySubscription?.unsubscribe();
    this.rescue.prepare([{id:row['resident_id'],name:row['full_name'],household:row['household_number'],address:row['location'],status:row['evacuation_status']}],{id:destination['shelter_id'],name:destination['shelter_name']},{requestId:row['request_id'],revision:row['revision'],confirmed:true});
    this.rescue.pickup=row['location'];this.rescue.instructions=row['needs'];this.selected=null;
  }

  ngOnInit(){this.load();this.refreshTimer=setInterval(()=>{if(!this.saving&&!this.dialog?.nativeElement.open)this.load();},30000);}
  ngOnDestroy(){clearInterval(this.refreshTimer);this.listSubscription?.unsubscribe();this.historySubscription?.unsubscribe();this.subscriptions.unsubscribe();}
  switchTab(tab:'requests'|'households'){this.tab=tab;this.status='';this.page=1;this.error='';this.load();}
  filter(){this.page=1;this.load();}
  load(){
    this.listSubscription?.unsubscribe();this.loading=true;
    const request=this.resident?this.api.get<{items:Record<string,any>[]}>('community-support','mine'):this.api.list<Record<string,any>>(`community-support/${this.tab}`,this.page,20,this.search,'','asc',{status:this.status});
    this.listSubscription=request.pipe(finalize(()=>{this.loading=false;this.cdr.markForCheck();})).subscribe({
      next:result=>{this.items=result.items;const list=result as any;this.pages=list.totalPages??0;this.total=list.totalItems??result.items.length;this.staffMembers=list.staffMembers??[];if(!this.resident&&this.page>Math.max(1,this.pages)){this.page=Math.max(1,this.pages);this.load();}},
      error:error=>{this.error=error?.error?.message??'Updates could not be loaded. Try refreshing.';}
    });
  }
  submit(event:Event){
    event.preventDefault();if(this.saving)return;this.error='';this.success='';this.saving=true;
    this.subscriptions.add(this.api.create<{message:string}>('community-support/mine',this.checkIn).pipe(finalize(()=>{this.saving=false;this.cdr.markForCheck();})).subscribe({next:result=>{this.success=result.message;this.checkIn={kind:'Need help',location:'',needs:''};this.load();},error:error=>{this.error=error?.error?.message??'Your check-in was not submitted. Try again.';}}));
  }
  open(row:Record<string,any>){
    this.rescueOpen=true;this.cdr.detectChanges();this.rescueConfirmed=false;this.shelterId='';this.shelterSearch='';if(this.canRescue(row))this.loadShelters();
    this.selected=row;this.review={status:this.tab==='requests'?(row['status']==='Closed'?'Closed':'Acknowledged'):row['status'],assignedUserId:row['assigned_user_id']??'',note:'',confirmed:false};
    this.error='';this.history=[];this.historyError='';this.historyLoading=true;
    this.historySubscription?.unsubscribe();
    this.dialog.nativeElement.showModal();
    const id=row[this.tab==='requests'?'request_id':'household_id'];
    this.historySubscription=this.api.get<{history:Record<string,any>[]}>('community-support/'+this.tab,id).pipe(finalize(()=>{this.historyLoading=false;this.cdr.markForCheck();})).subscribe({next:result=>{this.history=result.history;},error:()=>{this.historyError='History could not be loaded. Close and reopen to retry.';}});
  }
  close(){if(this.saving)return;this.dialog.nativeElement.close();this.historySubscription?.unsubscribe();this.selected=null;this.load();}
  save(event:Event){
    event.preventDefault();if(this.saving||!this.selected)return;this.error='';this.success='';this.saving=true;
    const id=this.selected[this.tab==='requests'?'request_id':'household_id'];
    const body:Record<string,unknown>={status:this.review.status,note:this.review.note,revision:this.selected['revision']};
    if(this.tab==='requests')body['confirmed']=this.review.confirmed;else body['assignedUserId']=this.review.assignedUserId||null;
    this.subscriptions.add(this.api.update('community-support/'+this.tab,id,body).pipe(finalize(()=>{this.saving=false;this.cdr.markForCheck();})).subscribe({next:()=>{this.dialog.nativeElement.close();this.selected=null;this.success='Update recorded.';this.load();},error:error=>{this.error=error?.error?.message??'Update was not saved. Try again.';}}));
  }
}
