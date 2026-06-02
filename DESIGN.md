# leah-20260602

## Vision

This app is a simple entity search. A user can enter an entity name, the entity is resolved, and the user sees the name of the entity and see properties and relationships associated with that flavor. The user can then click on a property/relationship and find the values associated with the entity. We show max 5 values. We try to optimize query time when deciding what to display.

## Status

Built. Two pages, two server endpoints, all data fetched through the Portal Gateway's Query Server proxy. See "Modules" below for the runtime flow.

## Modules

### Entity search (home)

`pages/index.vue` — hero landing with a single search field. Debounced
(250 ms) type-ahead calls `GET /api/entity/search?q=…&limit=8` and shows
matches in a dropdown card with flavor chip + NEID. Keyboard navigation
(↑/↓/Enter) is wired in. Selecting a match navigates to
`/entity/{neid}?flavor=…&name=…`.

`server/api/entity/search.get.ts` — same-origin wrapper around
`POST {gateway}/entities/search`. Keeps the QS API key on the server.

### Entity detail

`pages/entity/[neid].vue` — shows the entity's name + flavor chip, then
renders every property and relationship that has values, sorted with
scalar properties first and relationships last. Each property is an
expansion panel; expanding it shows up to 5 distinct values. For
`data_nindex` relationships the linked entity's resolved display name is
shown, and the row links to that entity's detail page — so a user can
traverse the graph by clicking through relationships.

`server/api/entity/[neid].get.ts` — returns the entity-detail payload
(name + flavor + properties + capped values, with relationship refs
resolved to names). Delegates to `exploreEntity()`.

`server/utils/entityExplorer.ts` — the query-time optimization lives
here. The brief asks us to "optimize query time when deciding what to
display"; we do it in two batched network round trips total. First we
fetch the schema once (cached in-process) and pre-compute a `flavor →
applicable properties` map using each property's `domain_flavors`. For
an `organization` that filters 904 schema PIDs down to ~443 relevant
ones — the rest are domain-irrelevant (person-only, document-only, etc.)
and never need to be queried. Second we fire ONE `POST
/elemental/entities/properties` call with all applicable PIDs, then on
the server we dedup the response by `(pid, value)`, drop properties with
zero values (no UI noise), cap at 5 distinct values per property, and
resolve any `data_nindex` reference NEIDs in a single batched
name-lookup call. The compact response shipped to the browser is just
the properties that actually have data.

This approach is meaningfully cheaper than the alternative ("list all
443 property names, fetch values lazily on click") for three reasons.
Each round trip is dominated by gateway/QS latency, not per-PID cost, so
batching is a clear win. Filtering by `domain_flavors` server-side means
we never ask the QS about properties that physically can't apply to
this entity (a quiet but huge save on the cold path). And dedup happens
before the wire, so the ~74k-row Microsoft response becomes ~150
properties × ≤5 values once it reaches the client.

### Boilerplate kept as-is

The `/login`, `/a0callback`, `/logout`, `/pending`, `/chat`,
`/prefs-demo`, and settings-dialog scaffolding from the Aether starter
is untouched — auth is wired through it, and reusing the components
means the app gets the standard Lovelace header + dark theme without
extra work.
