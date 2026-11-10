const writes=new Map<string,Promise<unknown>>();

/** Tree and index publication share one boundary with read progress/page saves. */
export function withWorldLineWrite<T>(key:string,write:()=>Promise<T>):Promise<T> {
 const previous=writes.get(key) ?? Promise.resolve();
 const next=previous.catch(()=>{}).then(write);
 writes.set(key,next);
 const clear=()=>{if(writes.get(key)===next) writes.delete(key);};
 void next.then(clear,clear);
 return next;
}
