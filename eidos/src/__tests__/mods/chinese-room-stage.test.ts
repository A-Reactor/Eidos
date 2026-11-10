// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {loadChineseRoom,sceneFixture,type GameApi,type Scene,type MapLayout,type Position} from './chinese-room-fixtures';
interface Context {sceneMapFiles?:Array<{path:string;version:string;name:string;size:number}>;keyboardShortcuts?:Record<string,string>;scope:string;state:{maps?:Record<string,{layout:MapLayout;generated?:string;sourceFile?:string}>;positions?:Record<string,Position>};scene:Scene|null;settings:{auto_map:boolean;map_style?:string};surface:{active:boolean};capabilities:{analysis:{available:boolean}};reading:{complete:boolean;loading:boolean;paused?:boolean;inputBlocked?:boolean;error?:string;index:number;segments:Array<{text:string}>;displayedText:string};world:{id:string;sceneName:string;nodeId:string;sceneId?:string};inventory:Array<{id:string;name:string;quantity:number}>}
afterEach(()=>document.body.replaceChildren());
function stage(initial:Partial<Context>={}){const frame=document.createElement('iframe');document.body.append(frame);const win=frame.contentWindow! as Window&typeof globalThis&{ChineseRoom:GameApi;Eidos:Record<string,unknown>};const doc=frame.contentDocument!;doc.open();doc.write(readFileSync('mods/chinese-room/index.html','utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,''));doc.close();doc.documentElement.dataset.motion='reduced';let publish!:(c:Context)=>void,finish:((s:string)=>void)|undefined;
let current:Context={scope:'root',state:{},scene:sceneFixture(),settings:{auto_map:false},surface:{active:true},capabilities:{analysis:{available:true}},reading:{complete:true,loading:false,index:0,segments:[{text:'阿澄站在桥边，抬头看向你。'}],displayedText:''},world:{id:'world',sceneName:'河边小村',nodeId:'root'},inventory:[{id:'tool',name:'螺丝刀',quantity:1}]};
current={...current,...initial};
const fileContents=new Map<string,string>();const readFile=vi.fn(async(path:string,version:string)=>{const text=fileContents.get(path);if(!text)throw new Error('文件不存在');return{version,text};});
const notices:string[]=[];const intents:Record<string,string>[]=[],writes:string[]=[],advance=vi.fn(),cancel=vi.fn(async()=>{});const inspect=vi.fn(()=>new Promise(resolve=>{finish=s=>resolve({content:s});}));let reject=false;
win.Eidos={onContext(fn:typeof publish){publish=fn;},setState(state:Context['state']){current={...current,state};publish(current);},advance,world:{files:{read:readFile},async notice(message:string){notices.push(message);},async interact(intent:Record<string,string>,state:Context['state']){if(reject)throw new Error('世界已切换');intents.push(intent);current={...current,state};publish(current);}},files:{async write(_path:string,text:string){writes.push(text);},async export(){},async downloadText(_name:string,text:string){writes.push(text);}},resources:{inspect,cancel}};
for(const file of ['protocol','engine','map-design','generation','view','ui'])win.eval(readFileSync(`mods/chinese-room/${file}.js`,'utf8'));publish(current);
return{win,doc,intents,writes,notices,fileContents,readFile,advance,cancel,inspect,get current(){return current;},set reject(v:boolean){reject=v;},click(id:string){doc.querySelector<HTMLButtonElement>('#'+id)!.click();},async flush(){await new Promise(r=>setTimeout(r,0));},publish(c:Context){current=c;publish(c);},finish(v:unknown){finish?.(JSON.stringify(v));}};}
it('adds only the map, walks locally, and waits for confirmation when facing an NPC',async()=>{const app=stage();expect(app.doc.querySelector('main')!.children).toHaveLength(1);expect(app.doc.querySelector('input,details,header,footer,form,h1')).toBeNull();expect(app.doc.querySelectorAll('[data-cell]')).toHaveLength(135);app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowLeft'}));expect(app.current.state.positions!.village.x).toBe(6);expect(app.intents).toHaveLength(0);const npc=app.current.state.maps!.village.layout.entities.find(e=>e.kind==='npc')!;app.publish({...app.current,state:{...app.current.state,positions:{village:{x:npc.x,y:npc.y+1,facing:[0,1]}}}});app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowUp'}));await app.flush();expect(app.intents).toHaveLength(0);app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'z'}));await app.flush();expect(app.intents).toEqual([{kind:'talk',targetId:'cheng'}]);});
it('clicks a real NPC to approach and submit the host action without a custom dialogue component',async()=>{const app=stage(),npc=app.current.state.maps!.village.layout.entities.find(e=>e.kind==='npc')!;app.doc.querySelector<HTMLButtonElement>(`[data-cell="${npc.x},${npc.y}"]`)!.click();await app.flush();expect(app.intents[0]).toEqual({kind:'talk',targetId:'cheng'});expect(app.doc.querySelector('#dialogue')).toBeNull();expect(app.current.state).not.toHaveProperty('bag');});
it('forwards confirmation to the original reader while dialogue is open and locks walking',()=>{const app=stage(),x=app.current.state.positions!.village.x;app.publish({...app.current,scene:null,reading:{...app.current.reading,complete:false,displayedText:'阿澄站'}});app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowLeft'}));expect(app.current.state.positions!.village.x).toBe(x);app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'Enter'}));expect(app.advance).toHaveBeenCalledOnce();});
it('validates generated maps, keeps movement responsive, and cancels old drawing on Escape or scope changes',async()=>{const app=stage(),original=app.current.state.maps!.village.layout;app.publish({...app.current,settings:{auto_map:true}});await app.flush();expect(app.inspect).toHaveBeenCalledTimes(1);app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowLeft'}));expect(app.current.state.positions!.village.x).toBe(6);const next=structuredClone(original);next.tiles.沙={name:'沙地',walkable:true};next.rows=next.rows.map(r=>r.replaceAll('路','沙'));app.finish(next);await app.flush();expect(app.current.state.maps!.village.layout.rows).toEqual(next.rows);app.publish({...app.current,settings:{auto_map:true,map_style:'庭院'}});await app.flush();app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'Escape'}));expect(app.cancel).toHaveBeenCalledOnce();app.finish(original);await app.flush();expect(app.current.state.maps!.village.layout.rows).toEqual(next.rows);app.publish({...app.current,settings:{auto_map:true,map_style:'河岸'}});await app.flush();app.publish({...app.current,scope:'another-branch',surface:{active:false}});expect(app.cancel).toHaveBeenCalledTimes(2);app.finish(original);await app.flush();expect(app.current.state.maps!.village.layout.rows).toEqual(next.rows);});
it('does not retry failed automatic drawing on each dialogue node and uses existing host notices',async()=>{const app=stage();app.publish({...app.current,settings:{auto_map:true}});await app.flush();app.finish({format:'wrong'});await app.flush();expect(app.notices.join('')).toContain('仍可继续探索');app.publish({...app.current,scope:'dialogue-2'});await app.flush();expect(app.inspect).toHaveBeenCalledTimes(1);app.publish({...app.current,settings:{auto_map:false}});app.publish({...app.current,settings:{auto_map:true}});await app.flush();expect(app.inspect).toHaveBeenCalledTimes(2);});
it('restores visual position from a rewind and supplies the map design guide to generation',async()=>{const app=stage(),saved=structuredClone(app.current);app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowLeft'}));app.publish({...saved,scope:'rewind'});expect(app.current.state.positions!.village.x).toBe(7);app.publish({...app.current,settings:{auto_map:true}});await app.flush();const material=JSON.parse(app.writes.at(-1)!);expect(material.designGuide).toContain('先设计空间');expect(material.scene.id).toBe('village');expect(material).not.toHaveProperty('inventory');});
it('keeps the pending return-door arrival through the old-scene state acknowledgement',async()=>{const app=stage(),exit=app.current.state.maps!.village.layout.entities.find(e=>e.kind==='exit')!;app.doc.querySelector<HTMLButtonElement>(`[data-cell="${exit.x},${exit.y}"]`)!.click();await app.flush();expect(app.intents.at(-1)).toEqual({kind:'travel',targetId:'workshop'});const target={...sceneFixture(),id:'workshop',name:'木工坊',exits:[{id:'village',name:'河边小村',blocked:false}]};app.publish({...app.current,scope:'workshop-node',world:{...app.current.world,sceneName:'木工坊',nodeId:'next'},scene:target});const map=app.current.state.maps!.workshop.layout,position=app.current.state.positions!.workshop,back=map.entities.find(e=>e.kind==='exit'&&e.ref==='village')!;expect(Math.abs(position.x-back.x)+Math.abs(position.y-back.y)).toBe(1);});
it('cancels drawing when an action is started from the unchanged native input',async()=>{const app=stage();app.publish({...app.current,settings:{auto_map:true}});await app.flush();expect(app.inspect).toHaveBeenCalledOnce();app.publish({...app.current,scene:null,reading:{...app.current.reading,loading:true}});expect(app.cancel).toHaveBeenCalledOnce();});

it('uses the selected confirmation key without treating old, modified or repeated keys as interaction', async () => {
  const app = stage(), npc = app.current.state.maps!.village.layout.entities.find(e => e.kind === 'npc')!;
  app.publish({ ...app.current, keyboardShortcuts: { advance: 'q', status: 'a' }, state: { ...app.current.state, positions: { village: { x: npc.x, y: npc.y + 1, facing: [0, -1] } } } });
  for (const init of [{ key: 'z' }, { key: 'q', ctrlKey: true }, { key: 'q', repeat: true }, { key: 'q', isComposing: true }]) app.win.dispatchEvent(new app.win.KeyboardEvent('keydown', init));
  await app.flush(); expect(app.intents).toHaveLength(0);
  app.win.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'q' }));
  await app.flush(); expect(app.intents).toEqual([{ kind: 'talk', targetId: 'cheng' }]);
});

it('keeps arrow movement and avoids using reserved host keys for WASD movement', () => {
  const app = stage(), x = app.current.state.positions!.village.x;
  app.publish({ ...app.current, keyboardShortcuts: { advance: 'z', status: 'a', worldline: 's', gallery: 'd' } });
  app.win.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'a' }));
  expect(app.current.state.positions!.village.x).toBe(x);
  app.win.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(app.current.state.positions!.village.x).toBe(x - 1);
});

const mapFile=(version='v1')=>({path:'outputs/action/scene_map.txt',version,name:'地点地图',size:100});
it('adopts a played map file before automatic analysis and keeps the same layout across later dialogue',async()=>{
  const app=stage(),layout=structuredClone(app.current.state.maps!.village.layout);
  layout.tiles.沙={name:'沙地',walkable:true};layout.rows=layout.rows.map(row=>row.replaceAll('路','沙'));
  app.fileContents.set(mapFile().path,JSON.stringify(layout));
  expect(app.readFile).not.toHaveBeenCalled();
  app.publish({...app.current,sceneMapFiles:[mapFile()],settings:{auto_map:true}});await app.flush();
  expect(app.current.state.maps!.village.layout.rows).toEqual(layout.rows);
  expect(app.inspect).not.toHaveBeenCalled();expect(app.readFile).toHaveBeenCalledOnce();
  app.publish({...app.current,scope:'later-dialogue',world:{...app.current.world,nodeId:'next'}});await app.flush();
  expect(app.inspect).not.toHaveBeenCalled();expect(app.readFile).toHaveBeenCalledOnce();
});
it('uses committed file changes during reading but waits for new public objects before adopting them',async()=>{
  const app=stage(),layout=structuredClone(app.current.state.maps!.village.layout);
  layout.tiles.沙={name:'沙地',walkable:true};layout.rows=layout.rows.map(row=>row.replaceAll('路','沙'));
  app.fileContents.set(mapFile().path,JSON.stringify(layout));
  app.publish({...app.current,scene:null,sceneMapFiles:[mapFile()],reading:{...app.current.reading,complete:false}});await app.flush();
  expect(app.current.state.maps!.village.layout.rows).toEqual(layout.rows);
  const nextScene=sceneFixture();nextScene.npcs.push({id:'keeper',name:'守灯人'});
  const next=app.win.ChineseRoom.reconcile(layout,nextScene,app.current.state.positions!.village);
  app.fileContents.set(mapFile().path,JSON.stringify(next));
  app.publish({...app.current,sceneMapFiles:[mapFile('v2')]});await app.flush();
  expect(app.current.state.maps!.village.layout.entities.some(e=>e.ref==='keeper')).toBe(false);
  expect(app.notices).toHaveLength(0);
  app.publish({...app.current,scene:nextScene,reading:{...app.current.reading,complete:true}});await app.flush();
  expect(app.current.state.maps!.village.layout.entities.some(e=>e.ref==='keeper')).toBe(true);
});
it('keeps the existing map on invalid files, reports it once, and never treats a file as a world command',async()=>{
  const app=stage(),layout=structuredClone(app.current.state.maps!.village.layout);
  app.fileContents.set(mapFile().path,JSON.stringify({...layout,entities:[{...layout.entities[0],ref:'invented'}],inventory:[{id:'free-gold'}]}));
  app.publish({...app.current,sceneMapFiles:[mapFile()]});await app.flush();
  expect(app.current.state.maps!.village.layout).toEqual(layout);expect(app.current.state).not.toHaveProperty('inventory');
  expect(app.notices).toHaveLength(1);
  app.publish({...app.current,scope:'later'});await app.flush();
  expect(app.notices).toHaveLength(1);expect(app.readFile).toHaveBeenCalledOnce();
});
it('discards a late map file when the player switches to another branch',async()=>{
  const app=stage(),original=structuredClone(app.current.state.maps!.village.layout),next=structuredClone(original);
  next.tiles.沙={name:'沙地',walkable:true};next.rows=next.rows.map(row=>row.replaceAll('路','沙'));
  let finish!:(value:{version:string;text:string})=>void;
  app.readFile.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  app.publish({...app.current,sceneMapFiles:[mapFile()]});
  app.publish({...app.current,scope:'other-branch',sceneMapFiles:[]});
  finish({version:'v1',text:JSON.stringify(next)});await app.flush();
  expect(app.current.state.maps!.village.layout).toEqual(original);
});
it('shows a blocked exit and uses the normal notice instead of submitting an impossible trip',async()=>{
  const app=stage(),scene=sceneFixture();scene.exits[0].blocked=true;app.publish({...app.current,scene});
  const exit=app.current.state.maps!.village.layout.entities.find(e=>e.kind==='exit')!;
  const cell=app.doc.querySelector<HTMLButtonElement>(`[data-cell="${exit.x},${exit.y}"]`)!;
  expect(cell.title).toContain('暂不可通行');cell.click();await app.flush();
  expect(app.intents).toHaveLength(0);expect(app.notices.at(-1)).toContain('无法通过');
});
it('unlocks the original map after a failed response instead of waiting forever for missing paragraphs',()=>{
  const app=stage(),x=app.current.state.positions!.village.x;
  app.publish({...app.current,reading:{...app.current.reading,complete:false,error:'网络失败'}});
  app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowLeft'}));
  expect(app.current.state.positions!.village.x).toBe(x-1);
});

it('does not repeatedly read old maps from other places as normal dialogue progresses',async()=>{
  const app=stage(),map=structuredClone(app.current.state.maps!.village.layout);
  const other={...map,sceneId:'workshop'},otherFile={...mapFile(),path:'outputs/other/scene_map.txt'};
  app.fileContents.set(mapFile().path,JSON.stringify(map));app.fileContents.set(otherFile.path,JSON.stringify(other));
  app.publish({...app.current,sceneMapFiles:[mapFile(),otherFile]});await app.flush();
  expect(app.readFile).toHaveBeenCalledTimes(2);
  app.publish({...app.current,scope:'another-dialogue'});await app.flush();
  expect(app.readFile).toHaveBeenCalledTimes(2);
});
it('preserves a requested restyling on later dialogue instead of reapplying the old source file',async()=>{
  const app=stage(),map=structuredClone(app.current.state.maps!.village.layout);
  app.fileContents.set(mapFile().path,JSON.stringify(map));
  app.publish({...app.current,sceneMapFiles:[mapFile()],settings:{auto_map:true}});await app.flush();
  app.publish({...app.current,settings:{auto_map:true,map_style:'沙地'}});await app.flush();
  expect(app.inspect).toHaveBeenCalledOnce();
  map.tiles.沙={name:'沙地',walkable:true};map.rows=map.rows.map(row=>row.replaceAll('路','沙'));
  app.finish(map);await app.flush();
  app.publish({...app.current,scope:'later-dialogue'});await app.flush();
  expect(app.current.state.maps!.village.layout.rows).toEqual(map.rows);expect(app.readFile).toHaveBeenCalledOnce();
});
it('uses a first map file own entrance instead of requiring a placeholder room coordinate',async()=>{
  const app=stage(),layout={format:'eidos-scene-map',version:1,sceneId:'village',tiles:{地:{name:'地面',walkable:true}},rows:Array.from({length:5},()=> '地'.repeat(7)),entry:{x:3,y:3},entities:[{id:'door',kind:'exit',ref:'workshop',name:'木工坊',glyph:'坊',x:3,y:0},{id:'npc',kind:'npc',ref:'cheng',name:'阿澄',glyph:'澄',x:2,y:2},{id:'letter',kind:'object',ref:'letter',name:'旧信',glyph:'信',x:4,y:2}]};
  app.fileContents.set(mapFile().path,JSON.stringify(layout));
  app.publish({...app.current,sceneMapFiles:[mapFile()]});await app.flush();
  expect(app.current.state.maps!.village.layout.rows).toEqual(layout.rows);
  expect(app.current.state.positions!.village).toEqual({x:3,y:3,facing:[0,-1]});
});
it('keeps the player position after local movement when a new file would put a wall there',async()=>{
  const app=stage();app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowLeft'}));
  const position=structuredClone(app.current.state.positions!.village),original=structuredClone(app.current.state.maps!.village.layout),next=structuredClone(original);
  next.tiles.墙={name:'墙',walkable:false};const row=Array.from(next.rows[position.y]);row[position.x]='墙';next.rows[position.y]=row.join('');
  app.fileContents.set(mapFile().path,JSON.stringify(next));
  app.publish({...app.current,sceneMapFiles:[mapFile()]});await app.flush();
  expect(app.current.state.maps!.village.layout).toEqual(original);expect(app.current.state.positions!.village).toEqual(position);
  expect(app.notices.at(-1)).toContain('主角');
});

it('keeps a focused map object stable while the host publishes another reading update',()=>{
 const app=stage(),npc=app.doc.querySelector<HTMLButtonElement>('.npc')!;
 npc.focus();app.publish({...app.current,reading:{...app.current.reading,displayedText:'更新后的正文'}});
 expect(app.doc.activeElement).toBe(npc);expect(app.doc.querySelector('.npc')).toBe(npc);
});
it('leaves Enter and Space on a focused map object to its native click instead of interacting with the facing object',()=>{
 const app=stage(),npc=app.doc.querySelector<HTMLButtonElement>('.npc')!;npc.focus();
 for(const key of ['Enter',' ']) {
  const event=new app.win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});npc.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
 }
 expect(app.intents).toHaveLength(0);
});
it('blocks movement and confirmation when a host menu owns input while keeping the map visible',()=>{
 const app=stage(),position=structuredClone(app.current.state.positions!.village);
 app.publish({...app.current,reading:{...app.current.reading,inputBlocked:true}});
 app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'ArrowLeft'}));
 expect(app.current.state.positions!.village).toEqual(position);
 expect(app.doc.querySelectorAll('[data-cell]').length).toBeGreaterThan(0);
 app.publish({...app.current,scene:null,reading:{...app.current.reading,complete:false}});
 app.win.dispatchEvent(new app.win.KeyboardEvent('keydown',{key:'z'}));expect(app.advance).not.toHaveBeenCalled();
});

it('keeps a saved map visible when loading into an unfinished conversation',()=>{
 const game=loadChineseRoom(),map=game.baseMap(sceneFixture()),position=game.positionFor(map);
 const app=stage({scene:null,state:{maps:{village:{layout:map}},positions:{village:position}},world:{id:'world',sceneName:'河边小村',sceneId:'village',nodeId:'root'},reading:{complete:false,loading:false,index:0,segments:[{text:'还未说完的对话'}],displayedText:'还未'}});
 expect(app.doc.querySelector('[data-player="true"]')).not.toBeNull();
 expect(app.doc.querySelectorAll('[data-cell]').length).toBeGreaterThan(0);
 expect(app.doc.querySelector<HTMLButtonElement>('.npc')!.disabled).toBe(true);
});
it('finishes a pending map drawing while a host menu temporarily blocks controls',async()=>{
 const app=stage(),map=structuredClone(app.current.state.maps!.village.layout);
 app.publish({...app.current,settings:{auto_map:true}});await app.flush();
 app.publish({...app.current,reading:{...app.current.reading,inputBlocked:true}});
 map.tiles.沙={name:'沙地',walkable:true};map.rows=map.rows.map(row=>row.replaceAll('路','沙'));
 app.finish(map);await app.flush();expect(app.current.state.maps!.village.layout.rows).toEqual(map.rows);
 expect(app.doc.querySelector<HTMLButtonElement>('.npc')!.disabled).toBe(true);
});
