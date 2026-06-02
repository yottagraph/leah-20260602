/**
 * GET /api/entity/:neid?flavor=organization[&limit=5]
 *
 * Returns the entity-detail payload: display name, flavor, and the list of
 * properties (data + relationships) that have values for this entity,
 * capped at `limit` distinct values per property. Built with two batched
 * round trips to the Query Server — see `~/server/utils/entityExplorer`.
 */
import { exploreEntity } from '~/server/utils/entityExplorer';

export default defineEventHandler(async (event) => {
    const neidParam = getRouterParam(event, 'neid') ?? '';
    const q = getQuery(event);
    const flavor = typeof q.flavor === 'string' ? q.flavor : '';
    const limit = Math.max(1, Math.min(50, Number(q.limit) || 5));

    if (!neidParam) {
        throw createError({ statusCode: 400, statusMessage: 'neid is required' });
    }
    if (!flavor) {
        throw createError({
            statusCode: 400,
            statusMessage: 'flavor query param is required (e.g. ?flavor=organization)',
        });
    }

    // Be tolerant of un-padded ids in URLs.
    const neid = neidParam.padStart(20, '0');
    return exploreEntity(neid, flavor, limit);
});
