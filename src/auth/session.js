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
        console.log(`[Auth] Login failed: User not found - ${username}`);
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log(`[Auth] Attempting login for user: ${username}`);
    console.log(`[Auth] Password hash in DB: ${user.password_hash ? user.password_hash.substring(0, 20) + '...' : 'NULL'}`);

    const bcrypt = require('bcrypt');
    let valid = false;

    // Check if password is bcrypt hashed (starts with $2a$, $2b$, or $2y$)
    if (user.password_hash && user.password_hash.startsWith('$2')) {
        try {
            valid = bcrypt.compareSync(password, user.password_hash);
            console.log(`[Auth] Bcrypt comparison result: ${valid}`);
        } catch (e) {
            console.error('[Auth] Bcrypt comparison failed:', e.message);
            valid = false;
        }
    } else {
        // Plain text password (for backward compatibility)
        valid = (password === user.password_hash);
        console.log(`[Auth] Plain text comparison result: ${valid}`);
    }

    if (!valid) {
        console.log(`[Auth] Login failed: Invalid password for user ${username}`);
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create session
    req.session.userId = user.id;
    req.session.username = user.username;

    console.log(`[Auth] Login successful for user: ${username} (ID: ${user.id})`);
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
