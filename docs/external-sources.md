# 外部方法、官方规则与开源来源登记

最后人工核实：2026-07-16。

本项目不以 GitHub Star 数量代替质量判断。可进入生产工作流的方法，至少要回答四件事：来源和许可证是否清楚、是否仍在维护、是否有测试/评测/Schema 等质量证据、进入本项目后由什么回归测试兜底。

## 来源优先级

1. 模型参数、能力边界、请求字段：以模型厂商或接口供应商的官方文档为准。
2. 可复用工作流和 Skill：优先选择许可证清楚、版本可固定、带测试或评测的成熟开源仓库。
3. 角色分工和创作方法：可以吸收多个开源项目的可解释方法，但必须在本地重写，不能复制许可证不明的代码或大段提示词。
4. 社区经验与 Star 数：只作为发现线索，不作为生产规则。

## 直接采用并固定版本

| 本地 Skill | 上游来源 | 版本固定 | 成熟度证据 | 本地验证 |
| --- | --- | --- | --- | --- |
| `seedance-20` | [Emily2040/seedance-2.0](https://github.com/Emily2040/seedance-2.0)，MIT | `v6.6.0`；commit `57d01dc66f93ecb03c2475be5f22dc416d9b701d` | 持续迭代，包含 28 个子 Skill、测试、评测集、Schema、来源登记和 CI 级验证命令 | `scripts/validate-seedance-skill.ps1` 运行上游完整验证套件；`.validated.json` 记录 commit 与内容校验和 |

升级规则：只能通过 `scripts/sync-seedance-skill.ps1` 同步本地镜像；同步后必须跑完整 Skill 校验和项目测试。验证失败时保留旧版本，不得直接进入生产。

## 以官方规则为主的本地 Skill

| 本地 Skill | 权威来源 | 为什么不直接套 GitHub 提示词 | 本地验证 |
| --- | --- | --- | --- |
| `gpt-image-2-storyboard` | [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)、[OpenAI prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image_gen/image_gen_prompting_guide)、APIMart 官方接口文档 | 模型字段和编辑能力会变，民间仓库可能混入其他模型参数；接口正确性优先于社区热度 | Skill 结构检查、提示词正反例自测、角色设定图服务端硬门禁、TypeScript 回归测试 |
| `doubao-audio-generation` | 火山引擎豆包控制台官方纯文本模板结构与当前接口行为 | 声音模板涉及实际模型能力、语言和版权边界，不应照搬演员模仿类社区提示词 | Skill 结构检查、纯文本提示词正反例、港片/普通项目风格分流、提交前服务端 lint |
| `creative-production-orchestration` | 本项目角色契约，加上下列成熟项目的方法交叉验证 | 编排必须贴合本工作台的阶段机、数据库和用户审核点，不能复制其他工作台的流程图 | 14 个 Agent 的 TOML/跨模型检查、MCP 工具注册表检查、WORKFLOW 契约检查 |

## 只吸收方法，不复制代码

| 来源 | 许可证/状态 | 可解释方法 | 本地落点 |
| --- | --- | --- | --- |
| [ViMax](https://github.com/HKUDS/ViMax) | MIT；活跃研究型仓库，含测试 | 剧本理解、场景边界、镜头规划、首帧—动作—尾帧 | 分镜字段、连续镜头状态、Seedance 交接协议 |
| [Jellyfish](https://github.com/Forget-C/Jellyfish) | Apache-2.0；成熟的一站式短剧工作台 | 候选资产确认、镜头准备状态、资产复用 | 资产逐项审核、引用失效、镜头状态门禁 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | MIT；模型无关 Agent 框架 | 条件式专业角色、清晰输入输出契约 | 14 个专业 Agent；总导演只调度和验收 |
| [VibeFrame](https://github.com/vericontext/vibeframe) | MIT；包含测试与 Agent/Skill 结构 | dry-run、成本闸门、机器可读审查、责任对象修复 | 风格门禁、样片先行、生成监督与定向返工 |
| [claude-youtube](https://github.com/AgriciDaniel/claude-youtube) | MIT；Beta，带分层 Skill、参考资料与执行脚本 | 钩子、留存、受众理解、质量门禁 | 观众审核；没有真实平台数据时只标注“创作判断” |
| [火宝短剧](https://github.com/chatfire-AI/huobao-drama) | 许可证未作为本项目依赖确认；不复制代码 | 中文剧本、角色/场景提取、分镜字段 | 只重写字段与方法，接受本地测试约束 |
| [ClipForge](https://github.com/xixihhhh/clipforge) | AGPL；不导入代码 | 抖音钩子、CTA、A/B 和效果回流 | 广告模式的品牌审核、CTA 与复盘字段 |

## 禁止做法

- 不把其他开源工作台整体拷入本项目。
- 不从许可证不明的仓库复制代码、提示词或素材。
- 不因为某仓库 Star 多，就覆盖模型官方字段或本项目审核门禁。
- 不自动引入固定港风、固定供应商或自动付费生成。
- 不在没有 commit/版本、校验和与回归测试的情况下更新已 vendored 的 Skill。

新增来源时，必须补齐：链接、许可证、核实日期、吸收的方法、本地责任对象、验证命令和失败回退方式。
