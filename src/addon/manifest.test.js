const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('HTTP manifests preserve catalogue identities and require cache revalidation', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-manifest-'));
    const reservation = net.createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const child = spawn(process.execPath, ['src/index.js'], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(port), BASE_URL: 'https://catalog.example' },
        stdio: 'ignore'
    });
    t.after(async () => {
        if (child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
        try { ready = (await fetch(`${base}/health`)).ok; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'server starts');
    const created = await fetch(`${base}/api/auth/create-first-user`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'manifest-test', password: 'local-test-password' })
    });
    assert.equal(created.status, 200);
    const { userId } = await created.json();
    const ids = [];
    for (const prefix of ['', `/user/${userId}`]) {
        const response = await fetch(`${base}${prefix}/manifest.json`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-cache');
        const manifest = await response.json();
        ids.push(manifest.id);
        assert.equal(manifest.version, '1.2.0');
        assert.deepEqual(manifest.resources, ['catalog', 'meta', 'subtitles']);
        assert.deepEqual(manifest.catalogs.map(c => [c.type, c.id]), [
            ['movie', 'seerr-movies'], ['series', 'seerr-series']
        ]);
        for (const catalog of manifest.catalogs) {
            const result = await fetch(`${base}${prefix}/catalog/${catalog.type}/${catalog.id}.json`);
            assert.equal(result.status, 200);
            assert.deepEqual(await result.json(), { metas: [] });
        }
        const revalidated = await new Promise((resolve, reject) => {
            http.get(`${base}${prefix}/manifest.json`, {
                headers: { 'If-None-Match': response.headers.get('etag') }
            }, result => { result.resume(); resolve(result); }).on('error', reject);
        });
        assert.equal(revalidated.statusCode, 304);
        assert.equal(revalidated.headers['cache-control'], 'no-cache');
    }
    assert.deepEqual(ids, ['community.seerrcatalog', `com.seerrcatalog.user.${userId}`]);
    assert.equal((await fetch(`${base}/user/999999/manifest.json`)).status, 404);
});
