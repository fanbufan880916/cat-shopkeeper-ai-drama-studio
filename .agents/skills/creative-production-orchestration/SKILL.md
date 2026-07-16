---
name: creative-production-orchestration
description: Orchestrate cinematic short films, creative ads, and music videos for Douyin by locking content mode, audience, platform, duration, purpose, and visual style before production. Use when directing a project, routing screenplay/storyboard/asset/audio/editing work, reviewing samples, or diagnosing a generation failure.
---

# 影视创作总导演

把这个 Skill 当作项目的导演台账和流程闸门。先建立创作档案，再调度专业 Agent；总导演负责意图、顺序、版本、审查和风险，不越级代替编剧、摄影、分镜或提示词 Agent。

## 工作顺序

1. 从 brief 锁定内容模式：short_film、ad 或 mv；同时记录受众、平台、时长、情绪和传播/转化目的。
2. 读取最新已确认剧本，提取故事目标、场景、镜头事件、角色、道具、声音和风格证据。不要把项目名称、旧资产名称或历史版本当成风格证据。
3. 若剧本没有明确、可执行的视觉风格，将档案标为 needs_review，暂停所有真实图片/视频生成，要求导演或用户补充风格名称、光线、色彩、镜头、材质与时代依据。
4. 依次调度：编剧 → 导演审核 → 观众审核 → 风格锁定 → 资产设计 → 摄影/分镜 → 代表性首帧 → 代表性视频 → 用户确认 → 批量生产 → 剪辑/声音/字幕/平台交付。
5. 每次修改建立新版本；只让引用被修改资产的镜头失效。被拒绝的图片/视频和未确认尾帧不能成为后续连续性来源。
6. 真实生成必须等待用户明确点击或领取任务。样片未通过前不得批量生成。

## 内容模式分流

读取 references/content-modes.md，按照内容模式切换剧本结构、观众审核、镜头节奏、品牌检查和交付版本。抖音是发布平台，不是固定视觉风格；竖屏、前三秒和节奏约束不能替代美术方向。

## Agent 边界

读取 references/agent-role-contracts.md。每个任务只由责任 Agent 产出对应专业结果；总导演负责把输入、审核意见、锁定状态和下一步交接清楚。

## 外部方法吸收

读取 references/external-methods.md。外部仓库只吸收方法，不复制完整工作台、未确认许可证代码或大段提示词。进入本项目前必须记录来源、许可证、吸收内容、适配方式和回归测试。

## 交付前检查

- 创作档案已锁定内容模式、受众、平台、时长、目的和视觉风格。
- 普通现实主义剧本没有被自动追加港风、胶片、霓虹或港式普通话。
- 导演审核与观众审核达到项目门槛；广告有品牌/卖点/CTA检查，MV有音乐同步/情绪沉浸检查。
- 代表性首帧和视频均有用户确认；连续镜头使用实际通过尾帧和实际结束状态。
- 生成提示词已经交给对应的图像或视频 Skill 检查，音频提示词已通过项目级 lint。
