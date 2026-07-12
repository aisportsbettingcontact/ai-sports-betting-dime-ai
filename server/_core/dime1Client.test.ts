import { afterEach, describe, expect, it, vi } from "vitest";
import { dime1ChatComplete, isDime1Configured, resolveDime1Config } from "./dime1Client";

const RUNPOD_ENV = { RUNPOD_ENDPOINT_ID: "ep123abc", RUNPOD_API_KEY: "rp-key" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveDime1Config", () => {
  it("returns null when neither DIME_MODEL_BASE_URL nor RUNPOD_ENDPOINT_ID is set", () => {
    expect(resolveDime1Config({})).toBeNull();
    expect(isDime1Configured({})).toBe(false);
    expect(resolveDime1Config({ RUNPOD_ENDPOINT_ID: "   " })).toBeNull();
  });

  it("derives the RunPod OpenAI-compatible base URL from RUNPOD_ENDPOINT_ID", () => {
    const config = resolveDime1Config(RUNPOD_ENV);
    expect(config?.baseUrl).toBe("https://api.runpod.ai/v2/ep123abc/openai/v1");
    expect(config?.source).toBe("runpod");
    expect(config?.bearerToken).toBe("rp-key");
  });

  it("prefers an explicit DIME_MODEL_BASE_URL and strips trailing slashes", () => {
    const config = resolveDime1Config({ ...RUNPOD_ENV, DIME_MODEL_BASE_URL: "http://127.0.0.1:8000/v1/" });
    expect(config?.baseUrl).toBe("http://127.0.0.1:8000/v1");
    expect(config?.source).toBe("explicit");
  });

  it("prefers DIME_MODEL_API_SECRET over RUNPOD_API_KEY for the bearer token", () => {
    const config = resolveDime1Config({ ...RUNPOD_ENV, DIME_MODEL_API_SECRET: "private-lb-secret" });
    expect(config?.bearerToken).toBe("private-lb-secret");
  });

  it("pins the served model from DIME_MODEL_VERSION and falls back to dime-1.0", () => {
    expect(resolveDime1Config(RUNPOD_ENV)?.model).toBe("dime-1.0");
    expect(resolveDime1Config({ ...RUNPOD_ENV, DIME_MODEL_VERSION: "dime-1.0-v1.0.0" })?.model).toBe(
      "dime-1.0-v1.0.0",
    );
  });

  it("applies the timeout default and override", () => {
    expect(resolveDime1Config(RUNPOD_ENV)?.timeoutMs).toBe(60_000);
    expect(resolveDime1Config({ ...RUNPOD_ENV, DIME_MODEL_TIMEOUT_MS: "15000" })?.timeoutMs).toBe(15_000);
    expect(resolveDime1Config({ ...RUNPOD_ENV, DIME_MODEL_TIMEOUT_MS: "junk" })?.timeoutMs).toBe(60_000);
  });
});

describe("dime1ChatComplete", () => {
  it("POSTs an OpenAI-compatible chat completion and parses the reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "dime-1.0",
          choices: [{ message: { content: "PHI -1.5 is a pass at -120." }, finish_reason: "stop" }],
          usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await dime1ChatComplete(
      { system: "sys", messages: [{ role: "user", content: "Phillies spread?" }], maxTokens: 512 },
      RUNPOD_ENV,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.runpod.ai/v2/ep123abc/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer rp-key");

    const payload = JSON.parse(init.body as string);
    expect(payload.model).toBe("dime-1.0");
    expect(payload.stream).toBe(false);
    expect(payload.max_tokens).toBe(512);
    expect(payload.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(payload.messages[1]).toEqual({ role: "user", content: "Phillies spread?" });

    expect(result.content).toBe("PHI -1.5 is a pass at -120.");
    expect(result.finishReason).toBe("stop");
    expect(result.usage?.totalTokens).toBe(940);
  });

  it("throws Dime1ApiError with the upstream status on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("worker cold start timeout", { status: 503 })),
    );
    await expect(
      dime1ChatComplete({ system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 64 }, RUNPOD_ENV),
    ).rejects.toMatchObject({ name: "Dime1ApiError", status: 503 });
  });

  it("throws before any network call when the endpoint is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      dime1ChatComplete({ system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 64 }, {}),
    ).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a 502-class error when the reply has no content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })),
    );
    await expect(
      dime1ChatComplete({ system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 64 }, RUNPOD_ENV),
    ).rejects.toMatchObject({ status: 502 });
  });
});
