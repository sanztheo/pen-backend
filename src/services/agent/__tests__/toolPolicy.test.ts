import { describe, expect, it } from "@jest/globals";
import { resolveAgentToolPolicy } from "../toolPolicy.js";

describe("resolveAgentToolPolicy", () => {
  it("keeps web and Wikipedia tools available for standard conversation", () => {
    const policy = resolveAgentToolPolicy({
      intent: "conversation",
      useWeb: false,
      ragSources: [],
      providerName: "openai",
    });

    expect(policy.exposePageTools).toBe(false);
    expect(policy.exposeGeneralWebSearch).toBe(true);
    expect(policy.exposeWikipediaLookupTools).toBe(true);
    expect(policy.exposeWikipediaRagTools).toBe(true);
    expect(policy.hasNativeWebSearch).toBe(false);
  });

  it("enables native web search by default for Google providers", () => {
    const policy = resolveAgentToolPolicy({
      intent: "conversation",
      useWeb: false,
      ragSources: [],
      providerName: "google",
    });

    expect(policy.hasNativeWebSearch).toBe(true);
    expect(policy.exposeGeneralWebSearch).toBe(false);
    expect(policy.exposeWikipediaLookupTools).toBe(true);
    expect(policy.exposeWikipediaRagTools).toBe(true);
  });

  it("keeps Wikipedia tools available for attached Wikipedia sources", () => {
    const policy = resolveAgentToolPolicy({
      intent: "conversation",
      useWeb: false,
      ragSources: [{ id: "wikipedia:thermodynamics", title: "Thermodynamics", type: "wikipedia" }],
      providerName: "openai",
    });

    expect(policy.hasNativeWebSearch).toBe(false);
    expect(policy.exposeGeneralWebSearch).toBe(true);
    expect(policy.exposeWikipediaLookupTools).toBe(true);
    expect(policy.exposeWikipediaRagTools).toBe(true);
  });

  it("enables page tools only for creation intents", () => {
    const policy = resolveAgentToolPolicy({
      intent: "creation",
      useWeb: false,
      ragSources: [],
      providerName: "openai",
    });

    expect(policy.exposePageTools).toBe(true);
  });
});
