Object.assign(Palimpsest, {
  generationTask: '按所给示例协议写一份完整可玩原创 Meta 短篇，只返回 JSON。format=eidos-stage-script,version=1，3–18节点、全部可达、无环，所有路线最终到带ending的结局。每节点包含id/title/lines/cues/choices。lines为1–8个{id,text,speaker?}；cues为0–12个{kind,target,text?}，kind只许replace/erase/aside/fracture/mask/color/size/garble/relabel，relabel的target为本页选择ID，其余为本页行ID；replace/aside/relabel须有text，color的text只许accent/muted/ink/blood，size的text只许small/large/huge。choices为1–4个{id,label,to}，结局choices=[]且ending为短ID。所有ID唯一、引用必须存在。text最多500字，label最多100字，整份JSON最多14000字符。正常世界与人物在先，文字异常要有剧情依据，不搭建虚构剧场来解释Meta机制；克制安排文字变化，按钮只改显示，结算仍保留原义；不要模仿系统报错、权限请求或操作未授权真实文件，不输出HTML/CSS/脚本。',
  generationMaterial(theme, requestId) { return JSON.stringify({ theme: String(theme).slice(0, 160), requestId, example: Palimpsest.sample() }); },
});
