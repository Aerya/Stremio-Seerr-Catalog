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
        notifyMediaAvailable(media)
    ]);
    for (const outcome of results) {
        if (outcome.status === 'rejected') {
            console.error('[MediaEvents] Availability notification failed:', outcome.reason);
        }
    }
}

/** Store conclusive results and notify only once when absent -> available. */
async function recordStreamCheck(db, media, result, onAvailable = notifySourcesFound) {
    if (!result || result.conclusive !== true) return { updated: false, newlyAvailable: false };
    const previous = db.getMediaById(media.id);
    if (!previous) return { updated: false, newlyAvailable: false };

    // SQLite writes are synchronous. The transition is committed before awaiting any I/O,
    // so overlapping manual/background checks cannot send duplicate notifications.
    db.updateStreamStatus(media.id, result.available, result.streamCount, result.lastChecked, result.addons);
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
    await sendMediaRemovedNotification(media, reason);
}

function deleteMediaWithNotification(db, media, reason = 'manual', send) {
    const outcome = db.deleteMedia(media.id);
    notifyRemoval(media, outcome, reason, send, db);
    return outcome;
}

module.exports = {
    recordStreamCheck,
    notifyRemoval,
    deleteMediaWithNotification
};
