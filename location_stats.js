/* ═══════════════════════════════════════════════════════════════
   LOCATION STATS MODULE — Privacy-First Visitor Analytics
   ═══════════════════════════════════════════════════════════════

   Tracks per-location:
     • visitCount   — number of times a location page was opened
     • listenTimeMs — cumulative milliseconds of audio listened

   STORAGE: localStorage ("mnthen_stats_v1") — no backend required.
   Optional: call stats.syncToEndpoint(url) to push to your server.

   USAGE:
     // 1. Initialize once (e.g., in DOMContentLoaded)
     window.locationStats = new LocationStats();

     // 2. When a location page opens (call once per open):
     window.locationStats.recordVisit(locationId);

     // 3. When audio plays (call during audio timeupdate or cleanup):
     window.locationStats.recordListenTime(locationId, milliseconds);

     // 4. Get stats for display:
     const stats = window.locationStats.getStats(locationId);
     // → { visitCount: 5, listenTimeMs: 127000, listenTimeFormatted: "2:07" }

     // 5. Get all stats sorted by most visited:
     const all = window.locationStats.getAllStats();

     // 6. Optional: sync to a JSON endpoint
     window.locationStats.syncToEndpoint("https://api.mnthen.com/stats");

   ═══════════════════════════════════════════════════════════════ */

class LocationStats {
    constructor(options = {}) {
        this.storageKey = options.storageKey || 'mnthen_stats_v1';
        this.maxLocations = options.maxLocations || 1000;
        this.batchBuffer = [];           // For endpoint sync batching
        this.batchTimer = null;
        this.endpointUrl = null;
        this.syncIntervalMs = options.syncIntervalMs || 30000;
        this._lastSyncTime = 0;
        this._dirty = false;             // Track if data changed since last sync

        // Load existing data
        this._data = this._load();

        // Optional: start auto-sync if endpoint provided at init
        if (options.endpointUrl) {
            this.startAutoSync(options.endpointUrl);
        }
    }

    /* ── CORE: Record a visit ───────────────────────────────────── */
    recordVisit(locationId) {
        if (locationId == null) return this;
        const id = String(locationId);
        const now = Date.now();

        if (!this._data.locations[id]) {
            this._data.locations[id] = {
                visitCount: 0,
                listenTimeMs: 0,
                firstVisit: now,
                lastVisit: now,
                version: 1
            };
            this._enforceMaxLocations();
        }

        const loc = this._data.locations[id];
        loc.visitCount++;
        loc.lastVisit = now;
        loc.version = (loc.version || 1) + 1;

        this._data.meta.totalVisits++;
        this._data.meta.lastUpdated = now;
        this._dirty = true;

        this._save();
        this._queueForSync({ type: 'visit', locationId: id, timestamp: now });

        return this;
    }

    /* ── CORE: Record audio listen time ─────────────────────────── */
    recordListenTime(locationId, milliseconds) {
        if (locationId == null || !isFinite(milliseconds) || milliseconds <= 0) return this;
        const id = String(locationId);
        const ms = Math.floor(milliseconds);
        const now = Date.now();

        if (!this._data.locations[id]) {
            this.recordVisit(id); // Auto-init if first encounter
        }

        const loc = this._data.locations[id];
        loc.listenTimeMs += ms;
        loc.lastVisit = now;
        loc.version = (loc.version || 1) + 1;

        this._data.meta.totalListenTimeMs += ms;
        this._data.meta.lastUpdated = now;
        this._dirty = true;

        this._save();
        this._queueForSync({ type: 'listen', locationId: id, ms: ms, timestamp: now });

        return this;
    }

    /* ── GETTERS ──────────────────────────────────────────────────── */
    getStats(locationId) {
        if (locationId == null) return null;
        const id = String(locationId);
        const loc = this._data.locations[id];
        if (!loc) return { visitCount: 0, listenTimeMs: 0, listenTimeFormatted: "0:00" };

        return {
            locationId: id,
            visitCount: loc.visitCount,
            listenTimeMs: loc.listenTimeMs,
            listenTimeFormatted: this._formatDuration(loc.listenTimeMs),
            firstVisit: loc.firstVisit,
            lastVisit: loc.lastVisit,
            firstVisitFormatted: this._formatDate(loc.firstVisit),
            lastVisitFormatted: this._formatDate(loc.lastVisit)
        };
    }

    getAllStats(options = {}) {
        const { sortBy = 'visitCount', limit = 100 } = options;
        const entries = Object.entries(this._data.locations).map(([id, data]) => ({
            locationId: id,
            ...data,
            listenTimeFormatted: this._formatDuration(data.listenTimeMs)
        }));

        // Sort
        if (sortBy === 'visitCount') {
            entries.sort((a, b) => b.visitCount - a.visitCount || b.listenTimeMs - a.listenTimeMs);
        } else if (sortBy === 'listenTime') {
            entries.sort((a, b) => b.listenTimeMs - a.listenTimeMs || b.visitCount - a.visitCount);
        } else if (sortBy === 'recent') {
            entries.sort((a, b) => b.lastVisit - a.lastVisit);
        }

        return {
            locations: entries.slice(0, limit),
            summary: {
                totalLocations: entries.length,
                totalVisits: this._data.meta.totalVisits,
                totalListenTimeMs: this._data.meta.totalListenTimeMs,
                totalListenTimeFormatted: this._formatDuration(this._data.meta.totalListenTimeMs),
                lastUpdated: this._data.meta.lastUpdated,
                lastUpdatedFormatted: this._formatDate(this._data.meta.lastUpdated)
            }
        };
    }

    getTopLocations(n = 10) {
        return this.getAllStats({ sortBy: 'visitCount', limit: n });
    }

    /* ── AUTO-TRACKING: Plug into your existing audio player ────── */
    // Call this once when initializing a location's audio player.
    // It wraps the audio element to automatically track listen time.
    attachAudioTracker(locationId, audioElement) {
        if (!audioElement || !locationId) return () => {};

        let lastTime = 0;
        let accumulatedMs = 0;
        let isPlaying = false;
        let rafId = null;
        let checkInterval = null;

        const FLUSH_THRESHOLD_MS = 5000; // Flush to storage every 5s of listening

        const flush = () => {
            if (accumulatedMs > 0) {
                this.recordListenTime(locationId, accumulatedMs);
                accumulatedMs = 0;
            }
        };

        const onPlay = () => { 
            isPlaying = true; 
            lastTime = performance.now();
            // Start a periodic flush timer
            if (!checkInterval) {
                checkInterval = setInterval(() => {
                    if (isPlaying && accumulatedMs >= FLUSH_THRESHOLD_MS) {
                        flush();
                    }
                }, 1000);
            }
        };

        const onPause = () => { 
            isPlaying = false; 
            const now = performance.now();
            const delta = now - lastTime;
            if (delta > 0 && delta < 300000) { // Cap single gap at 5 min
                accumulatedMs += delta;
            }
            flush();
            if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
        };

        const onTimeUpdate = () => {
            // Backup: if RAF/interval misses, timeupdate catches it
            const now = performance.now();
            if (isPlaying && lastTime > 0) {
                const delta = now - lastTime;
                if (delta > 0 && delta < 10000) { // Max 10s between updates
                    accumulatedMs += delta;
                }
            }
            lastTime = now;
            if (accumulatedMs >= FLUSH_THRESHOLD_MS) flush();
        };

        const onEnded = () => {
            isPlaying = false;
            const now = performance.now();
            const delta = now - lastTime;
            if (delta > 0 && delta < 300000) accumulatedMs += delta;
            flush();
            if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
        };

        audioElement.addEventListener('play', onPlay);
        audioElement.addEventListener('pause', onPause);
        audioElement.addEventListener('ended', onEnded);
        audioElement.addEventListener('timeupdate', onTimeUpdate);

        // Return cleanup function
        return () => {
            audioElement.removeEventListener('play', onPlay);
            audioElement.removeEventListener('pause', onPause);
            audioElement.removeEventListener('ended', onEnded);
            audioElement.removeEventListener('timeupdate', onTimeUpdate);
            if (checkInterval) clearInterval(checkInterval);
            flush(); // Final flush
        };
    }

    /* ── SYNC: Optional endpoint push ───────────────────────────── */
    startAutoSync(endpointUrl) {
        this.endpointUrl = endpointUrl;
        // Flush batch every syncIntervalMs
        const flushBatch = () => {
            this._flushBatch();
            this._syncTimer = setTimeout(flushBatch, this.syncIntervalMs);
        };
        this._syncTimer = setTimeout(flushBatch, this.syncIntervalMs);

        // Also flush on page hide
        this._pageHideHandler = () => this._flushBatch();
        window.addEventListener('pagehide', this._pageHideHandler);
    }

    stopAutoSync() {
        if (this._syncTimer) { clearTimeout(this._syncTimer); this._syncTimer = null; }
        if (this._pageHideHandler) {
            window.removeEventListener('pagehide', this._pageHideHandler);
            this._pageHideHandler = null;
        }
        this.endpointUrl = null;
    }

    async syncToEndpoint(endpointUrl) {
        if (!endpointUrl) return { success: false, error: 'No endpoint URL' };

        const payload = {
            deviceId: this._getDeviceId(),
            timestamp: Date.now(),
            stats: this._data,
            batch: this.batchBuffer.splice(0, this.batchBuffer.length) // Clear batch
        };

        try {
            const response = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true // Works during page unload
            });

            if (response.ok) {
                this._lastSyncTime = Date.now();
                this._dirty = false;
                return { success: true, syncedAt: this._lastSyncTime };
            }
            // Re-queue on failure
            this.batchBuffer.unshift(...payload.batch);
            return { success: false, status: response.status };

        } catch (err) {
            this.batchBuffer.unshift(...payload.batch);
            return { success: false, error: err.message };
        }
    }

    /* ── EXPORT / IMPORT ────────────────────────────────────────── */
    exportJSON() {
        return JSON.stringify(this._data, null, 2);
    }

    importJSON(jsonString) {
        try {
            const parsed = JSON.parse(jsonString);
            if (parsed.locations && parsed.meta) {
                this._data = parsed;
                this._save();
                return { success: true };
            }
            return { success: false, error: 'Invalid stats format' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    clearAll() {
        this._data = this._emptyData();
        this._save();
        this.batchBuffer = [];
        this._dirty = false;
        return this;
    }

    /* ── INTERNAL: Storage ──────────────────────────────────────── */
    _load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.locations && parsed.meta) return parsed;
            }
        } catch (e) {
            console.warn('[LocationStats] Failed to load stats:', e);
        }
        return this._emptyData();
    }

    _save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this._data));
        } catch (e) {
            // Quota exceeded — prune oldest
            if (e.name === 'QuotaExceededError') {
                this._pruneOldest(10);
                try {
                    localStorage.setItem(this.storageKey, JSON.stringify(this._data));
                } catch (e2) {
                    console.error('[LocationStats] Storage failed after prune:', e2);
                }
            }
        }
    }

    _emptyData() {
        return {
            version: 1,
            locations: {},
            meta: {
                totalVisits: 0,
                totalListenTimeMs: 0,
                createdAt: Date.now(),
                lastUpdated: Date.now()
            }
        };
    }

    _enforceMaxLocations() {
        const ids = Object.keys(this._data.locations);
        if (ids.length <= this.maxLocations) return;

        // Sort by lastVisit, remove oldest
        const sorted = ids
            .map(id => ({ id, lastVisit: this._data.locations[id].lastVisit }))
            .sort((a, b) => a.lastVisit - b.lastVisit);

        const toRemove = sorted.slice(0, ids.length - this.maxLocations);
        for (const item of toRemove) {
            delete this._data.locations[item.id];
        }
    }

    _pruneOldest(count) {
        const ids = Object.keys(this._data.locations);
        const sorted = ids
            .map(id => ({ id, lastVisit: this._data.locations[id].lastVisit }))
            .sort((a, b) => a.lastVisit - b.lastVisit);

        for (let i = 0; i < Math.min(count, sorted.length); i++) {
            delete this._data.locations[sorted[i].id];
        }
    }

    _queueForSync(event) {
        if (!this.endpointUrl) return;
        this.batchBuffer.push(event);
        // Auto-flush if batch gets large
        if (this.batchBuffer.length >= 50) {
            this._flushBatch();
        }
    }

    _flushBatch() {
        if (!this.endpointUrl || this.batchBuffer.length === 0) return;
        this.syncToEndpoint(this.endpointUrl);
    }

    _getDeviceId() {
        let id = localStorage.getItem('mnthen_device_id');
        if (!id) {
            id = 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            localStorage.setItem('mnthen_device_id', id);
        }
        return id;
    }

    _formatDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    _formatDate(timestamp) {
        if (!timestamp) return 'Never';
        return new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-INIT: Attach to window for global access
   ═══════════════════════════════════════════════════════════════ */
if (typeof window !== 'undefined') {
    window.LocationStats = LocationStats;
}
