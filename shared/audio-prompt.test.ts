import { describe, expect, it } from "vitest";
import { audioPromptContextFromScript, buildAudioPrompt, buildVoiceAnchorPrompt, inferAudioStyleProfile, validateAudioPrompt, validateVoiceAnchorPrompt } from "./audio-prompt.js";

describe("audio prompt style selection", () => {
  it("only selects Hong Kong style when the script says so", () => {
    expect(inferAudioStyleProfile("90年代香港市井电影，雨夜反转喜剧")).toBe("hk90");
    expect(inferAudioStyleProfile("现代校园悬疑，写实对白")).toBe("modern_realistic");
    expect(inferAudioStyleProfile("一个普通故事，没有明确时代和口音")).toBe("needs_review");
  });

  it("does not mistake superseded visual history for the current accent", () => {
    const script = {
      format: "60秒竖屏短片 · 王家卫文艺美学",
      visualDirection: { productionConstraint: "全部台词保持标准普通话（不得改为港式普通话）。" },
      revisionNote: "视觉风格从90年代香港电影质感升级为当前版本。",
      characters: [{ name: "小曼", role: "女主", traits: "17岁，同班女生，清纯温柔" }]
    };
    expect(inferAudioStyleProfile(script)).toBe("modern_realistic");
    expect(audioPromptContextFromScript(script).styleNotes).toContain("标准普通话");
  });

  it("uses locked character evidence instead of speaker order to build voices", () => {
    const script = {
      format: "现代校园短片",
      productionConstraint: "全部台词保持标准普通话（不得改为港式普通话）。",
      characters: [
        { name: "阿杰", role: "男主", traits: "17岁，内向腼腆的男高中生" },
        { name: "小曼", role: "女主", traits: "17岁，同班女生，清纯温柔" }
      ],
      audioDirection: { music: "原创弦乐和钢琴", soundDesign: "校园脚步声和清晨鸟鸣" }
    };
    const context = audioPromptContextFromScript(script);
    const prompt = buildAudioPrompt([
      { speaker: "阿杰", text: "……嗯。" },
      { speaker: "小曼", text: "你今天，不一样。" }
    ], context);
    expect(prompt).toContain("小曼是17岁女高中生");
    expect(prompt).toContain("阿杰是17岁男高中生");
    expect(prompt).toContain("标准普通话");
    expect(prompt).not.toContain("中年男性");
    expect(prompt).not.toContain("港式普通话");
    expect(prompt).not.toContain("旧母带");
    expect(validateAudioPrompt(prompt, context.style)).toEqual([]);
  });

  it("builds Xiaoman as a female high-school student with standard Mandarin voice anchor", () => {
    const script = {
      productionConstraint: "现代校园故事，全部台词保持标准普通话（不得改为港式普通话）。",
      characters: [{ name: "小曼", role: "女主", traits: "17岁女高中生，清澈温柔", voiceDirection: "17岁女高中生，标准普通话，声线清澈柔和，音量偏轻，情绪细腻" }]
    };
    const context = audioPromptContextFromScript(script);
    const prompt = buildVoiceAnchorPrompt({ speaker: "小曼", text: "你今天，不一样。" }, { script });
    expect(prompt).toContain("17岁女高中生");
    expect(prompt).toContain("标准普通话");
    expect(prompt).toContain("4到5秒");
    expect(prompt).toContain("无音乐、无环境声、无音效");
    expect(prompt).not.toContain("男性");
    expect(prompt).not.toContain("港式普通话");
    expect(validateVoiceAnchorPrompt(prompt, context.style)).toEqual([]);
  });

  it("builds a non-Hong-Kong prompt without forcing Hong Kong Mandarin", () => {
    const prompt = buildAudioPrompt([{ speaker: "林老师", text: "请把这份报告再核对一遍。" }], {
      style: "documentary",
      characters: [{ name: "林老师", role: "女教师", traits: "35岁成年女性", voiceDirection: "35岁成年女性，标准普通话，语速平稳、清晰克制" }]
    });
    expect(prompt).toContain("标准普通话");
    expect(prompt).not.toContain("港式普通话");
    expect(validateAudioPrompt(prompt, "documentary")).toEqual([]);
  });
});
