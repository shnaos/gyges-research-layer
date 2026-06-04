/**
 * CapabilityFirewall — the mandatory entry point between an AI agent and any
 * external capability.
 *
 * The firewall owns no business logic of its own: it delegates the decision to
 * a {@link PolicyEngine}, which is deny-by-default. This keeps the entry point
 * stable while the decision core stays small and testable.
 */

import { PolicyEngine } from '../policy-engine/policy-engine.js';
import { CapabilityDecision, CapabilityRequest } from './types.js';

export class CapabilityFirewall {
  constructor(private readonly engine: PolicyEngine) {}

  /** Evaluate a capability request and return a deterministic decision. */
  evaluate(request: CapabilityRequest): CapabilityDecision {
    return this.engine.evaluate(request);
  }
}
