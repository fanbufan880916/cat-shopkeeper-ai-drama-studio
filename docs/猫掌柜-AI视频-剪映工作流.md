# 猫掌柜 AI 视频创作与剪映工作流

## 工作边界

Codex 负责创意、故事、剧本、分镜、提示词、审核和剪辑方案；工作台负责保存已经通过审核的首帧、视频、尾帧和声音素材；本地剪映 CLI 负责生产成片；FFmpeg 只用于尾帧、检查和低成本预览。

生产成片不会静默改用 FFmpeg。剪映 CLI 未配置、路径不可用或命令模板失败时，任务会停在剪辑阶段并返回真实错误。

## 阶段

```text
batch_generation
  -> edit_prepare
  -> edit_render
  -> final_review
  -> completed
```

只有全部镜头视频通过审核后，才能生成剪辑清单。被拒绝的视频不能进入清单，也不能作为后续镜头连续性的依据。

## Codex/MCP 操作

- `prepare_edit_manifest`：生成 `edit-plan-vXX.md` 和 `edit-manifest-vXX.json`，不导出。
- `configure_jianying`：配置剪映 CLI 路径、项目目录和适配器命令模板。
- `check_jianying_cli`：检查剪映 CLI 是否可用。
- `run_jianying_edit`：明确确认后调用剪映导出。
- `get_jianying_edit_status`：查询任务状态、命令输出和错误。
- `inspect_edit_output`：执行技术质检。
- `approve_final_edit` / `reject_final_edit`：记录用户最终审核。

## 目录和版本

每个本地项目的交付目录在项目根目录 `delivery/<项目ID>/`：

```text
video/
audio/
images/
frames/
export/
edit-plan-v01.md
edit-manifest-v01.json
```

已导出的成片不会覆盖。退回后重新生成 `v02`、`v03` 等新版本，旧版本和质检记录保留。

## 剪映适配器

适配器位于 `scripts/jianying-adapter.ps1`。业务代码只使用 `check`、`create-project`、`import-media`、`write-timeline`、`render` 等统一操作名；真实 CLI 参数通过 `configure_jianying.commandTemplates` 配置。

命令模板是字符串数组，例如：

```json
{
  "render": ["{executable}", "render", "--manifest", "{manifest}", "--output", "{output}"]
}
```

实际剪映 CLI 的参数格式尚未在当前机器上发现，因此不能预填一个可能错误的命令。配置完成前，检查会明确报告“剪映 CLI 不可用”，不会假装成功。

## 最终质检

自动检查输出文件、分辨率、9:16 画幅、时长、音轨、字幕安全区和文件大小，并记录检查结果。黑帧、空音频和内容完整性仍会给出可追踪的质检信息；通过技术质检后，必须由用户人工确认最终成片。
