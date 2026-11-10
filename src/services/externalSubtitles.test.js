const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seerr-submaker-"));
process.env.DATA_DIR = dir;
const db = require("../db"),
  ext = require("./externalSubtitles"),
  supplemental = require("./supplementalSearch");
const { checkStreamsWithUserAddons } = require("./stremio");
const { recordStreamCheck } = require("./mediaEvents");
const srt =
  "1\n00:00:01,000 --> 00:00:03,000\nBonjour.\n\n2\n00:00:04,000 --> 00:00:06,000\nÀ bientôt.\n";
const user = db.createUser("subtitle-test", "test-password", "Test", true);
let id = 100;
const add = () =>
  db.addMedia({
    user_id: user.id,
    type: "movie",
    tmdb_id: id++,
    imdb_id: "tt1234567",
    title: "Example Movie",
  });
const stream = (letter = "a") => ({
  title: "Example.Movie.2024.1080p.WEB-DL-GROUP",
  infoHash: letter.repeat(40),
  externalSubtitle: {
    id: letter.repeat(64),
    release: "Example.Movie.2024.1080p.WEB-DL-GROUP",
    language: "fr",
    translated: true,
    srt,
  },
});
test.after(() => {
  db.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test("rejects unbound releases, other language and translation errors; does not keep raw proof on stream", () => {
  const media = add();
  for (const mutate of [
    (s) => (s.externalSubtitle.release = "Another.Movie"),
    (s) => (s.externalSubtitle.language = "de"),
    (s) => (s.externalSubtitle.srt = "[TRANSLATION_ERROR]"),
    (s) => (s.externalSubtitle.id = "bad"),
  ]) {
    const s = stream();
    mutate(s);
    assert.equal(ext.accept(db, media, media.imdb_id, s, "fr"), false);
    assert.equal(s.externalSubtitle, undefined);
  }
  const s = stream();
  assert.equal(ext.accept(db, media, media.imdb_id, s, "fr"), true);
  assert.equal(s.externalSubtitle, undefined);
  assert.ok(s.verifiedExternalSubtitle);
  assert.equal(JSON.stringify(s).includes("Bonjour"), false);
});
test("two distinct VO releases with stored subtitles become available; duplicates and pending never count twice", async (t) => {
  const old = global.fetch;
  t.after(() => (global.fetch = old));
  const media = add();
  supplemental.updateSettings(db, {
    mode: "remix",
    remixUrl: "https://remix.fixture",
    remixToken: "x".repeat(64),
  });
  let streams = [stream(), stream("b")],
    pending = false;
  global.fetch = async (_url, opts) => {
    const req = JSON.parse(opts.body);
    assert.equal(req.externalSubtitles, true);
    assert.equal(req.subtitleLanguage, "fr");
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          schema: "seerrcatalog.search.v1",
          streams,
          conclusive: true,
          subtitlesPending: pending,
        }),
    };
  };
  const filters = {
    languageTags: ["FRENCH", "MULTI"],
    externalSubtitles: true,
    externalSubtitleLanguage: "fr",
  };
  const check = () =>
    checkStreamsWithUserAddons(
      media,
      null,
      null,
      filters,
      [],
      null,
      false,
      (ids) => supplemental.search(db, media, ids, filters),
    );
  let r = await check();
  assert.equal(r.available, true);
  assert.equal(r.streamCount, 2);
  assert.equal(r.appliedFilters.externalSubtitleTranslated, true);
  const otherUser = db.createUser(
    "subtitle-other",
    "test-password",
    "Other",
    false,
  );
  const otherMedia = db.addMedia({
    user_id: otherUser.id,
    type: "movie",
    tmdb_id: media.tmdb_id,
    imdb_id: media.imdb_id,
    title: media.title,
  });
  await supplemental.search(db, otherMedia, [media.imdb_id], filters);
  assert.equal(
    db.db
      .prepare("SELECT count(*) AS n FROM external_subtitles WHERE media_id=?")
      .get(otherMedia.id).n,
    2,
  );

  supplemental.updateSettings(db, {
    mode: "remix",
    remixUrl: "https://remix.fixture",
    remixToken: "",
  });
  streams = [stream(), stream()];
  r = await check();
  assert.equal(r.streamCount, 1);
  assert.equal(r.available, false);
  supplemental.updateSettings(db, {
    mode: "remix",
    remixUrl: "https://remix.fixture",
    remixToken: "",
  });
  streams = [];
  pending = true;
  r = await check();
  assert.equal(r.available, false);
  assert.equal(r.subtitlesPending, true);
  await recordStreamCheck(db, media, r, () => {});
  assert.equal(db.getMediaById(media.id).streams_available, 0);
  assert.ok(
    Date.parse(db.getMediaById(media.id).next_search_at) <= Date.now() + 301000,
  );
});
test("Stremio serves stored SRT only for an available matching video and removes access on deletion", async (t) => {
  const express = require("express"),
    app = express();
  ext.routes(app, db, "http://fixture");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => server.close());
  const base = "http://127.0.0.1:" + server.address().port;
  const media = add(),
    s = stream("c");
  ext.accept(db, media, media.imdb_id, s, "fr");
  let r = await fetch(
    base + "/external-subtitles/" + s.verifiedExternalSubtitle.id + ".srt",
  );
  assert.equal(r.status, 404);
  db.updateStreamStatus(media.id, true, 2, new Date().toISOString(), []);
  r = await fetch(
    base +
      "/subtitles/movie/" +
      media.imdb_id +
      "/filename=Example.Movie.2024.1080p.WEB-DL-GROUP.mkv.json",
  );
  assert.ok((await r.json()).subtitles.length > 0);
  r = await fetch(
    base +
      "/subtitles/movie/" +
      media.imdb_id +
      "/filename=Other.Movie.mkv.json",
  );
  assert.deepEqual((await r.json()).subtitles, []);
  r = await fetch(
    base + "/external-subtitles/" + s.verifiedExternalSubtitle.id + ".srt",
  );
  assert.equal(await r.text(), srt);
  db.db.prepare("DELETE FROM media WHERE id=?").run(media.id);
  assert.equal(
    (
      await fetch(
        base + "/external-subtitles/" + s.verifiedExternalSubtitle.id + ".srt",
      )
    ).status,
    404,
  );
});
