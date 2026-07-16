const referenceCodePattern = /(?:角色|场景|风格|道具(?:组)?)?资产\s*ID\s*[：:]?\s*([A-Z0-9_-]+)/i;

export function extractAssetReferenceCode(value: string) {
  return value.match(referenceCodePattern)?.[1] ?? "";
}

export function cleanIdentityAnchor(value: string) {
  return value
    .replace(/(?:角色|场景|风格|道具(?:组)?)?资产\s*ID\s*[：:]?\s*[A-Z0-9_-]+[。；;，,]?\s*/gi, "")
    .trim();
}

export function cleanImagePrompt(value: string) {
  return value
    .replace(/(?:角色|场景|风格|道具(?:组)?)?资产\s*ID\s*[：:]?\s*[A-Z0-9_-]+[。；;，,]?\s*/gi, "")
    .replace(/用于《[^》]+》[^。；;]*(?:[。；;]|$)/g, "")
    .replace(/，\s*，/g, "，")
    .replace(/^\s*[，,。；;]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function characterAssetPromptIssues(value: string, aspectRatio: string) {
  const prompt = cleanImagePrompt(value);
  const lower = prompt.toLowerCase();
  const issues: string[] = [];
  const hasLeftFace = /左[侧边]?\s*约?\s*40\s*%/.test(prompt)
    && /(脸部特写|面部特写|头肩特写)/.test(prompt);
  const hasRightArea = /右[侧边]?\s*约?\s*60\s*%/.test(prompt);
  const hasFront = /正面/.test(prompt) || /\bfront\b/.test(lower);
  const hasSide = /侧面/.test(prompt) || /\bside\b/.test(lower);
  const hasBack = /(背面|后视)/.test(prompt) || /\b(back view|rear)\b/.test(lower);
  const hasFullBody = /全身/.test(prompt) || /\b(full body|full-body|turnaround)\b/.test(lower);
  const hasFaceLock = /(左右同一角色|脸部特写与三视图|面部完全一致|不要改变脸|不要改变脸型|保持脸型)/.test(prompt)
    || /(same face|face consistent|identity consistent)/.test(lower);

  if (aspectRatio !== "3:2") issues.push("角色设定图必须使用 3:2 横向画幅");
  if (!hasLeftFace) issues.push("必须明确左侧约40%为同一角色的脸部特写");
  if (!(hasRightArea && hasFront && hasSide && hasBack && hasFullBody)) {
    issues.push("必须明确右侧约60%为正面、侧面、背面全身三视图");
  }
  if (!hasFaceLock) issues.push("必须明确左右为同一角色且脸部、五官和发型保持一致");
  if (/(港风|90年代香港|王家卫|霓虹冷暖|anamorphic)/i.test(prompt)) {
    issues.push("角色资产图只能使用中性设定光，不能写成剧情分镜或港风霓虹画面");
  }
  return issues;
}
