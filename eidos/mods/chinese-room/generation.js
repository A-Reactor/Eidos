Object.assign(ChineseRoom, {
  generationTask: `为现有 RPG 当前地点绘制一张可走动的文字地图。只返回 JSON，不写故事、不执行行动、不创设另一套世界状态。
格式 {format:"eidos-scene-map",version:1,sceneId:材料当前地点ID,tiles:{单字:{name,walkable:boolean}},rows:[等宽文字地图行],entry:{x,y},entities:[{id,kind:"npc"|"exit"|"object"|"action",ref:宿主已有引用,name,glyph:单字,x,y}]}。
优先 按用途确定尺寸：小房间约 13–19 列、9–13 行；街区或室外可约 21–33 列、13–23 行，相机只显示附近一屏，文字应体现当前地点的空间：室内的门、桌边、走廊；室外的树、河岸、桥、草地等。地形与图标按当前世界自定义，留出足够空白，不要写满字。不采用战斗棋盘、肉鸽路线或节点计数。地形可以单字定义为可走或不可走。
实体 npc 必须引用 scene.npcs[].id，exit 引用 scene.exits[].id，object 引用 scene.objects[].id，action 引用 scene.actions 中一条完整原文。必须包含全部当前人物和出口；物件可选。其他视觉细节用地形表示，不能凭空新增可交互人物、物品、任务或场景。
坐标从零起；实体及入口须在可走格，互不重叠，所有实体可从入口走到相邻格。不把 NPC 当成可穿过的地形。更新已有地图时尽量保留建筑与门的位置，根据新的已读剧情表达环境变化；保留 player 坐标可走且不与实体重叠。阻挡的出口仍可表示，但不能在地图里解锁，宿主会检查是否可通行。
不返回背包、对话选择、物品奖励、任务、事件效果、世界标记等字段；这些由现有主叙事系统处理。地图只是当前主世界的操控画面。`,
  generationMaterial(context, map, player, theme) {
    return JSON.stringify({ scene: context.scene, visibleProse: context.reading?.segments?.map(segment => ({ type: segment.type, speaker: segment.speaker, text: segment.text })).slice(-8), worldName: context.world?.name, player, previousMap: map, designGuide: ChineseRoom.mapDesignGuide, visualStyle: theme || '简洁、留白、和当前场景一致', example: ChineseRoom.baseMap(context.scene) });
  },
});
