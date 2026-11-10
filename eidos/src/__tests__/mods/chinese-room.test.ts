import {expect,it} from 'vitest';
import {loadChineseRoom,sceneFixture} from './chinese-room-fixtures';
const game=loadChineseRoom();
it('makes distinct maps from the actual current scene and binds every NPC and exit',()=>{const scene=sceneFixture(),map=game.baseMap(scene);expect(map.sceneId).toBe(scene.id);expect(map.entities.find(e=>e.kind==='npc')?.ref).toBe('cheng');expect(map.entities.find(e=>e.kind==='npc')?.glyph).toBe('澄');const indoor=game.baseMap({...scene,name:'木工坊',description:'木工坊的房间。'});expect(indoor.rows).not.toEqual(map.rows);});
it('walks and finds routes locally without maintaining a second world or action counter',()=>{const map=game.baseMap(sceneFixture()),p=game.positionFor(map);const next=game.move(map,p,1,0);expect(next.position.x).toBe(p.x+1);expect(p.x).not.toBe(next.position.x);expect(next).not.toHaveProperty('turn');const entity=map.entities.find(e=>e.kind==='npc')!,route=game.reachable(map,p,{...entity,entity:true})!;let pos=p;for(const[dx,dy]of route)pos=game.move(map,pos,dx,dy).position;expect(game.near(map,pos)).toContainEqual(entity);expect(game.intent(entity)).toEqual({kind:'talk',targetId:'cheng'});});
it('rejects invented NPCs, missing exits, overlapping entities and unreachable targets',()=>{const scene=sceneFixture(),map=game.baseMap(scene);const invented=structuredClone(map);invented.entities[0].ref='invented';expect(()=>game.validateMap(invented,scene)).toThrow();const overlap=structuredClone(map);overlap.entities[1].x=overlap.entities[0].x;overlap.entities[1].y=overlap.entities[0].y;expect(()=>game.validateMap(overlap,scene)).toThrow();const missing=structuredClone(map);missing.entities=missing.entities.filter(e=>e.kind!=='exit');expect(()=>game.validateMap(missing,scene)).toThrow();const blocked=structuredClone(map);blocked.rows[3]='水'.repeat(15);expect(()=>game.validateMap(blocked,scene)).toThrow();});
it('accepts custom terrain and keeps player coordinates usable when redrawing',()=>{const scene=sceneFixture(),map=game.baseMap(scene),p=game.positionFor(map);map.tiles.沙={name:'沙地',walkable:true};map.rows=map.rows.map(r=>r.replaceAll('路','沙'));expect(game.validateMap(JSON.stringify(map),scene,p).tiles.沙.name).toBe('沙地');map.entities[0].x=p.x;map.entities[0].y=p.y;expect(()=>game.validateMap(map,scene,p)).toThrow();});
it('reconciles current NPCs and doors after host changes without inventing inventory or resetting geometry',()=>{const scene=sceneFixture(),map=game.baseMap(scene),p=game.positionFor(map);scene.npcs=[{id:'keeper',name:'守灯人'}];scene.exits.push({id:'garden',name:'花园',blocked:false});const next=game.reconcile(map,scene,p);expect(next.rows).toEqual(map.rows);expect(next.entities.some(e=>e.ref==='cheng')).toBe(false);expect(next.entities.some(e=>e.ref==='keeper')).toBe(true);expect(next.entities.some(e=>e.ref==='garden')).toBe(true);expect(next).not.toHaveProperty('bag');expect(next).not.toHaveProperty('flags');});

it('keeps a fixed viewport on larger maps and arrives beside the corresponding return door',()=>{const scene=sceneFixture(),map=game.baseMap(scene);const large=structuredClone(map);large.rows=Array.from({length:25},()=> '路'.repeat(33));large.tiles.路={name:'道路',walkable:true};const view=game.viewport(large,{x:28,y:20,facing:[0,1]});expect(view.width).toBe(17);expect(view.height).toBe(11);expect(view.x).toBeGreaterThan(0);expect(view.y).toBeGreaterThan(0);const exit=map.entities.find(e=>e.kind==='exit')!,p=game.arrival(map,exit.ref);expect(Math.abs(p.x-exit.x)+Math.abs(p.y-exit.y)).toBe(1);});

it('places basic-map exits on boundaries and distributes people over activity zones',()=>{const scene=sceneFixture();scene.npcs.push({id:'keeper',name:'守灯人'},{id:'gardener',name:'小禾'});const map=game.baseMap(scene);expect(new Set(map.entities.filter(e=>e.kind==='npc').map(e=>e.y)).size).toBeGreaterThan(1);for(const door of map.entities.filter(e=>e.kind==='exit'))expect(door.x===0||door.x===map.rows[0].length-1||door.y===0||door.y===map.rows.length-1).toBe(true);});

it('adapts the camera to a constrained panel while keeping glyphs inside square cells',()=>{
 const map=game.baseMap(sceneFixture()),position=game.positionFor(map);
 for(const [width,height,fontSize] of [[220,140,14],[460,260,26],[720,480,18]]) {
  const layout=game.layoutViewport(map,position,{width,height,fontSize});
  expect(layout.view.width*layout.cellSize).toBeLessThanOrEqual(width+.01);
  expect(layout.view.height*layout.cellSize).toBeLessThanOrEqual(height+.01);
  expect(layout.glyphSize).toBeLessThan(layout.cellSize);
  expect(position.x).toBeGreaterThanOrEqual(layout.view.x);expect(position.x).toBeLessThan(layout.view.x+layout.view.width);
  expect(position.y).toBeGreaterThanOrEqual(layout.view.y);expect(position.y).toBeLessThan(layout.view.y+layout.view.height);
 }
 expect(game.layoutViewport(map,position,{width:220,height:140,fontSize:14}).view.width).toBeLessThan(map.rows[0].length);
});
it('honors a larger host font by showing fewer nearby cells instead of squeezing the same full map',()=>{
 const map=game.baseMap(sceneFixture()),position=game.positionFor(map);
 const small=game.layoutViewport(map,position,{width:640,height:440,fontSize:14}),large=game.layoutViewport(map,position,{width:640,height:440,fontSize:26});
 expect(large.glyphSize).toBeGreaterThan(small.glyphSize);expect(large.view.width).toBeLessThan(small.view.width);
});
