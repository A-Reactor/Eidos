import { useGameStore } from '@/store/game-store';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { seedHistoryBranch } from './history-branch';
import update from './plugin-upgrade.json';

/** Real CAS/tree persistence with a small local upgrade file and no model calls. */
export async function seedPluginUpgrade() {
 const state=useGameStore.getState();
 const old={...update,release:'1.0',stateVersion:1,migrations:[]};
 useGameStore.setState({currentWorld:{...state.currentWorld!,gameplayPlugins:parsePluginFile(old)},
  currentPlaythroughId:'history-branch-preview',gameplayModState:{'maintenance-reader':{page:7}}});
 await seedHistoryBranch();
 if(useGameStore.getState().currentPlaythroughId!=='history-branch-preview') return;
 useGameStore.setState({phase:'settings',navigationStack:['playing']});
}
