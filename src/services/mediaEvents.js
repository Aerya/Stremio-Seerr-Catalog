/**
 * Catalogue lifecycle events. A transition is recorded before any notification,
 * and notifications are best effort (never change an API operation's outcome).
 */
const remix = require('./remixIntegration');

async function notifySourcesFound(media, result) {
    const { sendSourcesFoundNotification } = require('./discord');
    const { notifyMediaAvailable } = require('./jellyseerr');
    const results = await Promise.allSettled([
        sendSourcesFoundNotification(media, result),
        notifyMediaAvailable(media),
        require('./notifications').sendApprise('Disponible', media.title, 'success')
    ]);
    for (const outcome of results) {
        if (outcome.status === 'rejected') {
            console.error('[MediaEvents] Availability notification failed:', outcome.reason);
        }
    }
}

/** Store conclusive results and notify only once when absent -> available. */
async function recordStreamCheck(db, media, result, onAvailable = notifySourcesFound) {
    if (result && db.setSetting) db.setSetting(`submaker_pending_${media.id}`,String(result.subtitlesPending===true && !result.available));
    if(result?.subtitlesPending && db.db) {db.db.prepare('UPDATE media SET next_search_at = ? WHERE id = ? AND streams_available = 0').run(new Date(Date.now()+5*60000).toISOString(),media.id);}
    if (!result || result.conclusive !== true) return { updated: false, newlyAvailable: false };
    const previous = db.getMediaById(media.id);
    if (!previous || previous.streams_available) return { updated: false, newlyAvailable: false };

    if (!result.manualApproval && previous.last_stream_check === result.lastChecked) return { updated: false, newlyAvailable: false };

    // SQLite writes are synchronous. The transition is committed before awaiting any I/O,
    // so overlapping manual/background checks cannot send duplicate notifications.
    // A positive decision is permanent. Manual approval is only possible from a recorded release.
    result.available = result.manualApproval === true
        ? previous.stream_count >= 1
        : result.available && result.streamCount >= 2;
    db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);
    if (db.db) {
        const now = Date.parse(result.lastChecked) || Date.now();
        const started = Date.parse(previous.search_started_at) || now;
        const day = 86400000;
        let stage = previous.search_stage || 0;
        if (previous.search_started_at && stage === 0 && now >= started + day) stage = 1;
        else if (stage === 1 && now >= started + 3 * day && now >= (Date.parse(previous.next_search_at) || 0)) stage = 2;
        const next = result.available ? null : result.subtitlesPending ? new Date(now+5*60000).toISOString() : new Date(result.streamCount === 1 && stage === 0
            ? started + day : result.streamCount === 1 && stage === 1
                ? Math.max(started + 3 * day, now + 3600000) : now + day).toISOString();
        db.db.prepare('UPDATE media SET search_started_at = ?, next_search_at = ?, availability_manual = ?, search_stage = ?, stream_filters_detail = ? WHERE id = ?')
            .run(result.streamCount === 0 ? null : new Date(started).toISOString(), next, result.manualApproval ? 1 : 0, result.streamCount === 0 ? 0 : stage, JSON.stringify(result.appliedFilters || null), media.id);
        if (!result.available && result.streamCount === 1 && stage >= 2 && !previous.review_notified) {
            // Claim before asynchronous delivery to avoid duplicate simultaneous checks.
            const claimed = db.db.prepare('UPDATE media SET review_notified = 2 WHERE id = ? AND review_notified = 0').run(media.id);
            if (claimed.changes) Promise.resolve().then(() => require('./notifications').sendReviewNotification(media))
                .then(sent => { db.db.prepare('UPDATE media SET review_notified = ? WHERE id = ? AND review_notified = 2').run(sent ? 1 : 0, media.id); })
                .catch(() => { db.db.prepare('UPDATE media SET review_notified = 0 WHERE id = ?').run(media.id); });
        }
    }
    if (typeof db.getSetting === 'function') {
        try {
            remix.recordSnapshot(db, previous, result);
        } catch (error) {
            console.warn('[Ether Remix] Could not store snapshot:', error.message);
        }
    }
    const newlyAvailable = !!result.available && !previous.streams_available;
    if (newlyAvailable) {
        // The UI must not wait for Discord or Jellyseerr to answer.
        Promise.resolve().then(() => onAvailable(previous, result)).catch(error => {
            console.error('[MediaEvents] Sources-found notification failed:', error);
        });
    }
    return { updated: true, newlyAvailable };
}

/** Upgrade a confirmed fallback version without ever revoking its availability. */
function recordPrimaryLanguageUpgrade(db, media, result) {
    if (!result?.conclusive || !result.available || result.streamCount < 2 ||
        result.appliedFilters?.subtitleFallbackUsed !== false || !result.appliedFilters?.languageTags?.length) return false;
    return db.db.transaction(() => {
        const previous = db.getMediaById(media.id);
        if (!previous?.streams_available || !previous.stream_filters_detail?.subtitleFallbackUsed) return false;
        db.db.prepare('UPDATE media SET stream_count = ?, last_stream_check = ?, streams_detail = ?, stream_filters_detail = ?, availability_manual = 0 WHERE id = ?')
            .run(result.streamCount, result.lastChecked, JSON.stringify(result.addons || []), JSON.stringify(result.appliedFilters), media.id);
        // Replace the shared observations too, without a second availability notification.
        remix.recordSnapshot(db, previous, result);
        return true;
    })();
}

function notifyRemoval(media, outcome, reason, send = defaultRemovalNotifier, db = null) {
    if (!outcome || outcome.changes !== 1) return false;
    // Send after deletion, asynchronously, without delaying/invalidating responses.
    Promise.resolve().then(() => send(media, reason)).catch(error => {
        console.error('[MediaEvents] Removal notification failed:', error);
    });
    if (db && typeof db.getSetting === 'function') {
        try { remix.recordRemoval(db, media); }
        catch (error) { console.warn('[Ether Remix] Could not send removal:', error.message); }
    }
    return true;
}

async function defaultRemovalNotifier(media, reason) {
    const { sendMediaRemovedNotification } = require('./discord');
    await Promise.allSettled([sendMediaRemovedNotification(media, reason),
        require('./notifications').sendApprise('Contenu retiré', media.title)]);
}

function deleteMediaWithNotification(db, media, reason = 'manual', send) {
    const outcome = db.deleteMedia(media.id);
    notifyRemoval(media, outcome, reason, send, db);
    return outcome;
}

module.exports = {
    recordStreamCheck,
    recordPrimaryLanguageUpgrade,
    notifyRemoval,
    deleteMediaWithNotification
};
