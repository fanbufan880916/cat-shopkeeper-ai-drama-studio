import { describe, expect, it } from "vitest";
import { projectRoute } from "./navigation";

describe("projectRoute", () => {
  it("always builds navigation from the project root", () => {
    expect(projectRoute("prj_123", "assets")).toBe("/project/prj_123/assets");
    expect(projectRoute("prj_123", "storyboard")).toBe("/project/prj_123/storyboard");
    expect(projectRoute("prj_123")).toBe("/project/prj_123");
  });
});
