import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.js";

describe("secret encryption", () => {
  it("round-trips without storing plaintext", () => {
    const plain = "apimart-test-secret";
    const encrypted = encryptSecret(plain);
    expect(encrypted).not.toContain(plain);
    expect(decryptSecret(encrypted)).toBe(plain);
  });
});
