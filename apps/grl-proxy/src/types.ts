/**
 * GRL Proxy — type contracts only.
 *
 * This file defines the interfaces and types that future gateway adapters
 * (HTTP proxy, OpenAI-compatible endpoint, MCP adapter, CLI wrapper) will use
 * to communicate with the GRL Local API runtime.
 *
 * Nothing in this file starts a server, opens a socket, or makes a network
 * call. This is a stable type boundary, not an implementation.
 *
 * Runtime policy evaluation lives exclusively in apps/grl-server (port 8787).
 * grl-proxy is a thin adapter — it translates incoming client protocols into
 * GrlBridge calls and forwards the result. No policy logic is duplicated here.
 */

// ---------------------------------------------------------------------------
// Client type classification — metadata only, zero security implications
// ---------------------------------------------------------------------------

/**
 * Classification of the agent client connecting to GRL.
 *
 * IMPORTANT: ClientType is metadata only.
 * - It is non-authoritative and trivially spoofable via User-Agent.
 * - It grants NO permissions automatically.
 * - All capability permissions come from the explicit per-agent policy
 *   registered by the operator in the GRL runtime config.
 * - A client claiming to be 'aider' that has no registered policy gets denied
 *   exactly as if it were 'unknown'.
 * - Detection purpose: audit labeling and operator-facing UI hints only.
 */
export type ClientType =
  | 'aider'
  | 'claude-code'
  | 'opencode'
  | 'hermes'
  | 'openai-compatible'
  | 'cursor-like'
  | 'grl-sdk'
  | 'mcp-client'
  | 'unknown';

/** How the ClientType was inferred. */
export type ClientTypeSource = 'user-agent' | 'x-grl-client-header' | 'explicit' | 'inference';

/**
 * Result of client type detection.
 * detectedFrom documents the signal used — helps operators debug policy
 * binding issues without assuming the type is authoritative.
 */
export interface ClientIdentity {
  clientType: ClientType;
  detectedFrom: ClientTypeSource;
  /** The raw value that was used for detection (User-Agent string, etc.). */
  raw: string;
}

// ---------------------------------------------------------------------------
// Gateway operating modes — future entry points into GRL
// ---------------------------------------------------------------------------

/**
 * The four operating modes through which an agent can interact with GRL.
 * Modes are not mutually exclusive; a single GRL instance may expose several.
 */
export type GatewayMode =
  | 'sdk'      // Agents call GRL directly via @gyges/agent-sdk or HTTP API
  | 'tool'     // Tool-call interception surface (OpenAI-compatible or generic)
  | 'proxy'    // HTTP forward proxy (HTTP_PROXY / HTTPS_PROXY env vars)
  | 'wrapper'; // Process wrapper (grl exec -- aider, env injection)

// ---------------------------------------------------------------------------
// Bridge interface — the only surface grl-proxy uses to talk to GRL runtime
// ---------------------------------------------------------------------------

/**
 * A tool-call request submitted by an external agent through a gateway adapter.
 * This is the normalised form — every adapter (proxy, MCP, OpenAI-compat)
 * translates its protocol-specific request into this shape before calling GrlBridge.
 */
export interface BridgeRequest {
  /** Agent identifier — must match a registered agent in the GRL runtime config. */
  agentId: string;
  /** Compartment identifier — must match a registered compartment. */
  compartmentId: string;
  /** The requested capability. Open string; GRL's registry decides if it's known. */
  tool: string;
  /** Caller-declared risk level. Policy may override. */
  riskLevel: 'low' | 'medium' | 'high';
  /** Tool input parameters. GRL may sanitise or audit these; they are never stored raw. */
  input: Record<string, unknown>;
  /** Detected client classification. Metadata only — does not affect the policy decision. */
  clientIdentity?: ClientIdentity;
}

/**
 * The policy decision returned by the GRL runtime for a BridgeRequest.
 * Tri-state: allowed / pending / denied. Never a boolean.
 */
export interface BridgeResponse {
  decision: 'allowed' | 'pending' | 'denied';
  /** Present when decision === 'allowed'; contains the tool execution result. */
  result?: unknown;
  /** Present when decision === 'pending'; the human-approval request ID. */
  approvalRequestId?: string;
  /** Human-readable reason for denial or pending status. */
  reason?: string;
  /** Opaque reference to the audit log entry for this decision. */
  auditRef: string;
}

/**
 * GrlBridge — the stable interface through which gateway adapters communicate
 * with the GRL Local API runtime.
 *
 * Contract:
 * - Implementations call POST /v1/capabilities/execute on the GRL Local API
 *   (default: http://127.0.0.1:8787).
 * - No policy logic is implemented here. GrlBridge forwards and translates;
 *   it never decides.
 * - If the GRL runtime is unreachable, the bridge must fail closed:
 *   return a synthetic 'denied' response rather than allowing the request
 *   through unreviewed.
 * - The bridge is the ONLY channel grl-proxy uses to evaluate requests.
 *   Direct imports of packages/core from grl-proxy are forbidden.
 */
export interface GrlBridge {
  /**
   * Submit a capability request to the GRL runtime for policy evaluation.
   * Never throws — returns a denied BridgeResponse on error.
   */
  evaluate(request: BridgeRequest): Promise<BridgeResponse>;

  /** Check whether the GRL runtime is reachable. */
  health(): Promise<{ ok: boolean; version?: string }>;
}

// ---------------------------------------------------------------------------
// Proxy configuration — future shape for grl-proxy runtime config
// ---------------------------------------------------------------------------

/**
 * Configuration for a future grl-proxy instance.
 * All values are optional; grl-proxy applies conservative defaults.
 */
export interface GrlProxyConfig {
  /** Address and port for the HTTP forward proxy listener. Default: 127.0.0.1:8789 */
  proxyBind?: string;
  /** Address of the GRL Local API runtime. Default: http://127.0.0.1:8787 */
  grlApiBaseUrl?: string;
  /** Request timeout for bridge calls in milliseconds. Default: 5000 */
  bridgeTimeoutMs?: number;
  /**
   * Whether to refuse CONNECT tunnels (HTTPS interception is out of scope for MVP).
   * When true, CONNECT requests return 405 Method Not Allowed.
   * Default: true (HTTPS MITM is not supported in the initial proxy mode).
   */
  refuseConnectTunnels?: boolean;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible surface — contracts only, no implementation
// ---------------------------------------------------------------------------

/**
 * Shape of an incoming OpenAI-compatible chat completion request arriving at
 * grl-proxy's future /v1/chat/completions endpoint.
 *
 * grl-proxy does NOT generate completions. It intercepts the tool_calls
 * emitted by an upstream model and pipes them through GrlBridge before
 * execution. The upstream model call is forwarded as-is.
 *
 * Explicitly NOT implemented:
 * - Streaming (SSE)
 * - Auth key proxying (callers configure their own API keys)
 * - Fake completions (grl-proxy is a gate, not a model)
 */
export interface OpenAICompatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * The subset of an OpenAI chat completion response that grl-proxy inspects
 * to detect tool calls requiring GRL policy evaluation.
 */
export interface OpenAICompatResponseFragment {
  choices?: Array<{
    message?: {
      role: string;
      content: string | null;
      tool_calls?: OpenAICompatToolCall[];
    };
    finish_reason?: string;
  }>;
}

// ---------------------------------------------------------------------------
// MCP adapter contract — isolation rules
// ---------------------------------------------------------------------------

/**
 * The only surface a future MCP adapter may use to communicate with GRL.
 *
 * Isolation rules (enforced by architecture, not by code in this file):
 * 1. packages/mcp-adapter must NOT import from packages/core.
 * 2. packages/core must NOT import from packages/mcp-adapter.
 * 3. The MCP adapter communicates with GRL exclusively via GrlBridge (HTTP).
 * 4. MCP is optional — GRL's test suite must pass with mcp-adapter absent.
 * 5. MCP must not define GRL's core architecture.
 *
 * A future MCP adapter implements this interface and calls bridge.evaluate()
 * for each tool use in an MCP tool_call message.
 */
export interface McpAdapterInterface {
  bridge: GrlBridge;
  /** Translate an MCP tool call into a BridgeRequest and evaluate it. */
  handleToolCall(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: { agentId: string; compartmentId: string }
  ): Promise<BridgeResponse>;
}

// ---------------------------------------------------------------------------
// CLI wrapper — type contracts for future grl exec / grl wrap commands
// ---------------------------------------------------------------------------

/**
 * Options accepted by a future `grl exec -- <cmd>` wrapper command.
 *
 * The wrapper injects GRL_AGENT_ID, GRL_COMPARTMENT_ID, HTTP_PROXY, and
 * HTTPS_PROXY into the child process environment, then spawns the process
 * inheriting stdio. It does not pipe or intercept process output.
 */
export interface WrapperOptions {
  /** Override the agent ID registered for this wrapped session. */
  agentId?: string;
  /** Override the compartment ID for this wrapped session. */
  compartmentId?: string;
  /** GRL runtime profile to apply for this session. */
  profile?: 'strict' | 'balanced' | 'research' | 'development';
  /**
   * When true, skip HTTP proxy injection and use MCP adapter mode instead.
   * Requires grl-proxy (or a future MCP sidecar) to be running.
   */
  useMcp?: boolean;
}

/**
 * The environment variables injected by `grl exec` / `grl wrap` into the
 * wrapped process. These are additive — existing env vars are preserved.
 */
export interface InjectedEnv {
  HTTP_PROXY: string;   // e.g. 'http://127.0.0.1:8789'
  HTTPS_PROXY: string;  // e.g. 'http://127.0.0.1:8789'
  GRL_AGENT_ID: string;
  GRL_COMPARTMENT_ID: string;
  GRL_PROFILE?: string;
}
