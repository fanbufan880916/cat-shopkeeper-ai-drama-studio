import { describe, expect, it } from "vitest";
import { characterAssetPromptIssues, cleanIdentityAnchor, cleanImagePrompt, extractAssetReferenceCode } from "./image-prompt.js";

describe("image prompt separation", () => {
  const source = "整体美术风格样板图，风格资产 ID：STYLE_HK_001，用于《午夜替补》统一后续角色、场景和分镜的影像质感。横向3:2四格视觉样板。";

  it("extracts the management reference code", () => {
    expect(extractAssetReferenceCode(source)).toBe("STYLE_HK_001");
  });

  it("removes management metadata from prompts sent to models", () => {
    expect(cleanImagePrompt(source)).toBe("整体美术风格样板图，横向3:2四格视觉样板。");
  });

  it("keeps only visible identity traits in the identity anchor", () => {
    expect(cleanIdentityAnchor("资产ID CHAR_CAT_001。黑银虎斑、白色口鼻和琥珀金圆眼。"))
      .toBe("黑银虎斑、白色口鼻和琥珀金圆眼。");
  });

  it("accepts the required character reference-sheet layout", () => {
    const prompt = "角色设定图，3:2 横向构图。左侧约40%为同一角色的脸部特写；右侧约60%为正面全身、侧面全身、背面全身三视图。浅灰背景与柔和棚光，棉布材质清楚。左右同一角色，脸部特写与三视图面部完全一致，不要改变脸型、五官和发型。";
    expect(characterAssetPromptIssues(prompt, "3:2")).toEqual([]);
  });

  it("rejects a cinematic portrait used as a character asset", () => {
    const issues = characterAssetPromptIssues("角色站在雨夜霓虹街头，王家卫质感，保持脸型。", "9:16");
    expect(issues).toContain("角色设定图必须使用 3:2 横向画幅");
    expect(issues.some((issue) => issue.includes("左侧约40%"))).toBe(true);
    expect(issues.some((issue) => issue.includes("港风霓虹"))).toBe(true);
  });
});
