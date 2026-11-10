# 贡献与反馈

[English](CONTRIBUTING.en.md)

普通问题可提 Issue。请说明版本或提交、操作系统、Node.js 版本、预期结果和复现步骤。离线示例能复现时，优先提供对应命令。分享日志或存档前请移除密钥与个人资料。安全问题请通过 [私下报告流程](SECURITY.md#报告安全问题) 提交。

维护者通常每周集中查看一次 Issue、PR 和安全报告。

## 在本机验证

```bash
cd eidos
npm ci
npm run lint
npm test
npm run build
npm run demo:engine-game
```

## 构建公开源码包

在工作区干净的 Git 检出中，从 `eidos` 运行 `npm run pack:open-source`。命令以当前提交为输入，按根目录 `.gitattributes` 导出到 `eidos/build/open-source/eidos-source.tar.gz`，并生成相邻的 `.sha256` 文件。需要检查源码时，将压缩包解压到独立目录再安装依赖。

## 构建便携玩家包

在干净的检出中，从 `eidos` 运行 `npm run pack:player`。请在目标平台上构建。Apple 芯片 Mac 需要 Xcode 命令行工具，64 位 Windows 使用系统自带的 `curl` 和 `tar`。命令从公开源码重新构建应用，校验随包分发的 Node.js，最后重新解压 ZIP 验证启动和图片上传。生成的 ZIP 和校验文件在 `eidos/build/player/`。也可以在 GitHub Actions 手动运行 **Player bundles**，从对应任务的产物下载并将 ZIP 添加到 Release 附件。Mac 预览包使用本地签名，对公众分发时可用 Developer ID 签名并提交 Apple 公证。
