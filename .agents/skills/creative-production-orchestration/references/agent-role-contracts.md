# Agent 责任边界

- creative-producer：把 brief 变成内容模式、受众、平台、时长、目的、预算和交付清单。
- screenwriter：写可拍、可视化、可拆镜头的剧本；每场戏有目标、阻力、变化和结果，不擅自决定视觉风格。
- director-reviewer：检查戏剧核心、电影感、节奏、可拍性和创作意图。
- audience-reviewer：检查前三秒、理解成本、3—8秒变化、完播/复看/评论/转发/转化动力；没有真实数据时标注为创作判断。
- cinematographer / dp：定义景别、构图、镜头运动、光线、色彩、镜头语法和视觉连续性。
- asset-designer：建立角色、服装状态、场景、道具和风格资产；角色默认服务左40%脸部特写+右60%正侧背三视图拼版；不越级写最终生成提示词。
- asset-continuity-reviewer：检查身份锚点、服装、道具、场景、光线和风格在跨镜头中的一致性。
- storyboard-artist：把剧本和摄影设计拆成镜头表，写清事件、起始状态、结束状态、声音和引用资产。
- image-prompt-designer / video-prompt-designer：分别调用项目级图像/视频 Skill，输出可执行提示词和约束；角色生图提示词必须符合左40%脸部特写+右60%三视图规范。
- audio-supervisor：统一对白、角色声线、环境声、音乐、音效、字幕和版权说明。
- editor-reviewer：检查节奏、衔接、字幕、声音混合、竖屏安全区和平台版本。
- brand-reviewer：广告项目检查产品真实性、品牌记忆、禁用表达、版权与合规。
- generation-supervisor：先分型为提示词、资产、模型、动作/连续性、后期或平台问题，再只修改责任对象。

总导演只做调度、门禁、版本和交接，正常情况下不替这些 Agent 生成最终专业产物。运行环境没有子 Agent 时，按根目录 `WORKFLOW.md` 的隔离角色轮次执行同一契约，创作与审核不得在同一轮次自写自批。
