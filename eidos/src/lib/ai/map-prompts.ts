/** Shared by original and source-based world creation so their map contracts cannot drift. */
export const MAP_CREATION_GUIDE = `
## 地图约定
- regions 与各区域的 scenes 必须是对象，不是数组。区域对象需要 scenes 字段，不要把地点直接混入区域属性。ID 只能使用字母、数字、下划线或连字符，长度 1–100；不要使用空格、斜杠、句点或占位 ID。
- regions 每个区域提供 name（玩家可读的区域名称）。区域/地点 ID 全世界唯一、固定，不用展示名称代替 ID；对象键与 id 一致，scene.region 为所属区域 ID。
- connections 只填确实存在的地点 ID，不填文字说明或自身 ID。普通双向道路必须在两端填写；单向道路只写出发端，场景描述说明原因。保证起始可玩区域连通，不为连通强行违背资料事实。
- 可选顶层 mapRoutes 数组：[{"from":"地点ID","to":"地点ID","status":"hidden"}]。status 只有 open/blocked/hidden；覆盖同方向 connections。封闭和隐藏通路每个方向分别列出，普通开放通路无需重复填写。
- 秘密通路用 hidden，已知但暂时不可走的用 blocked。不要把秘密通道当作普通 connections 暴露。未知地理保留未知，不把传闻当作事实，不生成坐标、距离等无依据数据。
`;

export const MAP_ACTION_GUIDE = `
## 地图更新（mapUpdates，可省略）
只在本轮叙事已确认新的地点认知或通行变化时输出，不要求每轮更新：
"mapUpdates": {
  "places": [{"id":"已有或新地点ID","note":"玩家可知的简短现状；有用的提醒或明确标注的传闻"}],
  "routes": [{"from":"地点ID","to":"地点ID","status":"open","bidirectional":true}]
}
- places：已有地点仅改 note；新增地点另外给 name 和 regionId（必须是已有区域 ID）。ID 稳定，不为同一地点重复建点。单轮至多 12 个地点、24 条通路。
- note 是整条替换，不是追加日志，最多 400 字；保留仍有效的重要提醒，过时信息删除，空字符串清除。只写玩家已经获知的信息，不能透露秘密、未读剧情、后台推演。新增备注意味着玩家知道该地点。
- 传闻、危险原因、开放条件、待调查线索都用 note 表达，不增加细碎字段。不把可能性写成事实，听闻密道只备注，不立即开放通路。
- routes 的 status 只有 open（开放）、blocked（已封闭但地图保留）、hidden（尚未知的通路）。已经公开的通路不能改回 hidden；受阻使用 blocked。普通道路 bidirectional:true；确为单向才 false。只更新本轮有因果依据的通路，不能为了让玩家到达而任意接路。
- 新地点默认没有道路，发现真实通路时才输出 routes。仅发现地点或写备注不代表玩家已经到达，sceneChanges 仍为 []。
- 当轮发现通路并实际通过，可先输出地图更新，再在 sceneChanges 填目标 ID。封闭或隐藏路线必须先经剧情证实开放才能通过。
- 无变化省略 mapUpdates。不要输出全地图，不删除已有地点，不改名，不替玩家探索。
`;
