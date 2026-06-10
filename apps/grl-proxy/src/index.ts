/**
 * grl-proxy — public type surface.
 *
 * This package exports type contracts only. No server, no network listener,
 * no runtime implementation. See README.md for the intended architecture.
 */
export type {
  ClientType,
  ClientTypeSource,
  ClientIdentity,
  GatewayMode,
  BridgeRequest,
  BridgeResponse,
  GrlBridge,
  GrlProxyConfig,
  OpenAICompatToolCall,
  OpenAICompatResponseFragment,
  McpAdapterInterface,
  WrapperOptions,
  InjectedEnv,
} from './types.js';
