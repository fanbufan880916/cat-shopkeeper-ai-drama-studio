# 猫掌柜 AI 漫剧创作工作台

一个面向剧情短片、创意广告和音乐 MV 的本地 AI 影视生产工作台。它把创作档案、剧本双重审核、角色/场景/道具资产、分镜、首帧、Seedance 视频、豆包声音、样片门禁、批量生产和最终验收组织成可追踪的十二阶段流程。

## 核心特点

- 14 个专业 Agent 各司其职，总导演只负责调度、版本和门禁。
- 4 个项目级 Skill 管理总导演编排、GPT-Image-2、Seedance 2.0 和豆包音频提示词。
- 所有剧本、资产方案和分镜都保存新版本，不覆盖已通过版本。
- 角色资产图强制 3:2 左脸部特写 + 右正/侧/背全身三视图。
- 连续镜头使用已通过视频的真实尾帧和真实结束状态，不使用被拒绝结果。
- APIMart、火山豆包和 Codex 生图通道互相隔离，避免重复生成和重复费用。
- API Key 只保存在每位用户本机，使用 Windows 当前用户 DPAPI 加密。
- 首次打开提供可跳过、可随时重看的新人指引。
- 右上角可检查 GitHub 更新；只有本地源码无未提交修改时才允许安全拉取和构建。

## 安装要求

- Windows 10/11
- [Git](https://git-scm.com/)（工作台内一键更新需要）
- [Node.js](https://nodejs.org/) 22 或更高版本，推荐 24
- [FFmpeg](https://ffmpeg.org/)（音频切片、视频尾帧和成片预览需要）
- Codex Desktop 或支持本项目 Agent/MCP/Skill 的兼容 AI 工具

## 第一次安装

1. 推荐使用 Git clone 获取本仓库；这样后续可以直接在工作台右上角检查更新。下载 ZIP 也能安装，但不能使用一键更新。
2. 双击 `安装工作台.cmd`。
3. 安装完成后，在 Codex 中打开本项目目录。
4. 新开对话时先使用 `工作台全流程提示词模板.md` 的“模板 01”。
5. 双击 `启动工作台.cmd`，浏览器打开 `http://127.0.0.1:4310`。
6. 首次打开按“新人指引”认识项目创建、阶段门禁、费用确认和更新方式。

安装脚本会根据当前目录自动生成本机 `.codex/config.toml`。这个文件不会进入 Git，也不包含 API Key。

## 工作台更新

点击页面右上角“检查更新”：

1. 工作台先检查当前 GitHub 跟踪分支。
2. 如果发现远端更新且本地源码没有未提交修改，可以点击“立即更新”。
3. 工作台使用 `git pull --ff-only` 拉取，必要时安装依赖，并重新构建网页。
4. 更新完成后，关闭页面并重新双击 `启动工作台.cmd`。

更新不会处理 `.data`、媒体、备份或 API Key。若本地和 GitHub 都有不同修改，工作台会停止自动更新，避免覆盖文件。

## API 与费用

公开仓库不包含发布者的 API Key、项目、图片、视频或音频。

- 无 API Key：可使用项目管理、剧本、审核和部分 Mock 流程。
- Codex 图片通道：使用用户自己的 Codex 账号和额度。
- APIMart 图片/视频：用户在“API 设置”填写自己的 APIMart Key，并亲自点击生成。
- 豆包音频：用户填写自己的火山引擎 Key，并亲自点击生成。

真实生成始终由工作台按钮触发；MCP 不提供绕过人工确认的付费生成工具。

## 工作流文档

- `WORKFLOW.md`：跨模型执行协议和十二阶段状态机。
- `AGENTS.md`：项目协作、Agent 调度和审核底线。
- `工作台全流程提示词模板.md`：从新开对话到最终交付的可复制提示词。
- `docs/external-sources.md`：外部方法、许可证和本地验证登记。
- `docs/public-release.md`：公开发布和密钥隔离说明。

## 常用命令

```powershell
npm run typecheck
npm test
npm run build
npm run validate:skills
npm run audit:release
```

更新 Seedance 上游 Skill 时，显式指定本地上游仓库：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-seedance-skill.ps1 -Source C:\path\to\seedance-2.0
```

## 本地数据与备份

- `.data/`：数据库、生成媒体、上传素材和本机加密 API Key。
- `.backups/`：通过 `备份项目.cmd` 创建的本地数据备份。
- 上述目录都不会进入 GitHub。

备份 ZIP 可能包含本机加密 API Key，只用于自己恢复，不能作为公开分享包。

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)：可免费用于非商业目的，不允许未经授权的商业使用、收费托管或销售。它是“源码公开、非商业授权”，不是 OSI 定义的开源许可证。完整版权声明见 [NOTICE.md](NOTICE.md)。

Vendored 的 Seedance Skill 保留其原始 MIT 许可证和来源登记；其他单独标明许可证的第三方组件继续适用各自的原始许可证。
