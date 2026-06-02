<template>
    <div class="d-flex flex-column fill-height">
        <div class="flex-shrink-0 entity-header pa-4 pt-6">
            <div class="d-flex align-center mb-3">
                <v-btn
                    icon="mdi-arrow-left"
                    variant="text"
                    size="small"
                    class="mr-2"
                    :to="{ path: '/' }"
                    aria-label="Back to search"
                />
                <span class="text-medium-emphasis text-body-2">Entity</span>
            </div>

            <div v-if="loading && !data" class="d-flex align-center">
                <v-progress-circular indeterminate size="20" width="2" class="mr-3" />
                <span class="text-medium-emphasis">Resolving entity…</span>
            </div>

            <div v-else class="entity-title-block">
                <h1 class="entity-name">{{ displayName }}</h1>
                <div class="entity-meta">
                    <v-chip v-if="flavor" size="small" variant="tonal" color="primary" class="mr-2">
                        {{ flavor }}
                    </v-chip>
                    <span class="neid-mono text-medium-emphasis">{{ neid }}</span>
                </div>
            </div>
        </div>

        <div class="flex-grow-1 overflow-y-auto pa-4 pt-2">
            <v-alert
                v-if="error"
                type="error"
                variant="tonal"
                class="mb-4"
                closable
                @click:close="error = null"
            >
                {{ error }}
            </v-alert>

            <div v-if="loading && !data" class="d-flex flex-column align-center pa-8">
                <v-progress-circular indeterminate class="mb-3" />
                <div class="text-medium-emphasis">Loading properties…</div>
            </div>

            <v-empty-state
                v-else-if="data && data.properties.length === 0"
                icon="mdi-database-off-outline"
                headline="No data for this entity"
                text="The entity was found, but no properties or relationships have been recorded for it."
            />

            <div v-else-if="data">
                <div class="section-bar">
                    <h2 class="section-title">
                        Properties &amp; Relationships
                        <span class="section-count">{{ data.properties.length }}</span>
                    </h2>
                    <div class="section-legend text-caption text-medium-emphasis">
                        Showing up to {{ valuesPerProperty }} values per item · click to expand
                    </div>
                </div>

                <v-expansion-panels variant="accordion" multiple class="mt-2">
                    <v-expansion-panel v-for="p in data.properties" :key="p.pid" :value="p.pid">
                        <v-expansion-panel-title class="prop-title">
                            <div class="d-flex align-center flex-grow-1 prop-title-inner">
                                <v-icon
                                    :icon="
                                        p.isRelationship ? 'mdi-link-variant' : 'mdi-tag-outline'
                                    "
                                    size="18"
                                    class="mr-3 prop-icon"
                                />
                                <div class="prop-title-text">
                                    <div class="prop-display-name">{{ p.displayName }}</div>
                                    <div class="prop-meta">
                                        <span class="prop-name-mono">{{ p.name }}</span>
                                        <span class="prop-type-tag">{{ shortType(p.type) }}</span>
                                        <span v-if="p.isRelationship && p.targetFlavors.length">
                                            →
                                            <span class="prop-target-flavor">
                                                {{ p.targetFlavors.join(', ') }}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <v-spacer />
                                <v-chip
                                    size="x-small"
                                    variant="tonal"
                                    :color="p.values.length > 0 ? 'success' : 'grey'"
                                    class="value-count-chip"
                                >
                                    {{
                                        p.values.length === 1
                                            ? '1 value'
                                            : `${p.values.length} values`
                                    }}
                                </v-chip>
                            </div>
                        </v-expansion-panel-title>
                        <v-expansion-panel-text>
                            <div v-if="p.description" class="prop-description">
                                {{ p.description }}
                            </div>
                            <v-list density="compact" lines="one" class="value-list">
                                <v-list-item
                                    v-for="(v, i) in p.values"
                                    :key="`${p.pid}-${i}-${v.raw}`"
                                    :to="
                                        v.neid
                                            ? {
                                                  path: `/entity/${v.neid}`,
                                                  query: {
                                                      flavor: p.targetFlavors[0] ?? '',
                                                      name: v.label,
                                                  },
                                              }
                                            : undefined
                                    "
                                    :class="{ 'value-link': !!v.neid }"
                                >
                                    <template #prepend>
                                        <v-icon
                                            v-if="v.neid"
                                            icon="mdi-arrow-right-circle-outline"
                                            size="18"
                                            class="mr-2"
                                        />
                                        <v-icon
                                            v-else
                                            icon="mdi-circle-small"
                                            size="18"
                                            class="mr-2"
                                        />
                                    </template>
                                    <v-list-item-title>
                                        <span class="value-label">{{ v.label }}</span>
                                    </v-list-item-title>
                                    <template v-if="v.neid" #append>
                                        <span class="value-neid neid-mono">{{ v.neid }}</span>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-expansion-panel-text>
                    </v-expansion-panel>
                </v-expansion-panels>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import type { ExploredEntity } from '~/server/utils/entityExplorer';

    const route = useRoute();
    const router = useRouter();

    const neid = computed(() => {
        const raw = (route.params.neid as string) || '';
        return raw.padStart(20, '0');
    });
    const flavor = computed(() => (route.query.flavor as string) || '');
    const hintedName = computed(() => (route.query.name as string) || '');

    const valuesPerProperty = 5;

    const data = ref<ExploredEntity | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    const displayName = computed(() => data.value?.name || hintedName.value || neid.value);

    async function load() {
        if (!neid.value) return;
        if (!flavor.value) {
            error.value =
                'Missing entity flavor. Open this entity from the search page so we know its type.';
            return;
        }
        loading.value = true;
        error.value = null;
        data.value = null;
        try {
            data.value = await $fetch<ExploredEntity>(`/api/entity/${neid.value}`, {
                params: { flavor: flavor.value, limit: valuesPerProperty },
            });
        } catch (e: any) {
            error.value =
                e?.statusMessage ||
                e?.data?.statusMessage ||
                e?.message ||
                'Failed to load entity.';
        } finally {
            loading.value = false;
        }
    }

    onMounted(load);
    watch(
        () => [neid.value, flavor.value],
        () => load()
    );

    function shortType(t: string): string {
        return t.replace(/^data_/, '');
    }
</script>

<style scoped>
    .entity-header {
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .entity-name {
        font-family: var(--font-headline);
        font-weight: 400;
        font-size: 2rem;
        letter-spacing: 0.01em;
        line-height: 1.2;
        margin-bottom: 8px;
    }

    .entity-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
    }

    .neid-mono {
        font-family: var(--font-mono);
        font-size: 0.75rem;
    }

    .section-bar {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        margin: 8px 0 4px;
    }

    .section-title {
        font-family: var(--font-headline);
        font-weight: 400;
        font-size: 1rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--lv-silver);
    }

    .section-count {
        font-family: var(--font-mono);
        font-size: 0.85rem;
        margin-left: 8px;
        opacity: 0.6;
    }

    .prop-title-inner {
        min-width: 0;
        gap: 4px;
    }

    .prop-icon {
        opacity: 0.65;
    }

    .prop-title-text {
        min-width: 0;
        flex: 1 1 auto;
    }

    .prop-display-name {
        font-weight: 500;
    }

    .prop-meta {
        font-size: 0.75rem;
        color: var(--lv-silver, rgba(255, 255, 255, 0.6));
        margin-top: 2px;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .prop-name-mono {
        font-family: var(--font-mono);
        opacity: 0.9;
    }

    .prop-type-tag {
        font-family: var(--font-mono);
        padding: 1px 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 0.7rem;
    }

    .prop-target-flavor {
        font-family: var(--font-mono);
        opacity: 0.9;
    }

    .value-count-chip {
        margin-left: 12px;
        flex-shrink: 0;
    }

    .prop-description {
        font-size: 0.85rem;
        color: var(--lv-silver, rgba(255, 255, 255, 0.7));
        margin: 0 16px 8px;
        font-style: italic;
    }

    .value-list {
        background: transparent;
    }

    .value-label {
        white-space: normal;
        word-break: break-word;
    }

    .value-neid {
        margin-left: 12px;
        opacity: 0.6;
    }

    .value-link :deep(.v-list-item__overlay) {
        opacity: 0;
    }

    .value-link:hover :deep(.v-list-item__overlay) {
        opacity: 0.04;
    }
</style>
