/**
 * EmailService Tests — Covers send methods, graceful degrade, error handling, HTML escaping
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// ─── Mock Resend ────────────────────────────────────────────
const mockSend = jest.fn();

jest.unstable_mockModule("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

// ─── Mock logger ────────────────────────────────────────────
jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Import after mocks ─────────────────────────────────────
const { EmailService, _resetForTest, _escapeHtmlForTest } = await import("../EmailService.js");
const { logger } = await import("../../utils/logger.js");

// ─── Setup ──────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  _resetForTest();
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.RESEND_FROM_EMAIL;
  mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });
});

// ═══════════════════════════════════════════════════════════════
//  sendWaitlistConfirmation
// ═══════════════════════════════════════════════════════════════

describe("EmailService.sendWaitlistConfirmation", () => {
  it("sends correct payload with name and position", async () => {
    await EmailService.sendWaitlistConfirmation({
      to: "user@example.com",
      name: "Alice",
      position: 42,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.to).toBe("user@example.com");
    expect(call.from).toBe("Pennote <noreply@pennote.fr>");
    expect(call.subject).toContain("waitlist");
    expect(call.html).toContain("Alice");
    expect(call.html).toContain("#42");
  });

  it("uses custom RESEND_FROM_EMAIL when set", async () => {
    process.env.RESEND_FROM_EMAIL = "Pennote <noreply@pennote.fr>";

    await EmailService.sendWaitlistConfirmation({
      to: "user@example.com",
      name: "Bob",
      position: 1,
    });

    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.from).toBe("Pennote <noreply@pennote.fr>");
  });

  it("logs success after sending", async () => {
    await EmailService.sendWaitlistConfirmation({
      to: "user@example.com",
      name: "Charlie",
      position: 5,
    });

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("waitlist confirmation sent to u**r@example.com"),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  sendSpotAvailable
// ═══════════════════════════════════════════════════════════════

describe("EmailService.sendSpotAvailable", () => {
  it("sends correct payload with CTA link", async () => {
    await EmailService.sendSpotAvailable({
      to: "user@example.com",
      name: "Diana",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toContain("libérée");
    expect(call.html).toContain("Diana");
    expect(call.html).toContain("https://pennote.fr/fr/join");
    expect(call.html).toContain("14 jours");
  });
});

// ═══════════════════════════════════════════════════════════════
//  sendBetaAccessGranted
// ═══════════════════════════════════════════════════════════════

describe("EmailService.sendBetaAccessGranted", () => {
  it("sends correct payload with CTA to dashboard", async () => {
    await EmailService.sendBetaAccessGranted({
      to: "user@example.com",
      name: "Alice",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toContain("Bienvenue dans la beta");
    expect(call.html).toContain("Alice");
    expect(call.html).toContain("https://pennote.fr/fr/dashboard");
  });

  it("contains the green accent box", async () => {
    await EmailService.sendBetaAccessGranted({
      to: "user@example.com",
      name: "Bob",
    });

    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.html).toContain("maintenant actif");
  });

  it("escapes HTML in user name", async () => {
    await EmailService.sendBetaAccessGranted({
      to: "user@example.com",
      name: '<script>alert("xss")</script>',
    });

    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.html).not.toContain("<script>");
    expect(call.html).toContain("&lt;script&gt;");
  });
});

// ═══════════════════════════════════════════════════════════════
//  sendBetaAccessRevoked
// ═══════════════════════════════════════════════════════════════

describe("EmailService.sendBetaAccessRevoked", () => {
  it("sends correct payload with deadline and CTA to join", async () => {
    await EmailService.sendBetaAccessRevoked({
      to: "user@example.com",
      name: "Diana",
      reactivationDeadlineDays: 14,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toContain("désactivé");
    expect(call.html).toContain("Diana");
    expect(call.html).toContain("14 jours");
    expect(call.html).toContain("https://pennote.fr/fr/join");
  });

  it("uses custom deadline days", async () => {
    await EmailService.sendBetaAccessRevoked({
      to: "user@example.com",
      name: "Eve",
      reactivationDeadlineDays: 7,
    });

    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.html).toContain("7 jours");
  });

  it("escapes HTML in user name", async () => {
    await EmailService.sendBetaAccessRevoked({
      to: "user@example.com",
      name: '<img src=x onerror="alert(1)">',
      reactivationDeadlineDays: 14,
    });

    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.html).not.toContain("<img src=x");
    expect(call.html).toContain("&lt;img");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Graceful degrade — no API key
// ═══════════════════════════════════════════════════════════════

describe("Graceful degrade without RESEND_API_KEY", () => {
  it("does not crash and logs warning when API key is missing", async () => {
    delete process.env.RESEND_API_KEY;

    await EmailService.sendWaitlistConfirmation({
      to: "user@example.com",
      name: "Eve",
      position: 1,
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY not set"));
  });

  it("does not crash for sendSpotAvailable without API key", async () => {
    delete process.env.RESEND_API_KEY;

    await EmailService.sendSpotAvailable({
      to: "user@example.com",
      name: "Frank",
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not crash for sendBetaAccessGranted without API key", async () => {
    delete process.env.RESEND_API_KEY;

    await EmailService.sendBetaAccessGranted({
      to: "user@example.com",
      name: "Grace",
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not crash for sendBetaAccessRevoked without API key", async () => {
    delete process.env.RESEND_API_KEY;

    await EmailService.sendBetaAccessRevoked({
      to: "user@example.com",
      name: "Hank",
      reactivationDeadlineDays: 14,
    });

    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
//  Error handling
// ═══════════════════════════════════════════════════════════════

describe("Error handling", () => {
  it("catches Resend API errors without throwing", async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded", name: "rate_limit_error" },
    });

    await expect(
      EmailService.sendWaitlistConfirmation({
        to: "user@example.com",
        name: "Grace",
        position: 3,
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Resend API error"),
      expect.objectContaining({ message: "Rate limit exceeded" }),
    );
  });

  it("catches network errors without throwing", async () => {
    mockSend.mockRejectedValue(new Error("Network timeout"));

    await expect(
      EmailService.sendSpotAvailable({
        to: "user@example.com",
        name: "Hank",
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send spot available"),
      expect.any(Error),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  HTML escaping
// ═══════════════════════════════════════════════════════════════

describe("HTML escaping", () => {
  it("escapes dangerous characters in user names", () => {
    const escaped = _escapeHtmlForTest('<script>alert("xss")</script>');
    expect(escaped).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(escaped).not.toContain("<script>");
  });

  it("escapes names in waitlist confirmation HTML", async () => {
    await EmailService.sendWaitlistConfirmation({
      to: "user@example.com",
      name: '<img src=x onerror="alert(1)">',
      position: 1,
    });

    const call = mockSend.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.html).not.toContain("<img");
    expect(call.html).toContain("&lt;img");
  });
});
