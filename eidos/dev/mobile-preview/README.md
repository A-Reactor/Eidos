# 手机界面离线预览

运行 `node node_modules/vite/bin/vite.js --config dev/mobile-preview/vite.config.mjs`，打开 `http://127.0.0.1:3034/`。使用独立端口和固定模型响应，不读取玩家存档、不发送真实模型请求。展示实际组件，浏览器视口可切换至 320×568、390×844、430×932、768×1024 和桌面尺寸。

- `?case=reading`：逐段阅读、抽屉与行动输入。
- `?case=long`：长正文和 33 段的节点。
- `?hud=1`：玩法状态带。
- `?mod=inherit&hud=1`：附加模组与原文上下排布。
- `?mod=replace`：模组接管阅读舞台。
- `?theme=dark`：暗色主题。
- `?page=settings&hud=1`：本体与已加载模组的分组设置。
- `?page=world_line_view`：世界线、原文和触控分隔条。
- `?page=world_select` / `world_create` / `identity` / `npc_dossiers` / `inventory` / `map` / `title`：对应子页面。

缩小浏览器高度可检查键盘占用空间后的布局；键盘自身、输入法与安全区仍需要手机真机验收。
