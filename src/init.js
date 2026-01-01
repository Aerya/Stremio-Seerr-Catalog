const db = require('./db');
const bcrypt = require('bcrypt');

/**
 * Initialize default admin user from environment variables
 * This runs on startup to ensure there's always at least one user
 */
function initializeDefaultUser() {
    const users = db.getAllUsers();

    // If there are already users, skip initialization
    if (users && users.length > 0) {
        console.log('[Init] Users already exist, skipping default user creation');
        return;
    }

    // Get credentials from environment
    const username = process.env.ADDON_USER || 'admin';
    const password = process.env.ADDON_PASSWORD || 'changeme';

    console.log('[Init] No users found, creating default admin user...');

    // Hash the password
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Create admin user
    const userId = db.createUser({
        username: username,
        password: hashedPassword,
        display_name: 'Administrator',
        is_admin: 1
    });

    console.log(`[Init] ✅ Created default admin user: ${username} (ID: ${userId})`);
    console.log(`[Init] Please login with username: ${username}`);
}

module.exports = { initializeDefaultUser };
