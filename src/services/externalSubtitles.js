const crypto = require("node:crypto");
const canonical = (s) =>
  String(s || "")
    .split(" • ")[0]
    .trim()
    .replace(/\.(srt|vtt|ass|ssa|mkv|mp4|avi|m4v)$/i, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const language = (s) =>
  ({
    fre: "fr",
    fra: "fr",
    eng: "en",
    deu: "de",
    ger: "de",
    spa: "es",
    ita: "it",
    por: "pt",
  })[s] || s;
function schema(db) {
  db.db.exec(
    `CREATE TABLE IF NOT EXISTS external_subtitles(id TEXT NOT NULL,media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,stream_id TEXT NOT NULL,release TEXT NOT NULL,language TEXT NOT NULL,translated INTEGER NOT NULL,srt TEXT NOT NULL,PRIMARY KEY(id,media_id));`,
  );
}
// Only call this on the authenticated Remix response, never arbitrary addon data.
function accept(db, media, streamId, stream, target) {
  const p = stream.externalSubtitle;
  delete stream.externalSubtitle;
  if (
    !p ||
    !/^[a-f0-9]{64}$/.test(p.id) ||
    language(p.language) !== language(target) ||
    typeof p.srt !== "string" ||
    Buffer.byteLength(p.srt) > 512 * 1024 ||
    canonical(p.release) !== canonical(stream.title) ||
    typeof p.translated !== "boolean" ||
    p.srt.includes("[TRANSLATION_ERROR]")
  )
    return false;
  if (
    (
      p.srt.match(
        /^\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3}/gm,
      ) || []
    ).length < 2
  )
    return false;
  if (!db.db || !media.id) return false;
  schema(db);
  const id = crypto
    .createHash("sha256")
    .update(p.id + "\0" + media.id)
    .digest("hex");
  db.db
    .prepare(
      "INSERT OR REPLACE INTO external_subtitles(id,media_id,stream_id,release,language,translated,srt) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      id,
      media.id,
      streamId,
      p.release,
      language(p.language),
      p.translated ? 1 : 0,
      p.srt,
    );
  Object.defineProperty(stream, "verifiedExternalSubtitle", {
    value: { id, language: language(p.language), translated: p.translated },
    enumerable: true,
  });
  return true;
}
function routes(app, db, baseURL) {
  schema(db);
  const list = (req, res) => {
    if (!["movie", "series"].includes(req.params.type))
      return res.json({ subtitles: [] });
    const uid = Number(req.params.userId || 0);
    if (req.params.userId && (!Number.isSafeInteger(uid) || uid < 1))
      return res.json({ subtitles: [] });
    const extra = new URLSearchParams(req.params.extra || "");
    const filename = extra.get("filename") || req.query.filename;
    if (!filename) return res.json({ subtitles: [] });
    const rows = db.db
      .prepare(
        "SELECT e.* FROM external_subtitles e JOIN media m ON m.id=e.media_id WHERE e.stream_id=? AND m.type=? AND m.streams_available=1 AND (?=0 OR m.user_id=?) LIMIT 100",
      )
      .all(req.params.id, req.params.type, uid, uid);
    const base = (baseURL || `${req.protocol}://${req.get("host")}`).replace(
      /\/$/,
      "",
    );
    res.json({
      subtitles: rows
        .filter((r) => canonical(r.release) === canonical(filename))
        .map((r) => ({
          id: r.id,
          lang:
            {
              fr: "fre",
              en: "eng",
              de: "ger",
              es: "spa",
              it: "ita",
              pt: "por",
            }[r.language] || r.language,
          label: `SubMaker · ${r.translated ? "IA · " : ""}${r.release}`,
          url: `${base}/external-subtitles/${r.id}.srt`,
        })),
    });
  };
  app.get(
    [
      "/subtitles/:type/:id.json",
      "/subtitles/:type/:id/:extra.json",
      "/user/:userId/subtitles/:type/:id.json",
      "/user/:userId/subtitles/:type/:id/:extra.json",
    ],
    list,
  );
  app.get("/external-subtitles/:id.srt", (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) return res.sendStatus(404);
    const row = db.db
      .prepare(
        "SELECT e.srt FROM external_subtitles e JOIN media m ON m.id=e.media_id WHERE e.id=? AND m.streams_available=1",
      )
      .get(req.params.id);
    if (!row) return res.sendStatus(404);
    res
      .type("text/plain; charset=utf-8")
      .set("Cache-Control", "private, max-age=300")
      .set("X-Content-Type-Options", "nosniff")
      .send(row.srt);
  });
}
module.exports = { accept, routes, canonical, language };
