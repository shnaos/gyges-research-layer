/**
 * Transport Capability Registry & Adapter Sandbox MVP — public surface.
 *
 * Sprint 10 contracts and the deterministic, in-memory
 * {@link TransportCapabilityRegistry}. No real network, browser, DNS, socket,
 * filesystem, process, persistence, or dynamic plugin behaviour is exposed here.
 */

export type {
  AdapterSandboxPermission,
  SandboxDecisionAction,
  TransportManifest,
  AdapterSandboxPolicy,
  SandboxViolation,
  SandboxDecision,
  TransportCapabilityAudit,
  TransportRegistryErrorKind
} from './types.js';

export {
  TransportCapabilityRegistry,
  TransportRegistryError
} from './registry.js';

export {
  BOOTSTRAP_MOCK_MANIFEST,
  STRICT_SANDBOX_POLICY,
  BOOTSTRAP_TRANSPORT_MANIFESTS,
  SEARXNG_TRANSPORT_MANIFEST,
  SEARXNG_SANDBOX_POLICY
} from './bootstrap.js';
