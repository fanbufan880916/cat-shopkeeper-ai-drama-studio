export type AudioPromptLine = { speaker: string; text: string };

export type AudioStyleProfile = "hk90" | "modern_realistic" | "documentary" | "animation" | "custom" | "needs_review";

export const audioStyleLabels: Record<AudioStyleProfile, string> = {
  hk90: "90年代香港电影·港式普通话",
  modern_realistic: "现代写实·按剧本口音",
  documentary: "纪录片/新闻·克制旁白",
  animation: "动画漫剧·角色化表演",
  custom: "剧本自定义声音风格",
  needs_review: "待导演确认声音风格"
};

/** Infer a conservative sound profile from the locked script, never from the product name alone. */
export function inferAudioStyleProfile(script: string): AudioStyleProfile {
  const text = script.trim();
  if (/(?:(?:90年代|九十年代|九零年代)[^。\n]{0,20}(?:香港电影|港片|港风|香港市井电影)|(?:香港电影|港片|港风|香港市井电影)[^。\n]{0,20}(?:90年代|九十年代|九零年代))/.test(text)) return "hk90";
  if (/(纪录片|新闻播报|采访|专题片|旁白解说)/.test(text)) return "documentary";
  if (/(动漫|漫剧|动画|二次元|卡通|拟人)/.test(text)) return "animation";
  if (/(自定义音色|特殊口音|方言|粤语|英语|日语|韩语)/.test(text)) return "custom";
  if (/(现代|当代|写实|现实主义|自然对白)/.test(text)) return "modern_realistic";
  return "needs_review";
}

function speechAnchor(style: AudioStyleProfile) {
  if (style === "hk90") return "港式普通话";
  if (style === "documentary") return "标准普通话，克制清晰，不带播音腔夸张起伏";
  if (style === "animation") return "角色化普通话，咬字清楚，允许夸张但不失真";
  if (style === "custom") return "按照锁定剧本指定的语言、方言和口音，不自行替换";
  if (style === "needs_review") return "声音风格待导演确认，不自行添加口音或时代滤镜";
  return "符合剧本设定的自然普通话或指定口音，不使用网红腔";
}

function voiceAnchor(speaker: string, index: number, style: AudioStyleProfile) {
  const name = speaker.trim() || `人物${index + 1}`;
  const speech = speechAnchor(style);
  if (/猫掌柜/.test(name)) return `${name}是成年男性拟人猫掌柜，${speech}，声线中低、略带沙哑，语气冷淡又市井，平时慢半拍，吐槽和反转时突然加快，句尾收得利落`;
  if (/女|阿姨|老板娘|警|太后|婆/.test(name)) return `${name}是成年女性，${speech}，声线清亮带一点沙哑，咬字利落，情绪上来时音量和语速一起提高，但不能像播音员`;
  if (index % 3 === 1) return `${name}是中年男性，${speech}，声线低沉、略带沙哑，语气稳重克制，偶尔露出不耐烦`;
  return `${name}是中青年男性，${speech}，声线偏低、带一点鼻音和磁性，语气成熟，喜剧反应时短促、夸张但不失真`;
}

function performanceDirection(speaker: string, text: string, index: number, style: AudioStyleProfile) {
  const punctuation = text.trim().slice(-1);
  const speech = speechAnchor(style);
  if (/[？！!]/.test(punctuation)) return `${speaker}用${speech}，语速突然加快，情绪失控但吐字清楚地喊道`;
  if (index % 3 === 0) return `${speaker}用${speech}，压低声音，带着不耐烦和一本正经的荒诞感说道`;
  if (index % 3 === 1) return `${speaker}用${speech}，语气平稳，尾音略微上扬，像在解释一件荒唐但理所当然的事说道`;
  return `${speaker}用${speech}，先停顿半拍，再用克制的语气回应说道`;
}

function soundDirection(style: AudioStyleProfile, styleNotes = "") {
  if (style === "hk90") return `先是雨夜街道的远处车声、店内电风扇和轻微的霓虹电流声。音乐以低音贝斯、合成器 pad 和少量铜管切分为主，喜剧对白出现时音乐压低，让人物的停顿、呼吸和突然的语气反转清楚可听；不要播音腔，不要网红腔，不要温柔广告腔，不要机械逐字朗读。整体是 90 年代香港市井电影的配音质感，人物说港式普通话，节奏有停顿，情绪夸张但保持真实。`;
  if (style === "documentary") return `先保留现场空间的低噪、远处环境声和必要的设备声。音乐只用低存在感的铺底，旁白或对白出现时音乐明显压低，保持信息清楚、停顿自然、情绪克制；不要戏剧化配音，不要广告腔。`;
  if (style === "animation") return `先建立与画面动作对应的环境声、脚步、衣物摩擦和关键拟音。音乐使用能衬托角色动作的节奏型配器，对白出现时音乐让位，保留角色呼吸、停顿和反应声；允许喜剧化变调，但不能连续尖叫或机械朗读。`;
  if (style === "custom") return `先按照锁定剧本写明的时代、地域、语言和人物关系建立环境声。音乐、对白和音效按剧本顺序进入；对白出现时降低音乐，保留停顿、呼吸和动作反应。补充风格要求：${styleNotes || "严格遵守剧本中的声音设定，不自行添加口音或时代滤镜"}。`;
  if (style === "needs_review") return "声音风格尚未在锁定剧本中明确。此提示词只能用于导演检查，不能提交生成；请先补充时代、地域、语言、口音和表演方式。";
  return `先建立剧本指定地点的真实环境声、脚步、衣物摩擦和必要的动作音效。音乐使用克制的铺底或剧本指定的配器，对白出现时音乐压低，保留自然停顿、呼吸和情绪变化；不要播音腔、网红腔或机械逐字朗读。`;
}

/** Build the plain-text format used by the official Doubao audio console. */
export function buildAudioPrompt(lines: AudioPromptLine[], options: { style?: AudioStyleProfile; styleNotes?: string } = {}) {
  const style = options.style ?? "modern_realistic";
  const valid = lines.filter((line) => line.text.trim());
  const speakers = [...new Set(valid.map((line) => line.speaker.trim()).filter(Boolean))];
  const characterBlock = (speakers.length ? speakers : ["人物1"]).map((speaker, index) => `${voiceAnchor(speaker, index, style)}。`).join("\n");
  const dialogueBlock = valid.map((line, index) => `${performanceDirection(line.speaker.trim() || "人物", line.text.trim(), index, style)}：“${line.text.trim()}”`).join("\n");
  return `${characterBlock}\n\n${soundDirection(style, options.styleNotes)}\n\n${dialogueBlock}`;
}

/** Backward-compatible helper for the current Hong Kong short film. */
export function buildHongKongAudioPrompt(lines: AudioPromptLine[]) {
  return buildAudioPrompt(lines, { style: "hk90" });
}

/** Validate the official plain-text structure before a paid generation request. */
export function validateAudioPrompt(prompt: string, style: AudioStyleProfile | "auto" = "auto") {
  const errors: string[] = [];
  const text = prompt.trim();
  if (!text) errors.push("提示词不能为空。");
  if (!/(?:是|为).*(?:男|女|声线|音色|普通话|粤语|英语|方言|口音)/.test(text)) errors.push("缺少角色声线、语言或口音清单。");
  if (!/(音乐|环境|音效|声音|脚步|电话|呼吸|碰撞|雨声|鼓点|贝斯|合成器)/.test(text)) errors.push("缺少声音环境、音乐或音效设计。");
  if (!/[“\"‘'].+[”\"’']/.test(text)) errors.push("对白必须使用引号，并明确写出完整台词。");
  if (!/(停顿|语速|音量|声线|尾音|情绪|咬字|低声|高声|加快|放慢)/.test(text)) errors.push("缺少具体的语速、音量、停顿或情绪表演指令。");
  if (style === "hk90" && !/(港式普通话|香港普通话)/.test(text)) errors.push("当前剧本判定为90年代香港电影，必须明确写出港式普通话。");
  if (style === "needs_review") errors.push("锁定剧本没有明确声音风格，不能提交音频生成；请先补充语言、口音、时代和表演方式。");
  if (style !== "hk90" && style !== "auto" && !/(普通话|粤语|英语|日语|韩语|方言|口音|语言)/.test(text)) errors.push("当前声音风格需要明确语言或口音设定。");
  if (text.includes("用稳定、清晰、自然的普通话说") || text.includes("自然地说")) errors.push("不能用泛化的‘自然地说’替代官方模板结构。");
  if (/(模仿.*周星驰|模仿.*刘德华|模仿.*梁朝伟|复制.*演员|电影原声)/.test(text)) errors.push("不能要求复制具体演员或电影原声。");
  return errors;
}

export function validateHongKongAudioPrompt(prompt: string) {
  return validateAudioPrompt(prompt, "hk90");
}
