export type FormDraft = {values:Record<string,string|string[]>;step:number;updatedAt:number;expectedStatus?:string;hasPhotos:boolean};
type DraftStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const prefix='bantay-baha-draft:';
const lifetime=7*24*60*60*1000;
export const draftKey=(owner:string,resource:string,id='new') => `${prefix}${owner}:${resource}:${id}`;
export function draftValues(entries:Iterable<[string,unknown]>,excluded:string[]=[]):FormDraft['values'] {
  const values:FormDraft['values']=Object.create(null);
  for(const [name,value] of entries) {
    if(typeof value!=='string' || excluded.includes(name)) continue;
    const previous=values[name];
    values[name]=previous===undefined?value:Array.isArray(previous)?[...previous,value]:[previous,value];
  }
  return values;
}
export function readDraft(key:string,storage?:DraftStorage,now=Date.now()):FormDraft|undefined {
  try {
    const store=storage??globalThis.localStorage;
    const raw=store.getItem(key);if(!raw)return;
    const draft=JSON.parse(raw);
    if(!draft || !Number.isFinite(draft.updatedAt) || draft.updatedAt>now || now-draft.updatedAt>lifetime || !Number.isInteger(draft.step) || draft.step<0 || typeof draft.hasPhotos!=='boolean' || (draft.expectedStatus!==undefined&&typeof draft.expectedStatus!=='string') || !draft.values || typeof draft.values!=='object' || Array.isArray(draft.values) || !Object.values(draft.values).every(v=>typeof v==='string'||Array.isArray(v)&&v.every(x=>typeof x==='string'))) {store.removeItem(key);return;}
    return draft;
  } catch {return;}
}
export function writeDraft(key:string,draft:FormDraft,storage?:DraftStorage):boolean {
  try {(storage??globalThis.localStorage).setItem(key,JSON.stringify(draft));return true;}catch{return false;}
}
export function removeDraft(key:string,storage?:DraftStorage):boolean {
  try {(storage??globalThis.localStorage).removeItem(key);return true;}catch{return false;}
}
