# Gyges Research Layer — Sprint 34: Mock/Runtime Ambiguity Elimination

## Objectif

Éliminer toute ambiguïté mock/runtime dans GRL. Aucun endpoint, SDK, CLI ou exemple ne doit laisser croire qu'un mock est une exécution réelle.

---

## Décisions appliquées

| # | Décision | État |
|---|---|---|
| 1 | `/v1/capabilities/execute` fait uniquement de l'exécution réelle ou retourne une erreur claire | ✓ Préexistant (Sprint 33) + marqueur `mocked: false` ajouté |
| 2 | `/v1/capabilities/execute-mock` réservé aux tests internes/dry-run explicites | ✓ Marqueurs explicites ajoutés sur la réponse `allowed` |
| 3 | `mockFallbackEnabled` jamais activé dans un chemin utilisateur par défaut | ✓ Confirmé — default `false`, jamais passé dans `startLocalApiServer` |
| 4 | Toute sortie mock porte `mocked: true`, `transport: "mock"`, `warning: "This is not a real execution"` | ✓ Implémenté |
| 5 | CLI et SDK échouent clairement si aucun vrai transport n'est configuré | ✓ CLI : refusé à la firewall (tool `web_search` sans règle allow). SDK : `decision: denied` (Sprint 33) |

---

## Changements apportés

### `apps/grl-server/src/api-contract.ts`

**`ExecuteMockCapabilityHttpResponse`** — trois champs ajoutés :

```typescript
/** Sprint 34 — true when the execution result was produced by MockTransportAdapter (no real network). */
mocked: boolean;                 // required on ALL responses from both endpoints
transport?: 'mock';              // present only when mocked: true
warning?: string;                // present only when mocked: true
```

Le champ `mocked` est **requis** sur les deux endpoints (via l'alias `ExecuteCapabilityHttpResponse = ExecuteMockCapabilityHttpResponse`). Cela force le compilateur TypeScript à vérifier chaque site de réponse — zéro erreur résiduelle possible sans intervention manuelle.

Commentaire obsolète corrigé : "Falls back to mock when no real transport is configured" → suppressé, remplacé par la description du comportement Sprint 33+.

### `apps/grl-server/src/local-api.ts`

Trente (30) sites de réponse mis à jour :

**execute-mock endpoint** (handler + closure `resolveDefense`) :
- 16 réponses `denied`/`pending` : `mocked: false` ajouté — aucune exécution n'a eu lieu, le refus ne simule rien
- 1 réponse `allowed` : `mocked: true, transport: 'mock', warning: 'This is not a real execution'` — seule réponse qui simule réellement une exécution

**execute endpoint** (handler + closure `resolveDefenseForExecute`) :
- 13 réponses `denied`/`pending` : `mocked: false` ajouté — inclut les guards Sprint 33 (transport mock, searxng désactivé, unknown transport)
- 1 réponse `allowed` : `mocked: resolvedKind === 'mock'` + champs conditionnels — `false` pour SearXNG réel, `true` seulement si `mockFallbackEnabled: true` (opt-in dev offline)

### `examples/quickstart/cli-demo.sh`

Label corrigé : "Search (mock transport, no real network)" → "Search (denied at firewall — requires SearXNG + allow rule to proceed)"

La CLI envoie `tool: 'web_search'` qui n'a aucune règle allow dans le bootstrap — le refus se produit à la firewall, avant même le layer transport. Ce n'est pas un refus de transport, c'est un refus de capability.

### `apps/grl-server/test/execute-convergence.test.ts`

4 tests de non-régression ajoutés (describe : `Sprint 34 mock markers`) :

1. `execute-mock allowed response carries mocked:true, transport, warning` — vérifie les trois marqueurs sur la réponse allowed
2. `execute-mock denied response carries mocked:false` — vérifie qu'un refus par la firewall (search à high risk) retourne `mocked: false`
3. `execute denied response (no real transport) carries mocked:false` — vérifie que le guard Sprint 33 retourne `mocked: false`
4. `execute allowed via mockFallbackEnabled carries mocked:true, warning` — vérifie les marqueurs sur le chemin opt-in mock

---

## Audit des chemins mock restants

| Chemin mock | Localisation | Justification |
|---|---|---|
| `MockTransportAdapter` | `packages/core/src/execution/mock-transport.ts` | TEST_ONLY / DEV_ONLY — substrate d'exécution pour `execute-mock` et tous les tests offline. Suppression impossible sans casser le workflow dry-run. |
| `buildMockExecutionEngine()` | `packages/core/src/execution/engine.ts` | TEST_ONLY / DEV_ONLY — factory qui câble `MockTransportAdapter`. Utilisé par `execute-mock` et les tests. |
| `/v1/capabilities/execute-mock` endpoint | `apps/grl-server/src/local-api.ts` | DEV_ONLY, EXPLICITE — pipeline complet (policy + privacy + fingerprint) sur transport mock. Porte maintenant `mocked: true` + `warning` sur chaque réponse `allowed`. Marqueur visible immédiatement, sans lire `execution.transportKind`. |
| Bootstrap transport policy : `preferredTransport: 'mock'` | `packages/core/src/transport-policy/bootstrap.ts` | ACCEPTABLE — ces règles alimentent correctement `execute-mock`. L'endpoint `execute` les intercepte avec le guard Sprint 33. |
| `execute` avec `mockFallbackEnabled: true` | `apps/grl-server/src/local-api.ts` | DEV_ONLY, OPT-IN EXPLICITE — non activé dans `startLocalApiServer`. Porte maintenant `mocked: true` + `warning`. |
| `examples/multi-agent/concurrent-agents.ts` : appel `execute-mock` | `examples/multi-agent/` | DEV_EXAMPLE — appel explicite à l'endpoint `/v1/capabilities/execute-mock` pour initialiser l'état agent en dev. La réponse porte désormais `mocked: true` + `warning`. |

---

## Preuve : execute ne peut plus retourner de faux résultat sans marqueur

L'interface `ExecuteMockCapabilityHttpResponse` définit `mocked: boolean` comme champ **requis**. L'alias `ExecuteCapabilityHttpResponse = ExecuteMockCapabilityHttpResponse` partage ce même type. Le compilateur TypeScript avec `strict: true` échoue à la compilation si un site de réponse omet ce champ.

Chemin `execute` → `allowed` (ligne ~5100 dans `local-api.ts`) :

```typescript
const isMockedExecution = resolvedKind === 'mock';
const response: ExecuteCapabilityHttpResponse = {
  decision: 'allowed',
  mocked: isMockedExecution,
  ...(isMockedExecution ? { transport: 'mock' as const, warning: 'This is not a real execution' } : {}),
  // ...
};
```

`resolvedKind === 'mock'` n'est `true` que si `mockFallbackEnabled: true`. Sans ce flag (la valeur par défaut) :
- Le guard Sprint 33 (`else if (resolvedKind === 'mock' && !mockFallbackEnabled)`) intercepte et retourne `decision: 'denied', mocked: false`
- Le chemin `allowed` n'est jamais atteint avec `resolvedKind === 'mock'` dans la configuration par défaut

---

## Preuve : CLI et SDK échouent clairement sans transport réel

**CLI** (`grl search "..."`) :
- Envoie `tool: 'web_search'`
- La bootstrap firewall n'a aucune règle allow pour `web_search`
- Refus à la **capability firewall** layer (avant même le layer transport)
- Réponse : `decision: 'denied', mocked: false, reason: '<firewall reason>'`
- Le refus est clair — mais il vient de l'absence de règle firewall, pas de l'absence de transport

**SDK** (`.search('query')`) :
- Envoie `tool: 'search'`
- Passe la firewall (règle allow `local-agent/search/low`)
- Transport policy résout → `'mock'`
- Guard Sprint 33 → `decision: 'denied', mocked: false, reason: 'No real transport configured...'`
- Réponse claire, actionnables (message indique SearXNG + execute-mock)

---

## Validation

```
npm run typecheck  → clean (0 errors)
npm run build      → clean
npm test           → 1201 tests passed (68 test files)  [+4 nouveaux]
npm run smoke-test → all smoke tests passed
npm run release-check → Release check passed. Ready for packaging.
```
