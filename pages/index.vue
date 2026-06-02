<template>
    <div class="search-page d-flex flex-column fill-height">
        <div class="search-content">
            <div class="hero">
                <img src="/LL-logo-full-wht.svg" alt="Lovelace" class="hero-logo" />
                <h1 class="hero-title">Entity Search</h1>
                <p class="hero-subtitle">
                    Look up any entity in the knowledge graph and explore its properties and
                    relationships.
                </p>
            </div>

            <div class="search-wrapper">
                <v-text-field
                    v-model="query"
                    autofocus
                    label="Search for an entity"
                    placeholder="e.g. Microsoft, Apple, Bill Gates"
                    prepend-inner-icon="mdi-magnify"
                    variant="solo-filled"
                    rounded="lg"
                    density="comfortable"
                    clearable
                    hide-details
                    :loading="searching"
                    @keydown.down.prevent="cursorDown"
                    @keydown.up.prevent="cursorUp"
                    @keydown.enter.prevent="onEnter"
                    @click:clear="onClear"
                />

                <v-card v-if="showMenu" class="search-dropdown" elevation="12" rounded="lg">
                    <v-list density="compact" lines="two">
                        <v-list-item
                            v-for="(m, i) in matches"
                            :key="m.neid"
                            :active="i === activeIndex"
                            :title="m.name"
                            @click="selectMatch(m)"
                            @mouseenter="activeIndex = i"
                        >
                            <template #subtitle>
                                <span class="d-flex align-center">
                                    <v-chip
                                        v-if="m.flavor"
                                        size="x-small"
                                        variant="tonal"
                                        class="mr-2"
                                        density="compact"
                                    >
                                        {{ m.flavor }}
                                    </v-chip>
                                    <span class="text-truncate text-medium-emphasis neid-mono">
                                        {{ m.neid }}
                                    </span>
                                </span>
                            </template>
                        </v-list-item>
                    </v-list>
                </v-card>
            </div>

            <v-alert
                v-if="errorMessage"
                type="error"
                variant="tonal"
                class="mt-6"
                closable
                @click:close="errorMessage = null"
            >
                {{ errorMessage }}
            </v-alert>

            <div v-if="!query && !searching" class="hints mt-8">
                <div class="hint-label">Try one of these:</div>
                <div class="hint-chips">
                    <v-chip
                        v-for="ex in examples"
                        :key="ex"
                        size="small"
                        variant="tonal"
                        class="hint-chip"
                        @click="query = ex"
                    >
                        {{ ex }}
                    </v-chip>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    interface Match {
        neid: string;
        name: string;
        flavor: string;
    }

    const query = ref('');
    const matches = ref<Match[]>([]);
    const searching = ref(false);
    const errorMessage = ref<string | null>(null);
    const activeIndex = ref(0);
    const showMenu = ref(false);
    const router = useRouter();

    const examples = ['Microsoft', 'Apple', 'JPMorgan Chase', 'Bill Gates', 'Tesla'];

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSelectedName = '';

    watch(query, (val) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        if (val === lastSelectedName) return;
        const trimmed = (val ?? '').trim();
        if (!trimmed || trimmed.length < 2) {
            matches.value = [];
            showMenu.value = false;
            searching.value = false;
            return;
        }
        debounceTimer = setTimeout(() => doSearch(trimmed), 250);
    });

    async function doSearch(q: string) {
        searching.value = true;
        errorMessage.value = null;
        try {
            const res = await $fetch<{ matches: Match[] }>('/api/entity/search', {
                params: { q, limit: 8 },
            });
            matches.value = res.matches ?? [];
            activeIndex.value = 0;
            showMenu.value = matches.value.length > 0;
        } catch (e: any) {
            errorMessage.value = e?.statusMessage || e?.message || 'Search failed';
            matches.value = [];
            showMenu.value = false;
        } finally {
            searching.value = false;
        }
    }

    function selectMatch(m: Match) {
        if (!m.flavor) {
            errorMessage.value = `Cannot open ${m.name} — entity has no flavor metadata.`;
            return;
        }
        lastSelectedName = m.name;
        query.value = m.name;
        showMenu.value = false;
        router.push({
            path: `/entity/${m.neid}`,
            query: { flavor: m.flavor, name: m.name },
        });
    }

    function cursorDown() {
        if (!showMenu.value) return;
        activeIndex.value = (activeIndex.value + 1) % matches.value.length;
    }

    function cursorUp() {
        if (!showMenu.value) return;
        const n = matches.value.length;
        activeIndex.value = (activeIndex.value - 1 + n) % n;
    }

    function onEnter() {
        if (matches.value[activeIndex.value]) {
            selectMatch(matches.value[activeIndex.value]);
        }
    }

    function onClear() {
        matches.value = [];
        showMenu.value = false;
        lastSelectedName = '';
    }

    onMounted(() => {
        const close = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target?.closest('.search-wrapper')) showMenu.value = false;
        };
        document.addEventListener('click', close);
        onBeforeUnmount(() => document.removeEventListener('click', close));
    });
</script>

<style scoped>
    .search-page {
        height: 100%;
        overflow-y: auto;
    }

    .search-content {
        max-width: 720px;
        width: 100%;
        margin: 0 auto;
        padding: 64px 24px 48px;
    }

    .hero {
        text-align: center;
        margin-bottom: 32px;
    }

    .hero-logo {
        height: 2rem;
        width: auto;
        margin-bottom: 24px;
        opacity: 0.6;
    }

    .hero-title {
        font-family: var(--font-headline);
        font-weight: 400;
        font-size: 2rem;
        letter-spacing: 0.02em;
        margin-bottom: 12px;
    }

    .hero-subtitle {
        color: var(--lv-silver);
        font-size: 1rem;
        max-width: 520px;
        margin: 0 auto;
    }

    .search-wrapper {
        position: relative;
    }

    .search-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 100;
        max-height: 360px;
        overflow-y: auto;
    }

    .neid-mono {
        font-family: var(--font-mono);
        font-size: 0.75rem;
    }

    .hints {
        text-align: center;
    }

    .hint-label {
        color: var(--lv-silver);
        font-size: 0.85rem;
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .hint-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
    }

    .hint-chip {
        cursor: pointer;
    }
</style>
