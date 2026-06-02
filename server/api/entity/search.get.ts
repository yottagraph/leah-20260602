/**
 * GET /api/entity/search?q=<query>&limit=8
 *
 * Same-origin wrapper around `POST /entities/search` on the Query Server.
 * Keeps the QS API key on the server and returns a compact `{ neid, name,
 * flavor }[]` for the autosuggest dropdown on the home page.
 */
import { isQsConfigured } from '~/server/utils/elementalQs';

export default defineEventHandler(async (event) => {
    const q = getQuery(event);
    const query = typeof q.q === 'string' ? q.q.trim() : '';
    const limit = Math.max(1, Math.min(25, Number(q.limit) || 8));

    if (!query) return { matches: [] as { neid: string; name: string; flavor: string }[] };

    if (!isQsConfigured()) {
        throw createError({ statusCode: 503, statusMessage: 'Query Server not configured.' });
    }

    const pub = (useRuntimeConfig().public ?? {}) as Record<string, string>;
    const base = `${pub.gatewayUrl}/api/qs/${pub.tenantOrgId}`;
    const apiKey = pub.qsApiKey;

    const res = await $fetch<any>(`${base}/entities/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: {
            queries: [{ queryId: 1, query }],
            maxResults: limit,
            includeNames: true,
        },
    });
    const matches: any[] = res?.results?.[0]?.matches ?? [];
    return {
        matches: matches.map((m) => ({
            neid: String(m.neid),
            name: String(m.name || m.neid),
            flavor: String(m.flavor || ''),
        })),
    };
});
