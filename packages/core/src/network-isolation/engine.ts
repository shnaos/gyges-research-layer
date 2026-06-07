/**
 * NetworkIsolationEngine — Sprint 30.
 *
 * Deterministic, in-memory engine for the logical relay / route abstraction.
 * It assigns each compartment a stable logical route, rotates routes on
 * persona / category / critical-risk changes, and produces fail-closed
 * {@link RouteSelectionDecision}s.
 *
 * It is metadata only: NO real Tor, proxy, VPN, SOCKS, DNS resolver, browser,
 * or network egress; NO IP / host / URL / DNS name / endpoint / credential /
 * token / raw input is ever stored. All returned values are defensive copies.
 */

import {
  DEFAULT_DNS_ISOLATION_POLICY,
  DEFAULT_MAX_ROUTES,
  DEFAULT_RELAY_ISOLATION_LEVEL,
  DEFAULT_RELAY_PROFILE_ID,
  DEFAULT_RELAY_ROTATION_POLICY,
  type DnsIsolationPolicy,
  type IsolationContext,
  type NetworkCompartmentBinding,
  type RelayAssignment,
  type RelayIsolationLevel,
  type RelayProfile,
  type RelayRotationPolicy,
  type RelayRoute,
  type RouteSelectionDecision
} from './types.js';

export interface NetworkIsolationEngineOptions {
  /** Injectable clock for deterministic tests. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Maximum retained routes; inactive routes beyond this are evicted FIFO. */
  maxRoutes?: number;
  /** Override the DNS isolation policy. */
  dnsPolicy?: DnsIsolationPolicy;
  /** Override the relay rotation policy. */
  rotationPolicy?: RelayRotationPolicy;
  /** Seed the bootstrap `local-default` relay profile (default true). */
  seedDefaultProfile?: boolean;
}

function cloneProfile(p: RelayProfile): RelayProfile {
  return { ...p, tags: [...p.tags] };
}
function cloneRoute(r: RelayRoute): RelayRoute {
  return { ...r };
}
function cloneBinding(b: NetworkCompartmentBinding): NetworkCompartmentBinding {
  return { ...b };
}

export class NetworkIsolationEngine {
  private readonly _profiles = new Map<string, RelayProfile>();
  private readonly _routes = new Map<string, RelayRoute>();
  private readonly _bindings = new Map<string, NetworkCompartmentBinding>();
  /** Per-compartment route (re)assignment counter. */
  private readonly _assignmentCounts = new Map<string, number>();
  private readonly now: () => number;
  private readonly maxRoutes: number;
  private _dnsPolicy: DnsIsolationPolicy;
  private _rotationPolicy: RelayRotationPolicy;
  private _routeCounter = 0;

  constructor(options: NetworkIsolationEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    const requested = options.maxRoutes ?? DEFAULT_MAX_ROUTES;
    this.maxRoutes = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : DEFAULT_MAX_ROUTES;
    this._dnsPolicy = { ...(options.dnsPolicy ?? DEFAULT_DNS_ISOLATION_POLICY) };
    this._rotationPolicy = { ...(options.rotationPolicy ?? DEFAULT_RELAY_ROTATION_POLICY) };

    if (options.seedDefaultProfile !== false) {
      this.registerRelayProfile({
        id: DEFAULT_RELAY_PROFILE_ID,
        name: 'Local Default Relay',
        enabled: true,
        isolationLevel: DEFAULT_RELAY_ISOLATION_LEVEL,
        supportsDnsIsolation: true,
        tags: ['local', 'default'],
        createdAt: this.now()
      });
    }
  }

  // ── Relay profiles ────────────────────────────────────────────────────────

  /** Register a relay profile. Throws if the id is already registered. */
  registerRelayProfile(profile: RelayProfile): void {
    if (this._profiles.has(profile.id)) {
      throw new Error(`NetworkIsolationEngine: relay profile "${profile.id}" is already registered.`);
    }
    this._profiles.set(profile.id, cloneProfile(profile));
  }

  /** List relay profiles (defensive copies), optionally limited. */
  listRelayProfiles(limit?: number): RelayProfile[] {
    const all = Array.from(this._profiles.values()).map(cloneProfile);
    return this.applyLimit(all, limit);
  }

  // ── Policies ──────────────────────────────────────────────────────────────

  getDnsPolicy(): DnsIsolationPolicy {
    return { ...this._dnsPolicy };
  }
  setDnsPolicy(policy: DnsIsolationPolicy): void {
    this._dnsPolicy = { ...policy };
  }
  getRotationPolicy(): RelayRotationPolicy {
    return { ...this._rotationPolicy };
  }
  setRotationPolicy(policy: RelayRotationPolicy): void {
    this._rotationPolicy = { ...policy };
  }

  // ── Route assignment ──────────────────────────────────────────────────────

  /**
   * Assign a fresh logical route to a compartment and bind it. Deactivates any
   * prior active route for that compartment (so a compartment always has exactly
   * one active route). Returns the assignment metadata.
   */
  assignRoute(context: IsolationContext): RelayAssignment {
    const profile = this.firstEnabledProfile();
    if (profile === undefined) {
      throw new Error('NetworkIsolationEngine: no enabled relay profile available.');
    }
    // Deactivate the compartment's current active route, if any.
    for (const route of this._routes.values()) {
      if (route.compartmentId === context.compartmentId && route.active) {
        route.active = false;
      }
    }

    const isolationLevel = context.isolationLevel ?? profile.isolationLevel ?? DEFAULT_RELAY_ISOLATION_LEVEL;
    const at = this.now();
    this._routeCounter += 1;
    const routeId = `route-${String(this._routeCounter).padStart(3, '0')}`;
    const route: RelayRoute = {
      id: routeId,
      relayProfileId: profile.id,
      compartmentId: context.compartmentId,
      ...(context.personaId !== undefined ? { personaId: context.personaId } : {}),
      ...(context.fragmentId !== undefined ? { fragmentId: context.fragmentId } : {}),
      assignedAt: at,
      active: true
    };
    this._routes.set(routeId, route);
    this._bindings.set(context.compartmentId, {
      compartmentId: context.compartmentId,
      relayRouteId: routeId,
      isolationLevel,
      createdAt: at
    });
    const count = (this._assignmentCounts.get(context.compartmentId) ?? 0) + 1;
    this._assignmentCounts.set(context.compartmentId, count);
    this.pruneRoutes();

    return {
      routeId,
      relayProfileId: profile.id,
      compartmentId: context.compartmentId,
      ...(context.personaId !== undefined ? { personaId: context.personaId } : {}),
      ...(context.fragmentId !== undefined ? { fragmentId: context.fragmentId } : {}),
      isolationLevel,
      assignmentCount: count,
      assignedAt: at,
      rotated: count > 1
    };
  }

  /** Return the active route bound to a compartment, or undefined. */
  resolveRoute(compartmentId: string): RelayRoute | undefined {
    const binding = this._bindings.get(compartmentId);
    if (binding === undefined) return undefined;
    const route = this._routes.get(binding.relayRouteId);
    return route !== undefined && route.active ? cloneRoute(route) : undefined;
  }

  /** Rotate a compartment to a brand-new route. Returns the new assignment. */
  rotateRoute(context: IsolationContext): RelayAssignment {
    return this.assignRoute(context);
  }

  /** List routes (defensive copies), optionally limited (most recent first). */
  listRoutes(limit?: number): RelayRoute[] {
    const all = Array.from(this._routes.values()).map(cloneRoute).reverse();
    return this.applyLimit(all, limit);
  }

  /** List compartment bindings (defensive copies), optionally limited. */
  listBindings(limit?: number): NetworkCompartmentBinding[] {
    const all = Array.from(this._bindings.values()).map(cloneBinding);
    return this.applyLimit(all, limit);
  }

  /** Return the binding for a compartment, or undefined. */
  getBinding(compartmentId: string): NetworkCompartmentBinding | undefined {
    const b = this._bindings.get(compartmentId);
    return b !== undefined ? cloneBinding(b) : undefined;
  }

  // ── Isolation decision ──────────────────────────────────────────────────────

  /**
   * Evaluate the network-isolation decision for a request. Fail-closed:
   *  - quarantined compartment    → denied
   *  - transport disabled         → denied
   *  - no enabled relay available → denied
   *
   * Otherwise ensures the compartment has a route (assigning one on first
   * sight), rotates it when the rotation policy demands, and returns the
   * effective route. Deterministic for identical inputs.
   */
  evaluateIsolation(context: IsolationContext): RouteSelectionDecision {
    if (context.quarantined === true) {
      return this.deny('Compartment quarantined; network isolation fail-closed.');
    }
    if (context.transportEnabled === false) {
      return this.deny('Outbound transport disabled; network isolation fail-closed.');
    }
    const profile = this.firstEnabledProfile();
    if (profile === undefined) {
      return this.deny('No enabled relay available; network isolation fail-closed.');
    }

    const existing = this.resolveRoute(context.compartmentId);
    let routeId: string;
    let isolationLevel: RelayIsolationLevel;
    let rotated = false;
    let reason: string;

    if (existing === undefined) {
      const assignment = this.assignRoute(context);
      routeId = assignment.routeId;
      isolationLevel = assignment.isolationLevel;
      reason = `Assigned isolated relay route for compartment "${context.compartmentId}".`;
    } else if (this.shouldRotate(context)) {
      const assignment = this.rotateRoute(context);
      routeId = assignment.routeId;
      isolationLevel = assignment.isolationLevel;
      rotated = true;
      reason = `Rotated relay route for compartment "${context.compartmentId}" (${this.rotationReason(context)}).`;
    } else {
      routeId = existing.id;
      isolationLevel = this._bindings.get(context.compartmentId)?.isolationLevel ?? profile.isolationLevel;
      reason = `Reused stable relay route for compartment "${context.compartmentId}".`;
    }

    return {
      allowed: true,
      relayProfileId: profile.id,
      relayRouteId: routeId,
      isolationLevel,
      shouldRotate: rotated,
      reason
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private deny(reason: string): RouteSelectionDecision {
    return {
      allowed: false,
      isolationLevel: DEFAULT_RELAY_ISOLATION_LEVEL,
      shouldRotate: false,
      reason
    };
  }

  private firstEnabledProfile(): RelayProfile | undefined {
    for (const p of this._profiles.values()) {
      if (p.enabled) return p;
    }
    return undefined;
  }

  private shouldRotate(context: IsolationContext): boolean {
    const policy = this._rotationPolicy;
    if (!policy.enabled) return false;
    if (policy.rotateOnPersonaChange && context.personaRotated === true) return true;
    if (policy.rotateOnCategoryChange && context.categoryChanged === true) return true;
    if (policy.rotateOnCriticalRisk && context.criticalRisk === true) return true;
    // Implicit persona / category change: the incoming persona scope differs
    // from the scope bound to the compartment's active route. This is what
    // drives rotation in the live pipeline (the gate passes the research
    // category as personaId), so a compartment that switches research topics
    // does not keep aggregating interest on one route.
    if (policy.rotateOnPersonaChange || policy.rotateOnCategoryChange) {
      const binding = this._bindings.get(context.compartmentId);
      if (binding !== undefined) {
        const route = this._routes.get(binding.relayRouteId);
        if (route !== undefined && (route.personaId ?? undefined) !== (context.personaId ?? undefined)) {
          return true;
        }
      }
    }
    const count = this._assignmentCounts.get(context.compartmentId) ?? 0;
    if (count >= policy.maxAssignmentsPerRoute) return true;
    return false;
  }

  private rotationReason(context: IsolationContext): string {
    if (context.personaRotated === true) return 'persona rotation';
    if (context.categoryChanged === true) return 'category change';
    if (context.criticalRisk === true) return 'critical risk';
    return 'assignment ceiling reached';
  }

  /** Evict oldest INACTIVE routes when the store exceeds maxRoutes (FIFO). */
  private pruneRoutes(): void {
    if (this._routes.size <= this.maxRoutes) return;
    for (const [id, route] of this._routes) {
      if (this._routes.size <= this.maxRoutes) break;
      if (!route.active) this._routes.delete(id);
    }
  }

  private applyLimit<T>(items: T[], limit?: number): T[] {
    if (limit === undefined) return items;
    if (!Number.isFinite(limit) || limit < 0) return items;
    return items.slice(0, Math.floor(limit));
  }
}
