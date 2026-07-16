# 外部方法登记

本文件只记录方法来源和本地改写边界，不复制外部代码或长段提示词。

- ViMax（MIT）：吸收剧本理解、场景边界、镜头计划、资产索引和首帧—动作—尾帧结构。
- Jellyfish（Apache-2.0）：吸收候选资产确认、镜头准备状态、实体复用和 readiness 状态。
- Hermes role archetypes：吸收导演、编剧、摄影、分镜、剪辑、声音、审核等条件式角色边界。
- claude-youtube（MIT）：吸收钩子、留存、受众理解和质量门禁；不伪造平台数据。
- VibeFrame（MIT）：吸收 dry-run、成本闸门、机器可读审查、next actions、safe-to-run 和责任方修复。
- 火宝短剧 Skills：只吸收中文剧本、角色/场景提取和分镜字段设计；许可证不明，不复制代码。
- ClipForge（AGPL）：只参考抖音钩子、CTA、A/B和效果回流，不导入代码。

适配要求：任何新增外部方法都要在 docs/external-sources.md 登记来源、许可证、吸收内容、项目适配和回归测试；通过后才可进入本地流程。
