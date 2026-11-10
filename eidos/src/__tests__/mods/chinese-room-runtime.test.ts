// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {loadModPackage} from '../../../scripts/mod-package.mjs';
import {parsePluginFile} from '@/lib/game/plugins/manifest';
import {useGameStore} from '@/store/game-store';
import {buildRiftCityStartState} from '@/lib/test/fixtures';
import {hashAndStore,loadBlob} from '@/lib/game/cas-storage';
import {loadChineseRoom,sceneFixture} from './chinese-room-fixtures';
afterEach(()=>vi.unstubAllGlobals());
it('ships the same main-world package as the author source without independent adventure systems',async()=>{const packed=JSON.parse(readFileSync('mods/dist/chinese-room.eidos-plugin.json','utf8'));expect(parsePluginFile(packed)).toEqual(parsePluginFile(await loadModPackage('mods/chinese-room')));expect(packed.name).toBe('文字地图与角色扮演');expect(packed.ui.html).toContain('Eidos.world.interact');expect(packed.ui.html).not.toContain('Eidos.gameplay.commit');expect(packed.ui.html).not.toContain('id="stats"');});
it('persists visual maps and positions in the normal snapshot and restores them without changing real inventory',async()=>{vi.stubGlobal('crypto',webcrypto);const{world,snapshot}=buildRiftCityStartState();const plugin=await loadModPackage('mods/chinese-room');useGameStore.setState({...useGameStore.getInitialState(),currentWorld:{...world,gameplayPlugins:parsePluginFile(plugin)}});useGameStore.getState().restoreSnapshot({...snapshot,gameplayModState:undefined});const game=loadChineseRoom(),map=game.baseMap(sceneFixture()),position=game.positionFor(map);const initialInventory=useGameStore.getState().inventory;useGameStore.setState({gameplayModState:{'chinese-room':{maps:{village:{layout:map}},positions:{village:position}}}});const saved=useGameStore.getState().createSnapshot(),hash=await hashAndStore('snapshot',saved);useGameStore.setState({gameplayModState:{'chinese-room':{maps:{},positions:{}}}});useGameStore.getState().restoreSnapshot(await loadBlob(hash) as typeof saved);expect(useGameStore.getState().gameplayModState['chinese-room']).toEqual(saved.gameplayModState!['chinese-room']);expect(useGameStore.getState().inventory).toEqual(initialInventory);});
