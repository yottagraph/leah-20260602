/**
 * Server-side helpers for the entity-search app.
 *
 * Wraps the Query Server REST surface to deliver a single batched
 * "everything we need to render an entity detail page" payload:
 *   1. Look up the entity's display name.
 *   2. Resolve which properties apply to its flavor (from the schema's
 *      `domain_flavors`).
 *   3. Issue ONE batched `getPropertyValues` request for all applicable
 *      PIDs, dedupe by (pid, value), keep up to N distinct values per PID,
 *      and drop properties with no data.
 *   4. Batch-resolve any `data_nindex` reference values to display names.
 *
 * That's two network round trips total — the brief's "we try to optimize
 * query time" requirement — instead of one-per-property on click.
 *
 * Everything here treats NEIDs, EIDs, PIDs, and FIDs as opaque strings;
 * see ../skills/aether/data.md § "The opaque-string ID rule".
 */

import { qsParse, padNeid, resolveEntityNames, isQsConfigured } from './elementalQs';

interface QsCreds {
    base: string;
    apiKey: string;
}

function qsCreds(): QsCreds {
    const pub = (useRuntimeConfig().public ?? {}) as Record<string, string>;
    const gatewayUrl = pub.gatewayUrl;
    const orgId = pub.tenantOrgId;
    const apiKey = pub.qsApiKey;
    if (!gatewayUrl || !orgId || !apiKey) {
        throw createError({
            statusCode: 503,
            statusMessage:
                'Query Server not configured (gatewayUrl / tenantOrgId / qsApiKey missing).',
        });
    }
    return { base: `${gatewayUrl}/api/qs/${orgId}`, apiKey };
}

async function qsFetchText(
    endpoint: string,
    init: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<unknown> {
    const { base, apiKey } = qsCreds();
    const text = await $fetch<string>(`${base}/${endpoint.replace(/^\//, '')}`, {
        method: (init.method as any) ?? 'GET',
        headers: { 'X-Api-Key': apiKey, ...(init.headers ?? {}) },
        body: init.body,
        responseType: 'text',
    });
    return qsParse(text);
}

export interface FullSchemaProperty {
    pid: string;
    name: string;
    type: string;
    displayName?: string;
    description?: string;
    domainFlavors: string[];
    targetFlavors: string[];
}

export interface FullSchema {
    properties: FullSchemaProperty[];
    /** flavor name → list of properties applicable to entities of that flavor */
    propsByFlavor: Map<string, FullSchemaProperty[]>;
}

let schemaCache: FullSchema | null = null;
let schemaCachePromise: Promise<FullSchema> | null = null;

/**
 * Fetch and cache the full schema with `domain_flavors`, `target_flavors`,
 * and display metadata preserved on each property. The shipped
 * `getQsSchema()` helper drops that information; we need it here to filter
 * properties to a specific entity flavor.
 */
export async function getFullSchema(force = false): Promise<FullSchema> {
    if (schemaCache && !force) return schemaCache;
    if (schemaCachePromise && !force) return schemaCachePromise;

    schemaCachePromise = (async () => {
        const res = (await qsFetchText('elemental/metadata/schema')) as any;
        const rawProps: any[] = res?.schema?.properties ?? res?.properties ?? [];
        const properties: FullSchemaProperty[] = rawProps.map((p) => ({
            pid: String(p?.pid ?? p?.id ?? ''),
            name: String(p?.name ?? ''),
            type: String(p?.type ?? p?.datatype ?? ''),
            displayName: p?.display_name ?? undefined,
            description: p?.description ?? undefined,
            domainFlavors: Array.isArray(p?.domain_flavors) ? p.domain_flavors.map(String) : [],
            targetFlavors: Array.isArray(p?.target_flavors) ? p.target_flavors.map(String) : [],
        }));

        const propsByFlavor = new Map<string, FullSchemaProperty[]>();
        for (const p of properties) {
            for (const f of p.domainFlavors) {
                if (!propsByFlavor.has(f)) propsByFlavor.set(f, []);
                propsByFlavor.get(f)!.push(p);
            }
        }
        schemaCache = { properties, propsByFlavor };
        return schemaCache;
    })();

    try {
        return await schemaCachePromise;
    } finally {
        schemaCachePromise = null;
    }
}

export interface ExploredValue {
    /** The raw value string as returned by QS (a 20-char NEID for `data_nindex`). */
    raw: string;
    /** What to render in the UI (resolved entity name for refs, value as-is otherwise). */
    label: string;
    /** Present only for `data_nindex` values — the linked entity's NEID. */
    neid?: string;
}

export interface ExploredProperty {
    pid: string;
    name: string;
    displayName: string;
    type: string;
    /** Whether this is a `data_nindex` reference to another entity. */
    isRelationship: boolean;
    /** For relationships, the flavor(s) of the linked entity. */
    targetFlavors: string[];
    /** Optional schema description. */
    description?: string;
    /** Total distinct values found (may exceed `values.length` if capped). */
    totalDistinct: number;
    /** Up to N distinct values; refs resolved to display names. */
    values: ExploredValue[];
}

export interface ExploredEntity {
    neid: string;
    name: string;
    flavor: string;
    properties: ExploredProperty[];
}

/**
 * Build the entity-detail payload: fetch name + applicable-property values
 * + resolve refs, all in two batched round trips total.
 *
 * @param neid    20-char NEID
 * @param flavor  Entity flavor (e.g. "organization"); we already have it
 *                from the search result, so we don't reverse-lookup it.
 * @param perPropLimit  Max distinct values to retain per property
 *                      (the brief's "max 5 values").
 */
export async function exploreEntity(
    neid: string,
    flavor: string,
    perPropLimit = 5
): Promise<ExploredEntity> {
    if (!isQsConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'Query Server not configured.' });
    }

    const schema = await getFullSchema();
    const applicable = schema.propsByFlavor.get(flavor) ?? [];

    // Look up entity name in parallel with the batched property query.
    const namePromise = (async () => {
        try {
            const r = (await qsFetchText(`entities/${neid}/name`)) as { name?: string };
            return r?.name || neid;
        } catch {
            return neid;
        }
    })();

    let propRows: any[] = [];
    if (applicable.length > 0) {
        const form = new URLSearchParams();
        form.set('eids', JSON.stringify([neid]));
        // Build the pids array via string interpolation, NOT JSON.stringify of
        // numbers — large/negative PIDs would silently round through JS Number.
        form.set('pids', `[${applicable.map((p) => p.pid).join(',')}]`);
        const res = (await qsFetchText('elemental/entities/properties', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        })) as any;
        propRows = res?.values ?? [];
    }

    // Group rows by PID, keep ordered distinct value strings (first-seen wins).
    type Bucket = { values: string[]; seen: Set<string> };
    const byPid = new Map<string, Bucket>();
    for (const row of propRows) {
        const pid = String(row?.pid ?? '');
        const value = row?.value;
        if (!pid || value === null || value === undefined) continue;
        const v = String(value);
        let bucket = byPid.get(pid);
        if (!bucket) {
            bucket = { values: [], seen: new Set() };
            byPid.set(pid, bucket);
        }
        if (bucket.seen.has(v)) continue;
        bucket.seen.add(v);
        bucket.values.push(v);
    }

    // Collect all nindex references that need name resolution, dedup'd.
    const refsToResolve = new Set<string>();
    for (const p of applicable) {
        if (p.type !== 'data_nindex') continue;
        const bucket = byPid.get(p.pid);
        if (!bucket) continue;
        for (const v of bucket.values.slice(0, perPropLimit)) {
            refsToResolve.add(padNeid(v));
        }
    }
    const nameByNeid =
        refsToResolve.size > 0
            ? await resolveEntityNames([...refsToResolve])
            : ({} as Record<string, string>);

    const properties: ExploredProperty[] = [];
    for (const p of applicable) {
        const bucket = byPid.get(p.pid);
        if (!bucket || bucket.values.length === 0) continue;
        const isRelationship = p.type === 'data_nindex';
        const capped = bucket.values.slice(0, perPropLimit).map<ExploredValue>((raw) => {
            if (isRelationship) {
                const padded = padNeid(raw);
                return {
                    raw: padded,
                    label: nameByNeid[padded] ?? padded,
                    neid: padded,
                };
            }
            return { raw, label: raw };
        });
        properties.push({
            pid: p.pid,
            name: p.name,
            displayName: p.displayName || prettify(p.name),
            type: p.type,
            isRelationship,
            targetFlavors: p.targetFlavors,
            description: p.description,
            totalDistinct: bucket.values.length,
            values: capped,
        });
    }

    properties.sort((a, b) => {
        if (a.isRelationship !== b.isRelationship) return a.isRelationship ? 1 : -1;
        return a.displayName.localeCompare(b.displayName);
    });

    const name = await namePromise;
    return { neid, name, flavor, properties };
}

/** "wikipedia_extended_summary" → "Wikipedia Extended Summary" */
function prettify(name: string): string {
    return name
        .replace(/_/g, ' ')
        .replace(/::/g, ' / ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
