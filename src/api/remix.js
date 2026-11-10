const express = require('express');
const remix = require('../services/remixIntegration');
const supplemental = require('../services/supplementalSearch');

function createRouter(db) {
    const router = express.Router();
    const admin = (req, res, next) => {
        if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Administrator required' });
        next();
    };
    const bearer = (req, res, next) => {
        if (!remix.bearerAuthorized(db, req.headers.authorization)) {
            return res.status(401).json({ error: 'Unauthorized integration' });
        }
        res.set('Cache-Control', 'no-store');
        next();
    };

    // Read-only complete snapshot feed; restart at after=0 for each synchronization. Remix fetches this
    // after startup/reconnect to recover events that were missed while offline.
    router.get('/v1/availability', bearer, (req, res) => {
        const after = Number(req.query.after || 0);
        const size = Number(req.query.limit || 50);
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(size) || size < 1 || size > 100) {
            return res.status(400).json({ error: 'Invalid pagination' });
        }
        remix.ensureConfirmedSnapshots(db);
        const revision = db.getRemixRevision();
        if (req.query.revision !== undefined && String(revision) !== req.query.revision) {
            return res.status(409).json({ error: 'Snapshot changed; restart from after=0' });
        }
        const rows = db.getRemixSnapshotsAfter(after, size);
        res.json({
            schema: remix.SCHEMA,
            revision,
            items: rows.map(row => remix.activeSnapshot(row.payload)).filter(Boolean),
            nextCursor: rows.length === size ? rows[rows.length - 1].id : null
        });
    });

    // Integration administration uses the existing WebUI session, not the feed token.
    router.get('/settings', admin, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(remix.getSettings(db));
    });
    router.put('/settings', admin, (req, res) => {
        try {
            res.json(remix.updateSettings(db, req.body || {}));
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });
    router.post('/token', admin, (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ token: remix.generateToken(db) });
    });

    router.get('/search-settings', admin, (req, res) => {
        res.set('Cache-Control', 'no-store').json(supplemental.getSettings(db));
    });
    router.put('/search-settings', admin, (req, res) => {
        try { res.json(supplemental.updateSettings(db, req.body || {})); }
        catch (error) { res.status(400).json({error:error.message}); }
    });
    router.post('/search-test', admin, async (req, res) => {
        try { res.json(await supplemental.testConnection(db)); }
        catch (error) { res.status(502).json({error:error.message}); }
    });
    return router;
}

module.exports = { createRouter };
