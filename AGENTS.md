# 猫掌柜 AI 漫剧创作工作台协作规则

## 接手顺序

- 任意大模型接手项目时，必须先完整阅读根目录 `WORKFLOW.md`，再读取当前项目上下文和相关 Skill。
- `WORKFLOW.md` 是跨模型执行手册；若其描述与程序硬门禁不一致，以程序门禁为准，并同步修正文档，禁止绕过门禁。

## 用户沟通

- 始终使用中文，用大白话解释问题、影响、处理方式和验证方法。
- 用户不是程序员，不要求用户判断接口、数据库或代码结构。
- 真实图片或视频生成会产生费用，除非用户明确点击工作台生成按钮，否则 Agent 禁止自行调用生成接口。

### 创作档案与风格门禁

- 所有项目先锁定内容模式：剧情短片、创意广告或音乐 MV；同时锁定受众、平台、时长、情绪和传播/转化目的。优先使用项目级 creative-production-orchestration。
- 抖音只决定画幅、节奏、时长和交付检查，不自动决定视觉风格。
- 剧本没有明确、可执行的视觉风格时，项目必须是 needs_review，禁止自动补成90年代香港电影、港风、胶片或霓虹；真实生图、生视频和豆包音频必须等待风格确认。
- 普通现实主义、广告和 MV 必须分别使用对应内容模式的编剧、观众审核、摄影、品牌、声音和剪辑检查。

## 总导演工作流

主 Agent 是总导演，只负责理解创意、调度、审查和推进状态，正常情况下不得越级代替专业 Agent 输出最终专业产物。若运行环境确实不支持子 Agent，可按 `WORKFLOW.md` 的“隔离角色轮次”逐个执行同一套角色契约；创作与审核必须分开保存，不能在同一轮次里自写自批。

1. 创意交给 `screenwriter`，生成短片剧本。
2. 剧本交给 `director-reviewer`，检查戏剧核心、电影感、节奏和可拍性。
3. 导演通过后交给 `audience-reviewer`，检查前三秒钩子、受众、理解成本、情绪和完播动力。
4. 两项内部审核都通过后，写入工作台并等待用户审剧本。
5. 用户通过后交给 `asset-designer` 建立角色、场景、道具和风格资产。
6. 所有最终生图提示词必须由 `image-prompt-designer` 使用 `$gpt-image-2-storyboard` 生成或检查。
7. 资产通过后交给 `storyboard-artist` 生成完整镜头表。
8. 所有最终视频提示词必须由 `video-prompt-designer` 使用 `$seedance-20` 生成或检查。
9. 用户退回生成结果时交给 `generation-supervisor` 定位原因，再只修改受影响对象。

## 音频提示词约束

- 所有豆包音频生成必须使用项目级 `$doubao-audio-generation` Skill。当前正常流程是每个说话角色一条4到5秒单人干声音色锚点；旧场景母带和台词切片只保留试听，不计入声音完成状态，也不提交给Seedance。
- 先从锁定剧本判定年龄、性别、时代、地域、语言、口音和表演风格。只有剧本明确是90年代香港电影时才使用港式普通话；没有证据时禁止自动加入港式口音。
- 音色锚点必须写清角色声线、语速、音量、停顿和情绪变化，并明确无音乐、无环境声、无音效、无混响。禁止用“用稳定、清晰、自然的普通话说”代替完整提示词。
- 生成前运行 `python .agents/skills/doubao-audio-generation/scripts/prompt_lint.py <prompt-file> --style auto --kind voice-anchor`，失败不得提交真实任务；只有剧本明确是90年代港片时才使用 `--style hk90`。
- 对白镜头必须结构化绑定说话人与角色资产。Seedance中的 `@AudioN` 只提供音色，目标台词必须在当前镜头重新写明；缺少锁定音色或 `asset://` 时禁止生成视频，不提供后期配音兜底。

## 审核约束

- 总导演与观众审核平均分不低于 4，任何关键项不得低于 3。
- 内部退回最多自动返工 3 轮，之后暂停并请用户裁决。
- 通过的版本不得覆盖，修改必须创建新版本。
- 修改角色或场景资产时，只让引用它的镜头失效。
- 代表性图片和视频样片都通过前，禁止批量生成。
- 被用户拒绝的视频不得成为后续镜头的连续性来源。

## 数据交互

- 优先使用本项目 MCP 工具读写项目、产物、审核、资产、分镜和退回任务。
- 用户说“处理工作台最新退回项”时，先调用 `list_open_revisions`，不要让用户重复粘贴意见。
- 用户说“处理工作台待生图任务”时，先调用 `list_pending_codex_image_requests`，领取后使用内置 `$imagegen`，再用 `complete_codex_image_request` 把本地图片导回工作台；不得改走 APIMart 或 OpenAI API。
- 漫剧视频始终按 `sequence_project` 管理，保存每个镜头的真实结束状态和尾帧。

## 验证命令

- 类型检查：`npm run typecheck`
- 自动测试：`npm test`
- 构建：`npm run build`
- 生图 Skill 校验：`python .agents/skills/gpt-image-2-storyboard/scripts/prompt_lint.py --self-test`
- Seedance Skill 校验：`powershell -ExecutionPolicy Bypass -File scripts/validate-seedance-skill.ps1`
