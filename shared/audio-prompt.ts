export type AudioPromptLine = {
  speaker: string;
  text: string;
  voiceDirection?: string;
  sceneName?: string;
  sceneSound?: string;
};

export type AudioStyleProfile = "hk90" | "modern_realistic" | "documentary" | "animation" | "custom" | "needs_review";

export type AudioCharacterProfile = {
  name: string;
  role: string;
  traits: string;
  voiceDirection: string;
};

export type AudioPromptContext = {
  style: AudioStyleProfile;
  styleNotes: string;
  characters: AudioCharacterProfile[];
};

type AudioPromptOptions = {
  style?: AudioStyleProfile;
  styleNotes?: string;
  script?: unknown;
  characters?: AudioCharacterProfile[];
};

export const audioStyleLabels: Record<AudioStyleProfile, string> = {
  hk90: "90年代香港电影·港式普通话",
  modern_realistic: "现代写实·标准普通话",
  documentary: "纪录片/新闻·克制旁白",
  animation: "动画漫剧·角色化表演",
  custom: "剧本自定义声音风格",
  needs_review: "待导演确认声音风格"
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("；");
  const object = objectValue(value);
  if (!object) return "";
  return Object.values(object).map(textValue).filter(Boolean).join("；");
}

function audioEvidence(script: unknown) {
  if (typeof script === "string") return script.trim();
  const content = objectValue(script);
  if (!content) return "";
  const visualDirection = objectValue(content.visualDirection);
  // Revision notes and visualStyle are deliberately excluded. Historical visual
  // keywords must never silently become a current voice/accent instruction.
  return [
    content.audioDirection,
    content.soundDirection,
    content.soundStyle,
    content.language,
    content.accent,
    content.region,
    content.era,
    content.productionConstraint,
    visualDirection?.productionConstraint,
    content.format,
    content.setting
  ].map(textValue).filter(Boolean).join("\n");
}

function rejectsHongKongMandarin(text: string) {
  return /(?:不得|禁止|不要|禁用|不使用|不能|无需|取消)[^。；\n]{0,20}(?:港式普通话|香港普通话|港式口音)/.test(text)
    || /(?:港式普通话|香港普通话|港式口音)[^。；\n]{0,12}(?:不得|禁止|不要|禁用|不使用|不能)/.test(text);
}

function explicitlyUsesStandardMandarin(text: string) {
  return /(标准普通话|普通话对白|台词(?:全部|均|一律)?[^。；\n]{0,10}(?:保持|使用|采用)[^。；\n]{0,8}普通话|全部台词[^。；\n]{0,12}普通话)/.test(text);
}

/** Infer sound only from current, authoritative script fields—not names, visual history or revision notes. */
export function inferAudioStyleProfile(script: unknown): AudioStyleProfile {
  const text = audioEvidence(script);
  if (!text) return "needs_review";
  if (rejectsHongKongMandarin(text)) return "modern_realistic";
  if (/(?:港式普通话|香港普通话|使用港式口音|采用港式口音)/.test(text)) return "hk90";
  if (explicitlyUsesStandardMandarin(text)) return "modern_realistic";
  if (/(?:(?:90年代|九十年代|九零年代)[^。\n]{0,20}(?:香港电影|港片|港风|香港市井电影)|(?:香港电影|港片|港风|香港市井电影)[^。\n]{0,20}(?:90年代|九十年代|九零年代))/.test(text)) return "hk90";
  if (/(纪录片|新闻播报|采访|专题片|旁白解说)/.test(text)) return "documentary";
  if (/(动漫|漫剧|动画|二次元|卡通)/.test(text)) return "animation";
  if (/(自定义音色|特殊口音|方言|英语|日语|韩语|粤语对白|使用粤语|采用粤语)/.test(text)) return "custom";
  if (/(现代|当代|写实|现实主义|自然对白)/.test(text)) return "modern_realistic";
  return "needs_review";
}

function cleanSoundNotes(value: string) {
  return value
    .replace(/王家卫式/g, "都市文艺电影感")
    .replace(/梅林茂风格/g, "原创电影感")
    .replace(/致敬《[^》]+》(?:《[^》]+》)?[，,；;]?/g, "")
    .replace(/不用现成粤语老歌/g, "仅使用原创或已授权音乐")
    .replace(/原创都市文艺电影感情调配乐/g, "原创都市文艺电影感配乐")
    .replace(/都市文艺电影感情调配乐/g, "都市文艺电影感配乐")
    .replace(/原创电影感弦乐/g, "原创弦乐")
    .replace(/\s+/g, " ")
    .trim();
}

function scriptCharacters(script: unknown): AudioCharacterProfile[] {
  const content = objectValue(script);
  if (!content || !Array.isArray(content.characters)) return [];
  return content.characters.flatMap((value) => {
    const character = objectValue(value);
    const name = textValue(character?.name);
    if (!character || !name) return [];
    return [{
      name,
      role: textValue(character.role),
      traits: textValue(character.traits),
      voiceDirection: textValue(character.voiceDirection || character.audioDirection || character.voice)
    }];
  });
}

function scriptSoundNotes(script: unknown, style: AudioStyleProfile) {
  const content = objectValue(script);
  if (!content) return "";
  const notes: string[] = [];
  const sceneNotes = Array.isArray(content.scenes) ? content.scenes.flatMap((value) => {
    const scene = objectValue(value);
    const sound = textValue(scene?.sound);
    if (!scene || !sound) return [];
    return `${textValue(scene.name) || "场景"}：${sound}`;
  }) : [];
  const direction = objectValue(content.audioDirection);
  if (typeof content.audioDirection === "string") notes.push(content.audioDirection);
  if (direction) {
    if (textValue(direction.music)) notes.push(`音乐：${textValue(direction.music)}`);
    if (!sceneNotes.length && textValue(direction.soundDesign)) notes.push(`环境与音效：${textValue(direction.soundDesign)}`);
    if (textValue(direction.signatureSounds)) notes.push(`听觉签名：${textValue(direction.signatureSounds)}`);
  }
  if (sceneNotes.length) notes.push(`场景声音依次为：${sceneNotes.join("；")}`);
  const evidence = audioEvidence(script);
  if (style === "modern_realistic" && explicitlyUsesStandardMandarin(evidence)) {
    notes.unshift("语言与口音：全部角色使用符合年龄和身份的标准普通话");
  }
  return cleanSoundNotes(notes.join("。")).slice(0, 1400);
}

export function audioPromptContextFromScript(script: unknown): AudioPromptContext {
  const style = inferAudioStyleProfile(script);
  return { style, styleNotes: scriptSoundNotes(script, style), characters: scriptCharacters(script) };
}

function speechAnchor(style: AudioStyleProfile) {
  if (style === "hk90") return "港式普通话";
  if (style === "documentary") return "标准普通话，克制清晰，不带播音腔夸张起伏";
  if (style === "animation") return "角色化标准普通话，咬字清楚，允许适度夸张但不失真";
  if (style === "custom") return "按照锁定剧本指定的语言、方言和口音，不自行替换";
  if (style === "needs_review") return "声音风格待导演确认，不自行添加口音或时代滤镜";
  return "标准普通话，吐字自然，不使用网红腔";
}

function aliases(name: string) {
  return name.split(/\s*(?:\/|／|、)\s*/).map((value) => value.trim()).filter(Boolean);
}

function characterForSpeaker(speaker: string, characters: AudioCharacterProfile[]) {
  return characters.find((character) => aliases(character.name).some((alias) => alias === speaker || alias.includes(speaker) || speaker.includes(alias)));
}

function cleanDirection(value: string, style?: AudioStyleProfile) {
  let result = value.trim();
  if (style && style !== "hk90") {
    result = result
      .replace(/港式(?:普通话|口音)/g, "")
      .replace(/禁用[^。；]{0,24}母带/g, "")
      .replace(/台词必须是[“"‘'][^”"’']+[”"’']/g, "")
      .replace(/([、，,；;])\1+/g, "$1")
      .replace(/不要\s*[、，,；;]/g, "不要");
  }
  return result.replace(/^[、，,；;\s]+|[、，,；;\s]+$/g, "").replace(/[。；;]+$/g, "");
}

function directionForSpeaker(value: string, speaker: string, style: AudioStyleProfile) {
  const clauses = value.split(/[；;]/).map((clause) => clause.trim()).filter(Boolean);
  const matched = clauses.filter((clause) => clause.includes(speaker));
  const selected = matched.length ? matched.join("；") : value;
  const withoutRepeatedName = selected.startsWith(`${speaker}是`) || selected.startsWith(`${speaker}为`)
    ? selected.slice(speaker.length + 1)
    : selected.startsWith(speaker) ? selected.slice(speaker.length) : selected;
  return cleanDirection(withoutRepeatedName, style);
}

function voiceAnchor(speaker: string, style: AudioStyleProfile, line: AudioPromptLine | undefined, characters: AudioCharacterProfile[]) {
  const name = speaker.trim() || "未指定角色";
  const speech = speechAnchor(style);
  if (line?.voiceDirection?.trim()) return `${name}是${directionForSpeaker(line.voiceDirection, name, style)}`;
  const character = characterForSpeaker(name, characters);
  const profile = `${character?.role ?? ""} ${character?.traits ?? ""} ${character?.voiceDirection ?? ""}`.trim();
  if (character?.voiceDirection) return `${name}是${cleanDirection(character.voiceDirection, style)}`;
  const age = profile.match(/\d{1,2}岁/)?.[0] ?? "";
  const isFemale = /(女主|女生|女性|女孩|少女|女高中生)/.test(profile);
  const isMale = /(男主|男生|男性|男孩|男高中生)/.test(profile);
  const isStudent = /(高中|学生|同班|少年|青春期)/.test(profile);
  if (/猫掌柜/.test(name)) return `${name}是成年拟人猫角色，${speech}，中低音，温暖可靠、克制稳重，语速偏慢，句尾落稳，不使用冷淡市井吐槽腔`;
  if (isFemale && isStudent) return `${name}是${age || "青春期"}女高中生，${speech}，声线清澈柔和、有少年感，音量偏轻，情绪变化细腻`;
  if (isMale && isStudent) {
    const playful = /(冲突触发者|玩笑|同学)/.test(profile);
    return `${name}是${age || "青春期"}男高中生，${speech}，声线年轻，${playful ? "带同学间的玩笑感但不过度霸凌" : "语气拘谨克制、保留少年感"}`;
  }
  if (isFemale) return `${name}是${age || "成年"}女性，${speech}，声线清楚，语速和情绪严格按照剧本变化`;
  if (isMale) return `${name}是${age || "成年"}男性，${speech}，声线稳定，语速和情绪严格按照剧本变化`;
  return `${name}的年龄和性别尚未从锁定剧本确认，${speech}，暂不允许提交真实生成`;
}

function performanceDirection(line: AudioPromptLine, style: AudioStyleProfile, character: AudioCharacterProfile | undefined) {
  const speaker = line.speaker.trim() || "未指定角色";
  if (line.voiceDirection?.trim()) return `${speaker}按以下锁定表演要求说道——${directionForSpeaker(line.voiceDirection, speaker, style)}`;
  const text = line.text.trim();
  const profile = `${character?.role ?? ""} ${character?.traits ?? ""}`;
  if (/^[…\.]+\s*嗯/.test(text)) return `${speaker}先犹豫停顿，音量很低，尾音短促地回应`;
  if (/(冲突触发者|玩笑|同学)/.test(profile)) return `${speaker}用${speechAnchor(style)}，带少年同学间的打趣感，语速略快但不恶意吼叫地说道`;
  if (/[？！!]/.test(text.slice(-1))) return `${speaker}用${speechAnchor(style)}，情绪抬高但保持年龄与身份，吐字清楚地说道`;
  if (/[？?]/.test(text.slice(-1))) return `${speaker}用${speechAnchor(style)}，语速自然，句尾轻微上扬地问道`;
  return `${speaker}用${speechAnchor(style)}，按人物当下情绪自然停顿、克制表达地说道`;
}

function soundDirection(style: AudioStyleProfile, styleNotes = "") {
  if (styleNotes.trim()) {
    return `声音环境和音乐严格按锁定剧本执行：${cleanSoundNotes(styleNotes)}。对白出现时音乐压低，保留人物自然停顿、呼吸和动作音效，只使用原创音乐与已授权声音素材。`;
  }
  if (style === "hk90") return "先建立剧本明确的90年代香港环境声，再用原创低音贝斯、合成器与必要的时代音效铺底。对白出现时音乐压低，人物使用港式普通话，依靠停顿和语速变化表现情绪，不模仿具体演员或电影原声。";
  if (style === "documentary") return "先保留现场空间低噪、远处环境声和必要设备声。音乐只作低存在感铺底，对白出现时明显压低，保持信息清楚、停顿自然和情绪克制。";
  if (style === "animation") return "先建立与画面动作对应的环境声、脚步、衣物摩擦和关键拟音。音乐使用衬托动作的原创节奏型配器，对白出现时让位，保留角色呼吸、停顿和反应声。";
  if (style === "custom") return "先按照锁定剧本写明的时代、地域、语言和人物关系建立声音环境。音乐、对白和音效按剧情顺序进入，对白出现时降低音乐，保留停顿、呼吸和动作反应。";
  if (style === "needs_review") return "声音风格尚未在锁定剧本中明确。此提示词只能用于导演检查，不能提交生成；请先补充时代、地域、语言、口音和表演方式。";
  return "先建立剧本指定地点的真实环境声、脚步、衣物摩擦和必要动作音效。音乐使用克制的原创铺底，对白出现时压低，保留自然停顿、呼吸和情绪变化，不使用播音腔或网红腔。";
}

/** Build the official Doubao plain-text order: character voices → sound/music → dialogue/events. */
export function buildAudioPrompt(lines: AudioPromptLine[], options: AudioPromptOptions = {}) {
  const context = options.script === undefined ? null : audioPromptContextFromScript(options.script);
  const style = options.style ?? context?.style ?? "modern_realistic";
  const styleNotes = options.styleNotes ?? context?.styleNotes ?? "";
  const characters = options.characters ?? context?.characters ?? [];
  const valid = lines.filter((line) => line.text.trim());
  const speakers = [...new Set(valid.map((line) => line.speaker.trim()).filter(Boolean))];
  const characterBlock = (speakers.length ? speakers : ["未指定角色"]).map((speaker) => {
    const line = valid.find((item) => item.speaker.trim() === speaker);
    return `${voiceAnchor(speaker, style, line, characters)}。`;
  }).join("\n");
  const dialogueBlock = valid.map((line) => `${performanceDirection(line, style, characterForSpeaker(line.speaker.trim(), characters))}：“${line.text.trim()}”`).join("\n");
  return `${characterBlock}\n\n${soundDirection(style, styleNotes)}\n\n${dialogueBlock}`;
}

/** Backward-compatible helper for explicitly confirmed Hong Kong 90s scripts. */
export function buildHongKongAudioPrompt(lines: AudioPromptLine[]) {
  return buildAudioPrompt(lines, { style: "hk90" });
}

/** Validate the official plain-text structure before a paid generation request. */
export function validateAudioPrompt(prompt: string, style: AudioStyleProfile | "auto" = "auto") {
  const errors: string[] = [];
  const text = prompt.trim();
  if (!text) errors.push("提示词不能为空。");
  if (!/(?:是|为).*(?:男|女|声线|音色|普通话|粤语|英语|方言|口音|拟人)/.test(text)) errors.push("缺少角色声线、语言或口音清单。");
  if (!/(音乐|环境|音效|声音|脚步|电话|呼吸|碰撞|雨声|鼓点|贝斯|合成器)/.test(text)) errors.push("缺少声音环境、音乐或音效设计。");
  if (!/[“"‘'].+[”"’']/.test(text)) errors.push("对白必须使用引号，并明确写出完整台词。");
  if (!/(停顿|语速|音量|声线|尾音|情绪|咬字|低声|高声|加快|放慢)/.test(text)) errors.push("缺少具体的语速、音量、停顿或情绪表演指令。");
  if (/年龄和性别尚未从锁定剧本确认|暂不允许提交真实生成/.test(text)) errors.push("有角色缺少年龄或性别依据，不能提交真实音频任务。");
  if (style === "hk90" && !/(港式普通话|香港普通话)/.test(text)) errors.push("当前剧本判定为90年代香港电影，必须明确写出港式普通话。");
  if (style === "hk90" && rejectsHongKongMandarin(text)) errors.push("提示词同时要求和禁止港式普通话，必须先解决口音冲突。");
  if (style !== "hk90" && style !== "auto" && /(?:使用|采用|人物说|角色说|用)港式普通话/.test(text) && !rejectsHongKongMandarin(text)) errors.push("当前剧本没有港式普通话依据，不能提交港式口音。");
  if (style === "needs_review") errors.push("锁定剧本没有明确声音风格，不能提交音频生成；请先补充语言、口音、时代和表演方式。");
  if (style !== "hk90" && style !== "auto" && !/(普通话|粤语|英语|日语|韩语|方言|口音|语言)/.test(text)) errors.push("当前声音风格需要明确语言或口音设定。");
  if (text.includes("用稳定、清晰、自然的普通话说") || text.includes("自然地说")) errors.push("不能用泛化的‘自然地说’替代官方模板结构。");
  if (/(模仿.*周星驰|模仿.*刘德华|模仿.*梁朝伟|复制.*演员|电影原声)/.test(text)) errors.push("不能要求复制具体演员或电影原声。");
  return errors;
}

export function validateHongKongAudioPrompt(prompt: string) {
  return validateAudioPrompt(prompt, "hk90");
}
