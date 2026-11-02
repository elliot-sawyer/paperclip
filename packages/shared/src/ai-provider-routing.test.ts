import { describe, expect, it } from "vitest";
import { isLocalEndpointHost, aiProviderRoutingSchema } from "./ai-provider-routing.js";

describe("isLocalEndpointHost", () => {
  it("accepts loopback addresses", () => {
    expect(isLocalEndpointHost("localhost")).toBe(true);
    expect(isLocalEndpointHost("127.0.0.1")).toBe(true);
    expect(isLocalEndpointHost("[::1]")).toBe(true);
    expect(isLocalEndpointHost("127.0.0.2")).toBe(true);
  });

  it("accepts RFC-1918 private addresses", () => {
    expect(isLocalEndpointHost("10.0.0.1")).toBe(true);
    expect(isLocalEndpointHost("10.255.255.255")).toBe(true);
    expect(isLocalEndpointHost("172.16.0.1")).toBe(true);
    expect(isLocalEndpointHost("172.31.255.255")).toBe(true);
    expect(isLocalEndpointHost("192.168.1.250")).toBe(true);
    expect(isLocalEndpointHost("192.168.0.1")).toBe(true);
  });

  it("accepts IPv6 ULA addresses (fc00::/7)", () => {
    expect(isLocalEndpointHost("[fc00::1]")).toBe(true);
    expect(isLocalEndpointHost("[fd12:3456:789a::1]")).toBe(true);
  });

  it("rejects link-local (cloud metadata endpoints) and public addresses", () => {
    // 169.254.169.254 is the AWS/Azure/GCP instance-metadata endpoint — must be rejected
    expect(isLocalEndpointHost("169.254.169.254")).toBe(false);
    expect(isLocalEndpointHost("169.254.1.1")).toBe(false);
    // IPv6 link-local — excluded for the same reason
    expect(isLocalEndpointHost("[fe80::1]")).toBe(false);
    // Public internet
    expect(isLocalEndpointHost("1.2.3.4")).toBe(false);
    expect(isLocalEndpointHost("172.15.0.1")).toBe(false);
    expect(isLocalEndpointHost("172.32.0.1")).toBe(false);
    expect(isLocalEndpointHost("8.8.8.8")).toBe(false);
    expect(isLocalEndpointHost("example.com")).toBe(false);
    expect(isLocalEndpointHost("[2001:db8::1]")).toBe(false);
  });
});

describe("aiProviderRoutingSchema — local kind", () => {
  const base = { kind: "local" as const, protocol: "chat" as const };

  it("accepts loopback HTTP URL", () => {
    const result = aiProviderRoutingSchema.safeParse({
      ...base,
      baseUrl: "http://localhost:11434/v1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts LAN IP HTTP URL (e.g. Goonrig Ollama)", () => {
    const result = aiProviderRoutingSchema.safeParse({
      ...base,
      baseUrl: "http://192.168.1.250:11434/v1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts RFC-1918 10.x.x.x HTTP URL", () => {
    const result = aiProviderRoutingSchema.safeParse({
      ...base,
      baseUrl: "http://10.0.0.5:11434/v1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a public HTTPS URL for local kind", () => {
    const result = aiProviderRoutingSchema.safeParse({
      ...base,
      baseUrl: "https://api.openai.com/v1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a public HTTP URL for local kind", () => {
    const result = aiProviderRoutingSchema.safeParse({
      ...base,
      baseUrl: "http://1.2.3.4:11434/v1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a URL with credentials", () => {
    const result = aiProviderRoutingSchema.safeParse({
      ...base,
      baseUrl: "http://user:pass@192.168.1.1:11434/v1",
    });
    expect(result.success).toBe(false);
  });
});
