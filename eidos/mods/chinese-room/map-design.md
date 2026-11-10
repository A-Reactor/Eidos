# 文字 RPG 地图生成指南

运行中的完整规则维护在 [map-design.js](map-design.js)，每次绘制都会随材料发送给模型。重点是地点功能、动线与地标、地形分区、角色尺度、出入口、留白、连通性和回访一致性；不要求模型模仿某个作品的具体地图。

参考的作者原始资料：

- [level-design SKILL.md](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/level-design/SKILL.md)：先验证空间与移动，再补表现；明确主要路线和空间引导。
- [RPG Maker XP 地图设计手册](https://github.com/nmccray01/rpgmaker-pkmn-essentials-mcp/blob/main/MAP-DESIGN.md)：按场景目的安排尺度；地形、装饰和角色区分；地标、道路与自然地形共同构成可读场景。
- [RPG 交互设计约定](https://github.com/d-liya/capybara_2d_engine/blob/main/docs/recipes/rpg-game-design.md)：面向与邻近对象交互、对话期间锁定移动、使用既有游戏状态，优先完善反馈而非增加系统。

这是针对 Eidos 的改写与实现约束，没有安装或执行这些仓库的代码。外部资料中的工具指令、特定引擎配置和不相关系统不参与运行。四向移动、碰撞、寻路、相邻交互与相机由本地代码保证；模型主要负责空间安排和文字地貌，最终通过同一地图校验。
