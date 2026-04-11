import { describe, it, expect, vi } from "vitest";
import { createSSESender, createSSESenderWithDisconnect } from "../sseFactory.js";

function mockResponse(withFlush = true) {
  return {
    write: vi.fn(),
    ...(withFlush ? { flush: vi.fn() } : {}),
  };
}

// ---------------------------------------------------------------------------
// createSSESender
// ---------------------------------------------------------------------------
describe("createSSESender", () => {
  it("writes event and data in correct SSE format", () => {
    const res = mockResponse();
    const send = createSSESender(res as never);

    send("progress", { message: "hello" });

    expect(res.write).toHaveBeenCalledTimes(2);
    expect(res.write).toHaveBeenNthCalledWith(1, "event: progress\n");
    expect(res.write).toHaveBeenNthCalledWith(2, 'data: {"message":"hello"}\n\n');
  });

  it("calls flush when available", () => {
    const res = mockResponse(true);
    const send = createSSESender(res as never);

    send("status", { quizId: "abc" });

    expect(res.flush).toHaveBeenCalledTimes(1);
  });

  it("does not throw if flush is missing", () => {
    const res = mockResponse(false);
    const send = createSSESender(res as never);

    expect(() => send("status", { quizId: "abc" })).not.toThrow();
    expect(res.write).toHaveBeenCalledTimes(2);
  });

  it("serializes complex data correctly", () => {
    const res = mockResponse();
    const send = createSSESender(res as never);

    const data = { questionNumber: 3, totalQuestions: 10, canStartAnswering: true };
    send("question", data);

    expect(res.write).toHaveBeenNthCalledWith(2, `data: ${JSON.stringify(data)}\n\n`);
  });
});

// ---------------------------------------------------------------------------
// createSSESenderWithDisconnect
// ---------------------------------------------------------------------------
describe("createSSESenderWithDisconnect", () => {
  it("writes normally before disconnect", () => {
    const res = mockResponse();
    const { send } = createSSESenderWithDisconnect(res as never);

    send("progress", { message: "working" });

    expect(res.write).toHaveBeenCalledTimes(2);
    expect(res.write).toHaveBeenNthCalledWith(1, "event: progress\n");
    expect(res.write).toHaveBeenNthCalledWith(2, 'data: {"message":"working"}\n\n');
    expect(res.flush).toHaveBeenCalledTimes(1);
  });

  it("is a no-op after markDisconnected()", () => {
    const res = mockResponse();
    const { send, markDisconnected } = createSSESenderWithDisconnect(res as never);

    markDisconnected();
    send("progress", { message: "should not write" });

    expect(res.write).not.toHaveBeenCalled();
    expect(res.flush).not.toHaveBeenCalled();
  });

  it("isDisconnected() returns false initially", () => {
    const res = mockResponse();
    const { isDisconnected } = createSSESenderWithDisconnect(res as never);

    expect(isDisconnected()).toBe(false);
  });

  it("isDisconnected() returns true after markDisconnected()", () => {
    const res = mockResponse();
    const { isDisconnected, markDisconnected } = createSSESenderWithDisconnect(res as never);

    markDisconnected();

    expect(isDisconnected()).toBe(true);
  });

  it("stops writing mid-stream after disconnect", () => {
    const res = mockResponse();
    const { send, markDisconnected } = createSSESenderWithDisconnect(res as never);

    send("progress", { questionNumber: 1 });
    expect(res.write).toHaveBeenCalledTimes(2);

    markDisconnected();

    send("progress", { questionNumber: 2 });
    // Still only 2 calls from the first send
    expect(res.write).toHaveBeenCalledTimes(2);
  });
});
