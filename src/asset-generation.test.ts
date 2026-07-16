import { describe, expect, it } from "vitest";
import { assetImageSize } from "./asset-generation";

describe("assetImageSize", () => {
  it("uses the checked APIMart ratio stored with the asset", () => {
    expect(assetImageSize({ type: "prop", negativePrompt: '检查通过\nAPIMart参数：{"size":"3:2","n":1}' })).toBe("3:2");
  });

  it("falls back by asset type", () => {
    expect(assetImageSize({ type: "scene", negativePrompt: "" })).toBe("16:9");
    expect(assetImageSize({ type: "character", negativePrompt: "" })).toBe("3:2");
    expect(assetImageSize({ type: "prop", negativePrompt: "" })).toBe("1:1");
  });
});
