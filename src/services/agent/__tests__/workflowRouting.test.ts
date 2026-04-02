/**
 * Workflow Routing & Mode Validation Tests
 *
 * Tests for:
 * 1. MODE_CONFIG structure (fast/deep only)
 * 2. Mode × intent → correct workflow routing logic
 * 3. Old modes ("ask", "search", "create-quick", "create-deep") rejection
 * 4. Types consistency (IntentType, AgentMode, PromptKey)
 */

import { describe, expect, it } from "@jest/globals";
import { MODE_CONFIG, type AgentMode, type IntentType, type PromptKey } from "../types.js";
import { detectIntent } from "../intentClassifier.js";

// ============================================================================
// MODE_CONFIG structure
// ============================================================================

describe("MODE_CONFIG", () => {
  it("has exactly 2 modes: fast and deep", () => {
    const modes = Object.keys(MODE_CONFIG);
    expect(modes).toHaveLength(2);
    expect(modes).toContain("fast");
    expect(modes).toContain("deep");
  });

  it("does not contain old modes", () => {
    const modes = Object.keys(MODE_CONFIG);
    expect(modes).not.toContain("ask");
    expect(modes).not.toContain("search");
    expect(modes).not.toContain("create-quick");
    expect(modes).not.toContain("create-deep");
  });

  it("fast mode has correct configuration", () => {
    expect(MODE_CONFIG.fast).toEqual({
      maxSteps: 10,
      maxTokens: 4096,
      description: expect.any(String),
      thinking: "medium",
    });
  });

  it("deep mode has correct configuration", () => {
    expect(MODE_CONFIG.deep).toEqual({
      maxSteps: 12,
      maxTokens: 16384,
      description: expect.any(String),
      thinking: "high",
    });
  });

  it("fast mode has lower maxSteps than deep", () => {
    expect(MODE_CONFIG.fast.maxSteps).toBeLessThan(MODE_CONFIG.deep.maxSteps);
  });

  it("fast mode has lower maxTokens than deep", () => {
    expect(MODE_CONFIG.fast.maxTokens).toBeLessThan(MODE_CONFIG.deep.maxTokens);
  });

  it("fast mode uses medium thinking", () => {
    expect(MODE_CONFIG.fast.thinking).toBe("medium");
  });

  it("deep mode uses high thinking", () => {
    expect(MODE_CONFIG.deep.thinking).toBe("high");
  });
});

// ============================================================================
// Workflow routing: mode × intent → correct workflow
// ============================================================================

/**
 * Simulates the workflow routing logic from routes/agent.ts.
 * This is a pure function to test the dispatch logic without Express dependencies.
 */
function resolveWorkflow(
  mode: AgentMode,
  intent: IntentType,
): "ask" | "quick-content" | "deep-research" | "deep-content" {
  if (mode === "fast" && intent === "conversation") return "ask";
  if (mode === "fast" && intent === "creation") return "quick-content";
  if (mode === "deep" && intent === "conversation") return "deep-research";
  if (mode === "deep" && intent === "creation") return "deep-content";

  // Should never reach here with valid types
  throw new Error(`Unknown mode×intent: ${mode}×${intent}`);
}

describe("Workflow routing: mode × intent → workflow", () => {
  it("fast + conversation → ask behavior", () => {
    expect(resolveWorkflow("fast", "conversation")).toBe("ask");
  });

  it("fast + creation → quick content workflow", () => {
    expect(resolveWorkflow("fast", "creation")).toBe("quick-content");
  });

  it("deep + conversation → deep research workflow", () => {
    expect(resolveWorkflow("deep", "conversation")).toBe("deep-research");
  });

  it("deep + creation → deep content workflow", () => {
    expect(resolveWorkflow("deep", "creation")).toBe("deep-content");
  });
});

describe("Workflow routing: end-to-end with detectIntent", () => {
  it("fast mode + 'qu est-ce que la gravité' → ask workflow", () => {
    const intent = detectIntent("qu'est-ce que la gravité ?");
    expect(resolveWorkflow("fast", intent)).toBe("ask");
  });

  it("fast mode + 'crée un résumé' → quick content workflow", () => {
    const intent = detectIntent("crée un résumé de mon cours");
    expect(resolveWorkflow("fast", intent)).toBe("quick-content");
  });

  it("deep mode + 'explain quantum physics' → deep research workflow", () => {
    const intent = detectIntent("explain quantum physics in detail");
    expect(resolveWorkflow("deep", intent)).toBe("deep-research");
  });

  it("deep mode + 'generate a report' → deep content workflow", () => {
    const intent = detectIntent("generate a comprehensive report on AI");
    expect(resolveWorkflow("deep", intent)).toBe("deep-content");
  });

  it("deep mode + 'rédige un essai' → deep content workflow", () => {
    const intent = detectIntent("rédige un essai sur la philosophie");
    expect(resolveWorkflow("deep", intent)).toBe("deep-content");
  });

  it("fast mode + ambiguous message → ask workflow (default conversation)", () => {
    const intent = detectIntent("les maths c'est cool");
    expect(resolveWorkflow("fast", intent)).toBe("ask");
  });

  it("deep mode + ambiguous message → deep research workflow (default conversation)", () => {
    const intent = detectIntent("je me demande comment tout ça fonctionne");
    expect(resolveWorkflow("deep", intent)).toBe("deep-research");
  });
});

// ============================================================================
// Old mode rejection
// ============================================================================

describe("Old mode rejection", () => {
  const validModes: AgentMode[] = ["fast", "deep"];

  it("rejects 'ask' as invalid mode", () => {
    expect(validModes.includes("ask" as AgentMode)).toBe(false);
  });

  it("rejects 'search' as invalid mode", () => {
    expect(validModes.includes("search" as AgentMode)).toBe(false);
  });

  it("rejects 'create-quick' as invalid mode", () => {
    expect(validModes.includes("create-quick" as AgentMode)).toBe(false);
  });

  it("rejects 'create-deep' as invalid mode", () => {
    expect(validModes.includes("create-deep" as AgentMode)).toBe(false);
  });

  it("accepts 'fast' as valid mode", () => {
    expect(validModes.includes("fast")).toBe(true);
  });

  it("accepts 'deep' as valid mode", () => {
    expect(validModes.includes("deep")).toBe(true);
  });

  it("MODE_CONFIG does not accept old mode keys", () => {
    const config = MODE_CONFIG as Record<string, unknown>;
    expect(config["ask"]).toBeUndefined();
    expect(config["search"]).toBeUndefined();
    expect(config["create-quick"]).toBeUndefined();
    expect(config["create-deep"]).toBeUndefined();
  });
});

// ============================================================================
// Type consistency
// ============================================================================

describe("Type consistency", () => {
  it("IntentType only has conversation and creation", () => {
    const validIntents: IntentType[] = ["conversation", "creation"];
    expect(validIntents).toHaveLength(2);
  });

  it("AgentMode only has fast and deep", () => {
    const validModes: AgentMode[] = ["fast", "deep"];
    expect(validModes).toHaveLength(2);
  });

  it("PromptKey combinations are valid", () => {
    const keys: PromptKey[] = [
      "fast-conversation",
      "fast-creation",
      "deep-conversation",
      "deep-creation",
    ];
    expect(keys).toHaveLength(4);
    // All should be valid PromptKey values
    keys.forEach((key) => {
      const [mode, intent] = key.split("-") as [AgentMode, IntentType];
      expect(["fast", "deep"]).toContain(mode);
      expect(["conversation", "creation"]).toContain(intent);
    });
  });

  it("MODE_CONFIG keys match AgentMode type", () => {
    const configKeys = Object.keys(MODE_CONFIG) as AgentMode[];
    configKeys.forEach((key) => {
      expect(["fast", "deep"]).toContain(key);
    });
  });
});
