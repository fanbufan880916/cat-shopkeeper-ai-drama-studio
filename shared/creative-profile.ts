import type { ContentMode, Project, VisualStyleProfile } from "./types.js";

export const contentModeLabels: Record<ContentMode, string> = {
  short_film: "剧情短片",
  ad: "创意广告",
  mv: "音乐 MV"
};

const explicitHongKong90 = /(?:(?:90年代|九十年代|九零年代)[^。\n]{0,20}(?:香港电影|港片|港风|香港市井电影)|(?:香港电影|港片|港风|香港市井电影)[^。\n]{0,20}(?:90年代|九十年代|九零年代))/;

export function inferContentMode(text: string, fallback: ContentMode = "short_film"): ContentMode {
  const value = text.trim();
  if (/(创意广告|广告片|品牌片|产品片|卖点|CTA|行动号召|转化)/i.test(value)) return "ad";
  if (/(音乐MV|音乐视频|歌词|副歌|BPM|节拍同步|music video)/i.test(value)) return "mv";
  return fallback;
}

export function inferVisualStyleProfile(text: string, sourceArtifactId: string | null = null): VisualStyleProfile {
  const value = text.trim();
  if (explicitHongKong90.test(value)) {
    return { status: "locked", name: "90年代香港电影质感", descriptors: ["港式普通话（仅剧本明确要求时）", "时代化场景与服化道", "复古胶片色彩"], evidence: "剧本明确同时出现90年代与香港电影/港片/港风要求。", source: "script", sourceArtifactId };
  }
  const candidates: Array<[RegExp, string, string[]]> = [
    [/(现代写实|当代写实|现实主义|自然主义)/, "现代现实主义", ["自然光逻辑", "克制表演", "生活化材质"]],
    [/(纪录片|新闻纪实|观察式拍摄)/, "纪实影像", ["现场感", "非戏剧化光线", "观察式镜头"]],
    [/(动画|动漫|二次元|卡通|定格动画)/, "动画视觉", ["明确材质体系", "夸张动作", "统一角色造型"]],
    [/(赛博朋克|霓虹都市|未来都市)/, "未来都市视觉", ["人工光源", "高反差色彩", "城市层次"]]
  ];
  const match = candidates.find(([pattern]) => pattern.test(value));
  if (match) return { status: "locked", name: match[1], descriptors: match[2], evidence: `剧本明确出现“${match[1]}”或等价视觉要求。`, source: "script", sourceArtifactId };
  return { status: "needs_review", name: "", descriptors: [], evidence: "剧本没有明确可执行的视觉风格，需导演或用户确认后才能生成画面。", source: "none", sourceArtifactId };
}

export function isVisualStyleLocked(project: Project) {
  return project.visualStyle.status === "locked" && Boolean(project.visualStyle.name.trim());
}

export function styleGateMessage(project: Project) {
  return `项目“${project.name}”尚未锁定视觉风格。请先在创作档案中确认风格名称与视觉描述，再提交图片或视频生成。`;
}
