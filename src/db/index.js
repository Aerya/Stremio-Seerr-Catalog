const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'seerr-catalog.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
    tmdb_id INTEGER,
    imdb_id TEXT,
    tvdb_id INTEGER,
    title TEXT NOT NULL,
    original_title TEXT,
    year INTEGER,
    poster TEXT,
    backdrop TEXT,
    overview TEXT,
    genres TEXT,
    runtime INTEGER,
    status TEXT DEFAULT 'requested',
    monitored INTEGER DEFAULT 1,
    watched INTEGER DEFAULT 0,
    streams_available INTEGER DEFAULT 0,
    stream_count INTEGER DEFAULT 0,
    last_stream_check DATETIME,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    watched_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, type, tmdb_id)
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    air_date TEXT,
    monitored INTEGER DEFAULT 1,
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE,
    UNIQUE(media_id, season_number, episode_number)
  );

  CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
  CREATE INDEX IF NOT EXISTS idx_media_tmdb ON media(tmdb_id);
  CREATE INDEX IF NOT EXISTS idx_media_imdb ON media(imdb_id);
  CREATE INDEX IF NOT EXISTS idx_media_watched ON media(watched);
  CREATE INDEX IF NOT EXISTS idx_media_streams ON media(streams_available);
  CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);
  CREATE INDEX IF NOT EXISTS idx_episodes_media ON episodes(media_id);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);

// Migration: Add new columns to existing tables
try {
  db.exec(`ALTER TABLE users ADD COLUMN jellyfin_id TEXT`);
} catch (e) { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE users ADD COLUMN stremio_auth_key TEXT`);
} catch (e) { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE users ADD COLUMN last_login DATETIME`);
} catch (e) { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE episodes ADD COLUMN watched INTEGER DEFAULT 0`);
} catch (e) { /* Column already exists */ }

// Migration: Add new columns to existing tables
try {
  db.exec(`ALTER TABLE media ADD COLUMN streams_detail TEXT`);
} catch (e) { /* Column already exists */ }

// Create default admin user if none exists
const crypto = require('crypto');
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

const defaultUser = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
if (!defaultUser) {
  const adminPass = process.env.ADDON_PASSWORD || 'changeme';
  db.prepare(`
    INSERT INTO users (username, password_hash, display_name, is_admin)
    VALUES (?, ?, ?, 1)
  `).run('admin', hashPassword(adminPass), 'Administrator');
  console.log('[DB] Created default admin user');
}

// Prepared statements
const statements = {
  // User statements
  insertUser: db.prepare(`
    INSERT INTO users (username, password_hash, display_name, is_admin)
    VALUES (@username, @password_hash, @display_name, @is_admin)
  `),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getAllUsers: db.prepare('SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY created_at'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  updateUser: db.prepare('UPDATE users SET display_name = ?, is_admin = ? WHERE id = ?'),
  updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  updateUserJellyfinId: db.prepare('UPDATE users SET jellyfin_id = ? WHERE id = ?'),
  updateUserStremioKey: db.prepare('UPDATE users SET stremio_auth_key = ? WHERE id = ?'),
  updateUserLastLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),

  // Media statements (updated with user_id)
  insertMedia: db.prepare(`
    INSERT OR REPLACE INTO media 
    (user_id, type, tmdb_id, imdb_id, tvdb_id, title, original_title, year, poster, backdrop, overview, genres, runtime, status, monitored)
    VALUES (@user_id, @type, @tmdb_id, @imdb_id, @tvdb_id, @title, @original_title, @year, @poster, @backdrop, @overview, @genres, @runtime, @status, @monitored)
  `),

  getMediaById: db.prepare('SELECT * FROM media WHERE id = ?'),
  // ... other statements ...
  getMediaByTmdb: db.prepare('SELECT * FROM media WHERE type = ? AND tmdb_id = ? AND (user_id = ? OR user_id IS NULL)'),
  getMediaByImdb: db.prepare('SELECT * FROM media WHERE imdb_id = ?'),
  getAllMedia: db.prepare('SELECT * FROM media ORDER BY added_at DESC'),
  getMediaByType: db.prepare('SELECT * FROM media WHERE type = ? ORDER BY added_at DESC'),
  getMediaByUser: db.prepare('SELECT * FROM media WHERE user_id = ? ORDER BY added_at DESC'),
  getMediaByUserAndType: db.prepare('SELECT * FROM media WHERE user_id = ? AND type = ? ORDER BY added_at DESC'),
  deleteMedia: db.prepare('DELETE FROM media WHERE id = ?'),
  updateStatus: db.prepare('UPDATE media SET status = ? WHERE id = ?'),

  insertEpisode: db.prepare(`
    INSERT OR REPLACE INTO episodes 
    (media_id, season_number, episode_number, title, overview, air_date, monitored)
    VALUES (@media_id, @season_number, @episode_number, @title, @overview, @air_date, @monitored)
  `),

  getEpisodes: db.prepare('SELECT * FROM episodes WHERE media_id = ? ORDER BY season_number, episode_number'),
};

// Database functions
function addMedia(data) {
  const info = statements.insertMedia.run({
    user_id: data.user_id || null,
    type: data.type,
    tmdb_id: data.tmdb_id || null,
    imdb_id: data.imdb_id || null,
    tvdb_id: data.tvdb_id || null,
    title: data.title,
    original_title: data.original_title || data.title,
    year: data.year || null,
    poster: data.poster || null,
    backdrop: data.backdrop || null,
    overview: data.overview || null,
    genres: data.genres ? JSON.stringify(data.genres) : null,
    runtime: data.runtime || null,
    status: data.status || 'requested',
    monitored: data.monitored !== false ? 1 : 0
  });
  return getMediaById(info.lastInsertRowid);
}

// Helper to parse JSON fields
function parseMediaFields(media) {
  if (!media) return media;
  if (media.genres && typeof media.genres === 'string') media.genres = JSON.parse(media.genres);
  if (media.streams_detail && typeof media.streams_detail === 'string') media.streams_detail = JSON.parse(media.streams_detail);
  return media;
}

function getMediaById(id) {
  const media = statements.getMediaById.get(id);
  return parseMediaFields(media);
}

function getMediaByTmdb(type, tmdbId, userId = null) {
  const media = statements.getMediaByTmdb.get(type, tmdbId, userId);
  return parseMediaFields(media);
}

// Restored functions
function getMediaByImdb(imdbId) {
  const media = statements.getMediaByImdb.get(imdbId);
  return parseMediaFields(media);
}

function getAllMedia() {
  return statements.getAllMedia.all().map(m => parseMediaFields(m));
}

function getMediaByType(type) {
  return statements.getMediaByType.all(type).map(m => parseMediaFields(m));
}

function deleteMedia(id) {
  return statements.deleteMedia.run(id);
}

function updateStatus(id, status) {
  return statements.updateStatus.run(status, id);
}

function addEpisode(data) {
  return statements.insertEpisode.run({
    media_id: data.media_id,
    season_number: data.season_number,
    episode_number: data.episode_number,
    title: data.title || null,
    overview: data.overview || null,
    air_date: data.air_date || null,
    monitored: data.monitored !== false ? 1 : 0
  });
}

function getEpisodes(mediaId) {
  return statements.getEpisodes.all(mediaId);
}

function countMedia() {
  const movies = db.prepare('SELECT COUNT(*) as count FROM media WHERE type = ?').get('movie').count;
  const series = db.prepare('SELECT COUNT(*) as count FROM media WHERE type = ?').get('series').count;
  const watched = db.prepare('SELECT COUNT(*) as count FROM media WHERE watched = 1').get().count;
  const available = db.prepare('SELECT COUNT(*) as count FROM media WHERE streams_available = 1').get().count;
  const unavailable = db.prepare('SELECT COUNT(*) as count FROM media WHERE streams_available = 0').get().count;

  return { movies, series, watched, available, unavailable, total: movies + series };
}

function markAsWatched(id, deleteAfter = false) {
  const now = new Date().toISOString();
  db.prepare('UPDATE media SET watched = 1, watched_at = ? WHERE id = ?').run(now, id);

  if (deleteAfter) {
    return deleteMedia(id);
  }
  return getMediaById(id);
}

function markAsUnwatched(id) {
  db.prepare('UPDATE media SET watched = 0, watched_at = NULL WHERE id = ?').run(id);
  return getMediaById(id);
}

function updateStreamStatus(id, available, streamCount, lastChecked, details = null) {
  db.prepare(`
    UPDATE media 
    SET streams_available = ?, stream_count = ?, last_stream_check = ?, streams_detail = ?
    WHERE id = ?
  `).run(available ? 1 : 0, streamCount, lastChecked, details ? JSON.stringify(details) : null, id);
  return getMediaById(id);
}

function getMediaByAvailability(available) {
  const query = db.prepare('SELECT * FROM media WHERE streams_available = ? ORDER BY added_at DESC');
  return query.all(available ? 1 : 0).map(m => parseMediaFields(m));
}

function getWatchedMedia() {
  const query = db.prepare('SELECT * FROM media WHERE watched = 1 ORDER BY watched_at DESC');
  return query.all().map(m => parseMediaFields(m));
}

function getUnwatchedMedia() {
  const query = db.prepare('SELECT * FROM media WHERE watched = 0 ORDER BY added_at DESC');
  return query.all().map(m => parseMediaFields(m));
}

function getMediaNeedingStreamCheck() {
  // Get media that hasn't been checked in 24 hours or never checked
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const query = db.prepare(`
    SELECT * FROM media 
    WHERE last_stream_check IS NULL 
       OR (streams_available = 0 AND last_stream_check < ?)
    ORDER BY last_stream_check ASC NULLS FIRST
  `);
  return query.all(oneDayAgo).map(m => parseMediaFields(m));
}

function getFilteredMedia(filters = {}) {
  let conditions = [];
  let params = [];

  if (filters.userId !== undefined) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }
  if (filters.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }
  if (filters.watched !== undefined) {
    conditions.push('watched = ?');
    params.push(filters.watched ? 1 : 0);
  }
  if (filters.available !== undefined) {
    conditions.push('streams_available = ?');
    params.push(filters.available ? 1 : 0);
  }
  if (filters.search) {
    conditions.push('(title LIKE ? OR original_title LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = db.prepare(`SELECT * FROM media ${whereClause} ORDER BY added_at DESC`);

  return query.all(...params).map(m => parseMediaFields(m));
}

// User management functions
function createUser(username, password, displayName = null, isAdmin = false) {
  const info = statements.insertUser.run({
    username,
    password_hash: hashPassword(password),
    display_name: displayName || username,
    is_admin: isAdmin ? 1 : 0
  });
  return getUserById(info.lastInsertRowid);
}

function getUserById(id) {
  return statements.getUserById.get(id);
}

function getUserByUsername(username) {
  return statements.getUserByUsername.get(username);
}

function getAllUsers() {
  return statements.getAllUsers.all();
}

function deleteUser(id) {
  // Don't allow deleting the last admin
  const user = getUserById(id);
  if (user && user.is_admin) {
    const admins = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get();
    if (admins.count <= 1) {
      throw new Error('Cannot delete the last admin user');
    }
  }
  return statements.deleteUser.run(id);
}

function updateUser(id, displayName, isAdmin) {
  return statements.updateUser.run(displayName, isAdmin ? 1 : 0, id);
}

function updateUserPassword(id, newPassword) {
  return statements.updateUserPassword.run(hashPassword(newPassword), id);
}

function verifyPassword(userId, password) {
  const user = statements.getUserById.get(userId);
  if (!user) return false;
  return user.password_hash === hashPassword(password);
}

function updateUserJellyfinId(id, jellyfinId) {
  return statements.updateUserJellyfinId.run(jellyfinId, id);
}

function updateUserStremioKey(id, stremioKey) {
  return statements.updateUserStremioKey.run(stremioKey, id);
}

function updateUserLastLogin(id) {
  return statements.updateUserLastLogin.run(new Date().toISOString(), id);
}

function getWatchedMediaByType(type) {
  const query = db.prepare('SELECT * FROM media WHERE type = ? AND watched = 1 ORDER BY watched_at DESC');
  return query.all(type).map(m => parseMediaFields(m));
}

function markEpisodeWatched(episodeId, watched = true) {
  db.prepare('UPDATE episodes SET watched = ? WHERE id = ?').run(watched ? 1 : 0, episodeId);
}

function getEpisodesWatchedStatus(mediaId) {
  const episodes = statements.getEpisodes.all(mediaId);
  const total = episodes.length;
  const watched = episodes.filter(e => e.watched).length;
  return { total, watched, allWatched: total > 0 && watched === total };
}

function getMediaByUser(userId) {
  return statements.getMediaByUser.all(userId).map(m => parseMediaFields(m));
}

function countMediaByUser(userId) {
  const movies = db.prepare('SELECT COUNT(*) as count FROM media WHERE user_id = ? AND type = ?').get(userId, 'movie').count;
  const series = db.prepare('SELECT COUNT(*) as count FROM media WHERE user_id = ? AND type = ?').get(userId, 'series').count;
  const watched = db.prepare('SELECT COUNT(*) as count FROM media WHERE user_id = ? AND watched = 1').get(userId).count;
  const available = db.prepare('SELECT COUNT(*) as count FROM media WHERE user_id = ? AND streams_available = 1').get(userId).count;

  return { movies, series, watched, available, total: movies + series };
}

module.exports = {
  db,
  hashPassword,
  // Media functions
  addMedia,
  getMediaById,
  getMediaByTmdb,
  getMediaByImdb,
  getAllMedia,
  getMediaByType,
  getMediaByUser,
  deleteMedia,
  updateStatus,
  addEpisode,
  getEpisodes,
  countMedia,
  countMediaByUser,
  // Watch/Stream functions
  markAsWatched,
  markAsUnwatched,
  updateStreamStatus,
  getMediaByAvailability,
  getWatchedMedia,
  getUnwatchedMedia,
  getMediaNeedingStreamCheck,
  getFilteredMedia,
  // User functions
  createUser,
  getUserById,
  getUserByUsername,
  getAllUsers,
  deleteUser,
  updateUser,
  updateUserPassword,
  verifyPassword,
  updateUserJellyfinId,
  updateUserStremioKey,
  updateUserLastLogin,
  getWatchedMediaByType,
  markEpisodeWatched,
  getEpisodesWatchedStatus,
  // Settings functions
  getSetting,
  setSetting,
  getAllSettings
};

// Settings functions
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) 
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `).run(key, value, value);
  return { key, value };
}

function getAllSettings() {
  return db.prepare('SELECT key, value FROM settings').all()
    .reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
}
