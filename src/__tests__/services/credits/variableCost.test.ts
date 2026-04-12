import { getCreditMultiplier } from "../../../config/models/selectable.js";

describe("Variable credit cost", () => {
  it("eco model costs 1 credit", () => {
    expect(getCreditMultiplier("gemini-3-flash-preview:minimal")).toBe(1);
  });

  it("standard model costs 2 credits", () => {
    expect(getCreditMultiplier("gpt-5:low")).toBe(2);
  });

  it("premium model costs 3 credits", () => {
    expect(getCreditMultiplier("claude-sonnet-4-6:none")).toBe(3);
  });

  it("elite model costs 5 credits", () => {
    expect(getCreditMultiplier("claude-opus-4-6:none")).toBe(5);
  });

  it("unknown model defaults to 1 credit", () => {
    expect(getCreditMultiplier("nonexistent:none")).toBe(1);
  });
});
