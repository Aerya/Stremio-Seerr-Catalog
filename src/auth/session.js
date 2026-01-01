const session = require('express-session');
const db = require('../db');

/**
 * Session configuration for SeerrCatalog
 */
function configureSession(app) {
    app.use(session({
        secret: process.env.SESSION_SECRET || 'seerrcatalog-secret-change-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false, // Set to true if using HTTPS
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            sameSite: 'lax'
        }
    }));
}

/**
 * Middleware to check if user is authenticated
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        const user = db.getUserById(req.session.userId);
        if (user) {
            req.user = user;
            return next();
        }
    }

    // Not authenticated - redirect to login
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/login');
}

/**
 * Login endpoint
 */
function handleLogin(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const bcrypt = require('bcrypt');
    const valid = bcrypt.compareSync(password, user.password);

    if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create session
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_admin: user.is_admin
        }
    });
}

/**
 * Logout endpoint
 */
function handleLogout(req, res) {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true });
    });
}

/**
 * Get current user endpoint
 */
function getCurrentUser(req, res) {
    if (req.session && req.session.userId) {
        const user = db.getUserById(req.session.userId);
        if (user) {
            return res.json({
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                is_admin: user.is_admin
            });
        }
    }
    res.status(401).json({ error: 'Not authenticated' });
}

module.exports = {
    configureSession,
    requireAuth,
    handleLogin,
    handleLogout,
    getCurrentUser
};
