const http = require('http');
const https = require('https');

function requestJson(url, apiKey, timeoutMs) {
    return new Promise((resolve, reject) => {
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.get(url, {
            headers: apiKey ? { 'X-Api-Key': apiKey } : {}
        }, (response) => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { data += chunk; });
            response.on('error', reject);
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    const error = new Error(response.statusCode === 401 || response.statusCode === 403
                        ? 'Seerr rejected the API key. Check the key and its permissions.'
                        : `Seerr returned HTTP ${response.statusCode}`);
                    error.code = response.statusCode === 401 || response.statusCode === 403
                        ? 'SEERR_AUTH_FAILED' : 'SEERR_HTTP_ERROR';
                    return reject(error);
                }
                try {
                    const json = JSON.parse(data);
                    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error();
                    resolve(json);
                } catch {
                    reject(new Error('Seerr returned an invalid JSON response'));
                }
            });
        });
        const timer = setTimeout(() => {
            const error = new Error('Connection timeout');
            error.code = 'SEERR_TIMEOUT';
            request.destroy(error);
        }, timeoutMs);
        request.on('error', reject);
        request.on('close', () => clearTimeout(timer));
    });
}

async function testSeerrConnection({ url, apiKey }, timeoutMs = 5000) {
    let base;
    try {
        base = new URL(url);
        if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error();
    } catch {
        const error = new Error('A valid HTTP or HTTPS Seerr URL is required');
        error.code = 'INVALID_URL';
        throw error;
    }
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    base.search = '';
    base.hash = '';
    base.pathname = base.pathname.replace(/\/+$/, '') + '/';
    const status = await requestJson(new URL('api/v1/status', base), key, timeoutMs);
    if (typeof status.version !== 'string') throw new Error('Unexpected Seerr status response');
    if (key) await requestJson(new URL('api/v1/settings/main', base), key, timeoutMs);
    return {
        success: true,
        version: status.version,
        apiKeyValidated: Boolean(key),
        message: key
            ? `Connected to Seerr v${status.version}; API key validated`
            : `Connected to Seerr v${status.version}; no API key supplied, authentication not tested`
    };
}

async function handleSeerrConnectionTest(req, res) {
    try {
        res.json(await testSeerrConnection(req.body));
    } catch (error) {
        res.status(error.code === 'INVALID_URL' ? 400 : error.code === 'SEERR_TIMEOUT' ? 504 : 502)
            .json({ error: error.message, code: error.code || 'SEERR_CONNECTION_FAILED' });
    }
}

module.exports = { testSeerrConnection, handleSeerrConnectionTest };
