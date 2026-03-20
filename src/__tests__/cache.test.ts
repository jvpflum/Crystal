import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { cachedCommand, invalidateCache } from "@/lib/cache";

const mockInvoke = vi.mocked(invoke);

describe("cachedCommand", () => {
  beforeEach(() => {
    invalidateCache();
    mockInvoke.mockReset();
  });

  it("calls invoke on first request", async () => {
    mockInvoke.mockResolvedValueOnce({ stdout: "ok", stderr: "", code: 0 });

    const result = await cachedCommand("openclaw health");
    expect(result).toEqual({ stdout: "ok", stderr: "", code: 0 });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("execute_command", {
      command: "openclaw health",
      cwd: null,
    });
  });

  it("returns cached result on second call within TTL", async () => {
    mockInvoke.mockResolvedValueOnce({ stdout: "cached", stderr: "", code: 0 });

    await cachedCommand("openclaw health");
    const result = await cachedCommand("openclaw health");

    expect(result.stdout).toBe("cached");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests", async () => {
    let resolvePromise: (v: unknown) => void;
    const slowPromise = new Promise(resolve => { resolvePromise = resolve; });
    mockInvoke.mockReturnValueOnce(slowPromise as ReturnType<typeof invoke>);

    const p1 = cachedCommand("openclaw health");
    const p2 = cachedCommand("openclaw health");

    resolvePromise!({ stdout: "deduped", stderr: "", code: 0 });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.stdout).toBe("deduped");
    expect(r2.stdout).toBe("deduped");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("invalidateCache clears specific key", async () => {
    mockInvoke.mockResolvedValue({ stdout: "fresh", stderr: "", code: 0 });

    await cachedCommand("openclaw health");
    invalidateCache("openclaw health");
    await cachedCommand("openclaw health");

    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("invalidateCache() clears all", async () => {
    mockInvoke.mockResolvedValue({ stdout: "data", stderr: "", code: 0 });

    await cachedCommand("cmd1");
    await cachedCommand("cmd2");
    invalidateCache();
    await cachedCommand("cmd1");
    await cachedCommand("cmd2");

    expect(mockInvoke).toHaveBeenCalledTimes(4);
  });

  it("uses cwd in cache key", async () => {
    mockInvoke
      .mockResolvedValueOnce({ stdout: "dir1", stderr: "", code: 0 })
      .mockResolvedValueOnce({ stdout: "dir2", stderr: "", code: 0 });

    const r1 = await cachedCommand("ls", { cwd: "/a" });
    const r2 = await cachedCommand("ls", { cwd: "/b" });

    expect(r1.stdout).toBe("dir1");
    expect(r2.stdout).toBe("dir2");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("propagates errors and cleans up inflight", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("network error"));

    await expect(cachedCommand("bad")).rejects.toThrow("network error");

    mockInvoke.mockResolvedValueOnce({ stdout: "recovered", stderr: "", code: 0 });
    const result = await cachedCommand("bad");
    expect(result.stdout).toBe("recovered");
  });
});
