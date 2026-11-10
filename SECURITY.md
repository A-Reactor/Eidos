# 安全与数据

[English](SECURITY.en.md)

## 报告安全问题

请通过公开仓库的 Security → Advisories → Report a vulnerability 私下报告，并附版本、复现步骤和影响范围。若该入口尚未启用，请在 Issue 中仅请求私下联系渠道。公开 Issue、截图和复现文件都应去除密钥、存档及个人信息。 [GitHub 私下报告说明](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)

维护者通常每周集中查看一次报告。首次回复可能等到下一次集中处理，修复时间视影响和可复现情况而定。

## 本地使用

Web 应用的启动脚本默认仅绑定 `127.0.0.1`。应用 API 可操作本地图片、文件及语音服务，请在本机使用。通过网络给其他游戏服务接入时，只转发启用 Bearer token 的 `/api/engine/v1/narrate`，令牌保存在可信服务端。 [开发者 HTTP 接入](eidos/docs/developer-engine.md#http-协议-v1)

世界模组的界面在隔离 iframe 中运行，应用级全局插件有更广的浏览器权限。全局插件请先核对来源和代码，再启用。Tauri 的原生权限会在正式桌面发布前单独验证。 [全局插件说明](eidos/docs/global-plugins.md#插件包)

密钥存放、模型请求和导出数据范围见 [数据与密钥](eidos/docs/ai-configuration.md#数据与密钥)。
