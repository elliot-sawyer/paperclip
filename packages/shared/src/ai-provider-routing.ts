import { z } from "zod";

/**
 * Returns true for any hostname that is a loopback address or an RFC-1918
 * private-network address. The `local` routing kind accepts these hosts over
 * plain HTTP so that users can point Paperclip at a locally running inference
 * server such as Ollama or LM Studio on the same machine or LAN without TLS.
 *
 * Link-local ranges (169.254.x.x, fe80::/10) are intentionally excluded:
 * 169.254.169.254 is the cloud-instance metadata endpoint on AWS, Azure, and
 * GCP, and allowing plain HTTP there from a `local` connection would expose
 * deployments on those platforms to SSRF.
 */
export function isLocalEndpointHost(hostname: string): boolean {
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;

  // 127.0.0.0/8 (full loopback range, not just 127.0.0.1)
  if (/^127\./.test(hostname)) return true;

  // RFC-1918 — 10.0.0.0/8
  if (/^10\./.test(hostname)) return true;
  // RFC-1918 — 172.16.0.0/12 (172.16–172.31)
  const m172 = hostname.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  // RFC-1918 — 192.168.0.0/16
  if (/^192\.168\./.test(hostname)) return true;

  // IPv6 ULA fc00::/7 — strip brackets, lowercase
  const ipv6 = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^f[cd]/.test(ipv6)) return true;

  return false;
}

/** Value-free routing stored on the connection, never supplied by an agent binding. */
export const aiProviderRoutingSchema = z
  .object({
    kind: z.enum(["openrouter", "bedrock", "gateway", "local"]),
    protocol: z.enum(["responses", "messages", "chat", "bedrock"]),
    baseUrl: z.string().trim().max(2048).optional(),
    auth: z
      .enum(["bearer", "api_key", "none"])
      .default("bearer"),
    region: z
      .string()
      .regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/)
      .optional(),
    models: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(256),
            label: z.string().trim().max(160).optional(),
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict()
  .superRefine((route, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (route.kind === "bedrock") {
      if (
        route.protocol !== "bedrock" ||
        !route.region ||
        route.auth !== "bearer" ||
        route.baseUrl
      )
        invalid(
          "Bedrock requires a region and a Bedrock API key.",
        );
    } else if (
      route.protocol === "bedrock" ||
      route.region
    )
      invalid("AWS settings require Bedrock.");
    if (
      route.kind === "openrouter" &&
      (route.baseUrl || route.auth !== "bearer")
    )
      invalid("OpenRouter uses its official endpoint and an API key.");
    if (route.auth === "api_key" && route.protocol !== "messages")
      invalid("API-key header authentication requires Anthropic Messages.");
    if (route.kind === "gateway" || route.kind === "local") {
      try {
        const url = new URL(route.baseUrl ?? "");
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        const localHost = route.kind === "local" ? isLocalEndpointHost(url.hostname) : loopback;
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          (url.protocol !== "https:" && !(url.protocol === "http:" && localHost))
        )
          throw new Error();
        if (route.kind === "local" && !localHost)
          invalid("A local endpoint must use a loopback or private-network address.");
      } catch {
        invalid(
          "Enter an HTTPS base URL without credentials, query parameters, or a fragment. Local endpoints may use HTTP.",
        );
      }
    }
  });
export type AiProviderRouting = z.infer<typeof aiProviderRoutingSchema>;
export function aiRoutingHarness(
  adapter: string,
  provider?: unknown,
  acpxAgent?: unknown,
): string {
  if (adapter !== "paperclip_runner") return adapter;
  if (provider === "acpx" && acpxAgent === "copilot") return "copilot_runtime";
  if (provider === "acpx" && acpxAgent === "antigravity") return "antigravity_runtime";
  const runner =
    provider === "acpx" && ["claude", "grok", "pi"].includes(String(acpxAgent))
      ? acpxAgent
      : provider;
  return (
    (
      {
        claude: "claude_local",
        codex: "codex_local",
        opencode: "opencode_local",
        grok: "grok_local",
        pi: "pi_local",
      } as Record<string, string>
    )[String(runner)] ?? "unsupported"
  );
}
export function isAiRoutingCompatible(
  route: AiProviderRouting,
  harness: string,
): boolean {
  if (route.kind === "bedrock") return harness === "claude_local";
  if (route.kind === "openrouter")
    return [
      "claude_local",
      "codex_local",
      "opencode_local",
      "pi_local",
      "hermes_local",
    ].includes(harness);
  if (route.protocol === "responses") return harness === "codex_local";
  if (route.protocol === "messages") return harness === "claude_local";
  return ["opencode_local", "hermes_local"].includes(harness);
}
export function aiRoutingBaseUrl(
  route: AiProviderRouting,
  harness: string,
): string {
  return route.kind === "openrouter"
    ? `https://openrouter.ai/api${harness === "claude_local" ? "" : "/v1"}`
    : (route.baseUrl ?? "").replace(/\/+$/, "");
}

export function aiRoutingModel(
  route: AiProviderRouting,
  harness: string,
  model: string,
): string {
  if (!model || (harness !== "opencode_local" && !(harness === "pi_local" && route.kind === "openrouter"))) return model;
  const prefix = route.kind === "openrouter" ? "openrouter" : "paperclip";
  return model.startsWith(`${prefix}/`) ? model : `${prefix}/${model}`;
}

/** Catalog identity is derived from routing, including accounts saved before these rows existed. */
export function aiConnectionCatalogSlug(provider: string, routing?: Pick<AiProviderRouting, "kind" | "protocol">): string {
  if (routing?.kind === "gateway") {
    return routing.protocol === "messages" ? "messages-api"
      : routing.protocol === "chat" ? "chat-completions-api" : "responses-api";
  }
  return routing?.kind ?? provider;
}

/** Direct catalog setup presets; legacy gateway links still open their existing setup. */
export function aiProviderSetupPreset(source: string | null): {
  provider: "openrouter" | "bedrock" | "gateway" | "local" | "google";
  protocol?: AiProviderRouting["protocol"];
  label?: string;
} | undefined {
  switch (source) {
    case "responses-api": return { provider: "gateway", protocol: "responses", label: "Responses API" };
    case "messages-api": return { provider: "gateway", protocol: "messages", label: "Messages API" };
    case "chat-completions-api": return { provider: "gateway", protocol: "chat", label: "Chat Completions API" };
    case "google-ai": return { provider: "google" };
    case "google": case "openrouter": case "bedrock": case "gateway": case "local": return { provider: source };
    default: return undefined;
  }
}
