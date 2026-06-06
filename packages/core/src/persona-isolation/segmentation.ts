import type {
  PersonaCategory,
  InterestSegmentationPolicy,
  SearchPersona
} from './types.js'
import {
  DEFAULT_SEGMENTATION_POLICY,
  HIGH_RISK_CATEGORIES
} from './types.js'

/**
 * The result of evaluating whether an interest segmentation action is needed.
 */
export interface SegmentationEvaluation {
  /** True when the engine determines a category change occurred. */
  categoryChanged: boolean
  /** True when the new category is considered high-risk. */
  isHighRisk: boolean
  /** True when the current persona is saturated (search count ≥ max). */
  isSaturated: boolean
  /** True when the engine recommends creating / rotating to a fresh persona. */
  shouldRotate: boolean
  reason: string
}

/**
 * InterestSegmentationEngine — determines when a persona rotation or isolation
 * escalation is required based on category changes and search-count saturation.
 *
 * Constraints:
 *  - No NLP, no AI, no semantic classification.
 *  - The caller supplies `categoryHint`; the engine only applies the policy.
 *  - Deterministic, in-memory, fail-closed.
 */
export class InterestSegmentationEngine {
  private readonly policy: InterestSegmentationPolicy

  constructor(policy: InterestSegmentationPolicy = DEFAULT_SEGMENTATION_POLICY) {
    this.policy = { ...policy }
  }

  /**
   * Evaluate whether a persona rotation or isolation escalation is needed.
   *
   * @param persona         Current active persona for the agent (may be undefined
   *                        when no persona exists yet).
   * @param requestedCategory  The category hint provided by the caller.
   */
  evaluate(
    persona: SearchPersona | undefined,
    requestedCategory: PersonaCategory
  ): SegmentationEvaluation {
    if (!this.policy.enabled) {
      return {
        categoryChanged: false,
        isHighRisk: false,
        isSaturated: false,
        shouldRotate: false,
        reason: 'segmentation_disabled'
      }
    }

    const isHighRisk = (HIGH_RISK_CATEGORIES as readonly string[]).includes(requestedCategory)

    // No current persona → create fresh one.
    if (persona === undefined) {
      return {
        categoryChanged: false,
        isHighRisk,
        isSaturated: false,
        shouldRotate: true,
        reason: 'no_active_persona'
      }
    }

    const categoryChanged = persona.category !== requestedCategory
    const isSaturated = persona.searchCount >= this.policy.maxSearchesPerPersona

    if (isSaturated) {
      return {
        categoryChanged,
        isHighRisk,
        isSaturated: true,
        shouldRotate: true,
        reason: 'persona_saturated'
      }
    }

    if (categoryChanged && this.policy.forceRotationOnCategoryChange) {
      return {
        categoryChanged: true,
        isHighRisk,
        isSaturated: false,
        shouldRotate: true,
        reason: 'category_change'
      }
    }

    if (isHighRisk && this.policy.isolateHighRiskCategories) {
      // High-risk category with no category change but needs strict isolation.
      return {
        categoryChanged,
        isHighRisk: true,
        isSaturated: false,
        shouldRotate: false,
        reason: 'high_risk_category_isolation'
      }
    }

    return {
      categoryChanged,
      isHighRisk,
      isSaturated: false,
      shouldRotate: false,
      reason: 'reuse_allowed'
    }
  }

  /** Return a defensive copy of the active policy. */
  getPolicy(): InterestSegmentationPolicy {
    return { ...this.policy }
  }
}
