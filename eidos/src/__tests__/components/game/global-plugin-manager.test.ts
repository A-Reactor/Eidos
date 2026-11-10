// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { EidosShell } from '@/components/shell/EidosShell';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { useGameStore } from '@/store/game-store';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { getGlobalPluginLibrary, GLOBAL_PLUGIN_LIBRARY_KEY } from '@/lib/game/global-plugins/library';
import { globalPluginRuntime } from '@/lib/game/global-plugins/runtime';
import { downloadFile } from '@/lib/game/export-records';
vi.mock('@/lib/game/export-records', async original => ({...await original<object>(),downloadFile:vi.fn()}));
beforeEach(() => {
  localStorage.clear();localStorage.setItem('eidos_settings',JSON.stringify(DEFAULT_SETTINGS));
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
  useGameStore.setState({phase:'settings',previousPhase:'world_select',navigationStack:['world_select'],currentWorld:{id:'stale-world',name:'上一局',gameplayPlugins:[{format:'eidos-gameplay-plugin',version:1,id:'old-mod',name:'上一局模组',description:'不可显示',tags:[],prompts:{creation:'',action:'',review:''},rules:[]}]} as never});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const show=()=>{render(React.createElement(EidosShell,null,React.createElement(SettingsScreen)));fireEvent.click(screen.getByRole('button',{name:'全局插件'}));};
it('reuses the pre-world settings slot without exposing a stale archive and runs the test plugin only after enabling',async()=>{
 show();expect(screen.queryByRole('button',{name:'上一局模组'})).toBeNull();
 expect(screen.queryByText('当前档案没有加载模组。')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'安装测试插件'}));
 expect(getGlobalPluginLibrary().entries[0].enabled).toBe(false);
 expect(screen.queryByRole('button',{name:'纸页实验室排版'})).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:'启用阅读排版与快捷指令'}));
 expect(screen.queryByRole('button',{name:'纸页实验室排版'})).toBeNull();
 expect(document.querySelector('[data-eidos-global-style]')).toBeNull();
 expect(globalPluginRuntime.transformAction('/环顾',false)).toBe('仔细观察当前环境，留意可见的人物、物品与出入口。');
 const before=useGameStore.getState().createSnapshot();
 fireEvent.click(screen.getByText('设置与详情'));
 expect(screen.queryByText('编辑作者声明')).toBeNull();
 expect(screen.queryByLabelText('上传阅读排版与快捷指令介绍图片')).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:'紧凑阅读排版'}));
 expect(document.querySelector('[data-eidos-global-style]')?.textContent).toContain('line-height: 1.75');
 expect(useGameStore.getState().createSnapshot()).toEqual(before);
 act(()=>useGameStore.setState({phase:'playing'}));
 expect(screen.queryByRole('button',{name:'纸页实验室排版'})).toBeNull();
 expect(document.querySelector('[data-eidos-global-style]')?.textContent).toContain('line-height: 1.75');
 act(()=>useGameStore.setState({phase:'settings',navigationStack:['world_select']}));
 fireEvent.click(screen.getByRole('checkbox',{name:'启用阅读排版与快捷指令'}));
 expect(screen.queryByRole('button',{name:'纸页实验室排版'})).toBeNull();
 expect(document.querySelector('[data-eidos-global-style]')).toBeNull();
 expect(globalPluginRuntime.transformAction('/环顾',false)).toBe('/环顾');
});
it('exports a portable test plugin and shows load errors without executing or erasing a damaged library',async()=>{
 show();fireEvent.click(screen.getByRole('button',{name:'安装测试插件'}));
 fireEvent.click(screen.getByText('设置与详情'));
 fireEvent.click(screen.getByRole('button',{name:'导出阅读排版与快捷指令'}));
 expect(vi.mocked(downloadFile).mock.calls[0][0]).toContain('eidos-global-plugin');
 cleanup();localStorage.setItem(GLOBAL_PLUGIN_LIBRARY_KEY,'broken library');show();
 expect(screen.getByRole('alert').textContent).toContain('原数据已保留');
 expect((screen.getByRole('button',{name:'安装测试插件'}) as HTMLButtonElement).disabled).toBe(true);
 expect(localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY)).toBe('broken library');
});
it('keeps current-world mod controls when settings are opened from a live game',()=>{
 useGameStore.setState({navigationStack:['playing'],previousPhase:'playing'});
 render(React.createElement(EidosShell,null,React.createElement(SettingsScreen)));
 expect(screen.getByRole('button',{name:'模组'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'全局插件'})).toBeNull();
 expect(screen.getByRole('button',{name:'上一局模组'})).toBeTruthy();
});

it('imports a file without executing it until the player enables its script', async()=>{
 show();
 const source=JSON.stringify({format:'eidos-global-plugin',version:1,id:'import-demo',name:'导入示例',release:'1',description:'导入测试',script:"const element=document.createElement('output');element.id='imported-plugin-output';element.textContent='已启用导入示例';api.ui.mount(element);"});
 const file=new File([source],'import-demo.json',{type:'application/json'});
 Object.defineProperty(file,'text',{value:async()=>source});
 fireEvent.change(screen.getByLabelText('全局插件文件'),{target:{files:[file]}});
 const enable=await screen.findByRole('checkbox',{name:'启用导入示例'});
 expect(document.getElementById('imported-plugin-output')).toBeNull();
 fireEvent.click(enable);expect(document.getElementById('imported-plugin-output')?.textContent).toBe('已启用导入示例');
});

it('imports a valid file over the former 2 MB limit without enabling it', async()=>{
 show();
 const source=' '.repeat(2200000)+JSON.stringify({format:'eidos-global-plugin',version:1,id:'large-global',name:'大型全局插件',release:'1',description:'完整包',css:'body{}'});
 const file=new File([source],'large-global.json',{type:'application/json'});Object.defineProperty(file,'text',{value:async()=>source});
 fireEvent.change(screen.getByLabelText('全局插件文件'),{target:{files:[file]}});
 await screen.findByRole('checkbox',{name:'启用大型全局插件'});
 expect(getGlobalPluginLibrary().entries[0].enabled).toBe(false);
});
