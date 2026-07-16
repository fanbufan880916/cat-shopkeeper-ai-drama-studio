import { describe, expect, it } from "vitest";
import { inferContentMode, inferVisualStyleProfile } from "./creative-profile.js";

describe("creative profile", () => {
  it("does not infer Hong Kong 90s from ordinary realism or neon", () => {
    expect(inferVisualStyleProfile("现代现实主义短片，夜里有霓虹招牌")).toMatchObject({ status: "locked", name: "现代现实主义" });
    expect(inferVisualStyleProfile("雨夜街道，霓虹反光，人物沉默")).not.toMatchObject({ name: "90年代香港电影质感" });
  });
  it("requires review when the script has no executable style", () => {
    expect(inferVisualStyleProfile("一个人回到家，发现桌上有一双洗好的鞋。")).toMatchObject({ status: "needs_review" });
  });
  it("allows Hong Kong 90s only when the script explicitly says so", () => {
    expect(inferVisualStyleProfile("明确采用90年代香港电影质感，人物说港式普通话。")).toMatchObject({ status: "locked", name: "90年代香港电影质感" });
  });
  it("keeps content mode routing separate from visual style", () => {
    expect(inferContentMode("创意广告：展示产品卖点和CTA")).toBe("ad");
    expect(inferContentMode("音乐MV，副歌段落跟随节拍")).toBe("mv");
    expect(inferContentMode("现实主义人物短片")).toBe("short_film");
  });
});
