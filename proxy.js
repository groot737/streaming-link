import http from 'http';
import url from 'url';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// Simple In-Memory Cache for API lookups
// Key: episodeId + mediaId, Value: { url: string, expiry: number }
const apiCache = new Map();
const CACHE_DURATION = 3600 * 1000; // 1 hour

// Create a simple HTTP server
const server = http.createServer(async (req, res) => {
    // 1. Enable CORS so your player.html (on port 8080) can access this
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);

    // 0. Serve the HTML Player at root "/"
    if (parsedUrl.pathname === '/') {
        fs.readFile(path.join(__dirname, 'player.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading player.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
        return;
    }

    // 2. NEW: Universal M3U8 Endpoint
    // Usage: /m3u8?mediaId=...&episodeId=...
    if (parsedUrl.pathname === '/m3u8') {
        const serversUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/servers";
        const watchUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/watch";

        const episodeId = parsedUrl.query.episodeId || "10766";
        const mediaId = parsedUrl.query.mediaId || "tv/watch-rick-and-morty-39480";
        const cacheKey = `${episodeId}-${mediaId}`;

        // CHECK CACHE
        if (apiCache.has(cacheKey)) {
            const cached = apiCache.get(cacheKey);
            if (Date.now() < cached.expiry) {
                const proxyUrl = `/proxy?url=${encodeURIComponent(cached.url)}`;
                res.writeHead(302, { 'Location': proxyUrl });
                res.end();
                return;
            }
        }

        try {
            const { data: servers } = await axios.get(serversUrl, { params: { episodeId, mediaId } });
            const upcloud = servers.find(s => s.name === "upcloud");
            if (!upcloud) throw new Error("Upcloud server not found");

            let streamData;
            try {
                const res = await axios.get(watchUrl, { params: { episodeId, mediaId, server: upcloud.name } });
                streamData = res.data;
            } catch (err) {
                const res = await axios.get(watchUrl, { params: { episodeId, mediaId, server: upcloud.id } });
                streamData = res.data;
            }

            // Find the best sources (M3U8)
            const source = streamData.sources.find(s => s.quality === 'auto') || streamData.sources[0];

            // SAVE TO CACHE
            apiCache.set(cacheKey, { url: source.url, expiry: Date.now() + CACHE_DURATION });

            // Redirect to our smart proxy to handle the manifest rewriting
            const proxyUrl = `/proxy?url=${encodeURIComponent(source.url)}`;
            res.writeHead(302, { 'Location': proxyUrl });
            res.end();

        } catch (error) {
            console.error('[M3U8 Error]', error.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // 3. JSON API (Keep for the frontend player if needed)
    if (parsedUrl.pathname === '/fetch-stream') {
        const serversUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/servers";
        const watchUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/watch";

        // Get params from the URL query
        const episodeId = parsedUrl.query.episodeId || "10766";
        const mediaId = parsedUrl.query.mediaId || "tv/watch-rick-and-morty-39480";

        console.log(`[API] Fetching stream data for episodeId: ${episodeId}, mediaId: ${mediaId}...`);

        try {
            // A. Get servers
            const { data: servers } = await axios.get(serversUrl, {
                params: { episodeId, mediaId }
            });

            // B. Find upcloud
            const upcloud = servers.find(s => s.name === "upcloud");
            if (!upcloud) throw new Error("Upcloud server not found");

            // C. Get Stream Source
            // Try name first, then ID (Robustness from index.js)
            let streamData;
            try {
                const res = await axios.get(watchUrl, {
                    params: { episodeId, mediaId, server: upcloud.name }
                });
                streamData = res.data;
            } catch (err) {
                console.log("[API] Name failed, trying ID...");
                const res = await axios.get(watchUrl, {
                    params: { episodeId, mediaId, server: upcloud.id }
                });
                streamData = res.data;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(streamData));

        } catch (error) {
            console.error('[API Error]', error.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // 4. The Smart Proxy Endpoint
    if (parsedUrl.pathname === '/proxy') {
        const targetUrl = parsedUrl.query.url;

        if (!targetUrl) {
            res.statusCode = 400;
            res.end('Missing url parameter');
            return;
        }

        // Helper to check if it's an M3U8
        const isM3u8 = targetUrl.includes('.m3u8');

        // Optimization: Removed console.log for hot path
        // console.log(`[Proxy] Fetching: ${targetUrl}`);

        try {
            // Common Headers
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/83.0.4103.116 Safari/537.36',
                'Referer': 'https://streameeeeee.site/',
                'Origin': 'https://streameeeeee.site'
            };

            if (isM3u8) {
                // FETCH AND REWRITE
                const response = await axios.get(targetUrl, { headers, responseType: 'text' });

                // Rewrite the manifest
                // 1. Resolve relative URLs to absolute
                // 2. Wrap all URLs in our proxy
                const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
                let manifest = response.data;

                // Determine protocol: Use 'https' if we are on production (Railway usually sets x-forwarded-proto)
                // Default to https, UNLESS we are on localhost
                let protocol = req.headers['x-forwarded-proto'] || 'https';
                const host = req.headers.host;
                if (host && (host.includes('localhost') || host.includes('127.0.0.1'))) {
                    protocol = 'http';
                }

                // Regex to find all lines that are URLs (not starting with #)
                // This covers both absolute (http...) and relative (segment.ts)
                manifest = manifest.replace(/^(?!#)(.+)$/gm, (match) => {
                    let absoluteUrl = match;
                    if (!match.startsWith('http')) {
                        absoluteUrl = new URL(match, baseUrl).toString();
                    }
                    return `${protocol}://${host}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                });

                // Also fix URI="..." in #EXT-X-KEY
                manifest = manifest.replace(/URI="([^"]+)"/g, (match, p1) => {
                    let absoluteUrl = p1;
                    if (!p1.startsWith('http')) {
                        absoluteUrl = new URL(p1, baseUrl).toString();
                    }
                    return `URI="${protocol}://${host}/proxy?url=${encodeURIComponent(absoluteUrl)}"`;
                });

                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(manifest);

            } else {
                // STREAM BINARY (TS FILES/IMAGES)
                const response = await axios({
                    method: 'get',
                    url: targetUrl,
                    responseType: 'stream',
                    headers
                });

                if (response.headers['content-type']) {
                    res.setHeader('Content-Type', response.headers['content-type']);
                }
                res.setHeader('Access-Control-Allow-Origin', '*');
                response.data.pipe(res);
            }

        } catch (error) {
            console.error('[Proxy Error]', error.message);
            res.statusCode = 500;
            res.end('Proxy Error');
        }
    } else {
        res.end('Server Running.');
    }
});

server.listen(PORT, () => {
    console.log(`\n>>> Local Proxy Server running at http://localhost:${PORT}`);
    console.log(`>>> Use this in your player: http://localhost:${PORT}/proxy?url=...`);
});
