import http from 'http';
import url from 'url';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

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

    // 2. NEW: Endpoint to get the stream data (logic from index.js)
    if (parsedUrl.pathname === '/fetch-stream') {
        const serversUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/servers";
        const watchUrl = "https://consumet-eta-five.vercel.app/movies/flixhq/watch";

        console.log("[API] Fetching stream data...");

        try {
            // A. Get servers
            const { data: servers } = await axios.get(serversUrl, {
                params: { episodeId: "10766", mediaId: "tv/watch-rick-and-morty-39480" }
            });

            // B. Find upcloud
            const upcloud = servers.find(s => s.name === "upcloud");
            if (!upcloud) throw new Error("Upcloud server not found");

            // C. Get Stream Source
            // Try name first, then ID (Robustness from index.js)
            let streamData;
            try {
                const res = await axios.get(watchUrl, {
                    params: { episodeId: "10766", mediaId: "tv/watch-rick-and-morty-39480", server: upcloud.name }
                });
                streamData = res.data;
            } catch (err) {
                console.log("[API] Name failed, trying ID...");
                const res = await axios.get(watchUrl, {
                    params: { episodeId: "10766", mediaId: "tv/watch-rick-and-morty-39480", server: upcloud.id }
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

    // 3. The /proxy endpoint
    if (parsedUrl.pathname === '/proxy') {
        const targetUrl = parsedUrl.query.url;

        if (!targetUrl) {
            res.statusCode = 400;
            res.end('Missing url parameter');
            return;
        }

        console.log(`[Proxy] Fetching: ${targetUrl}`);

        try {
            // 3. Request the target URL with the necessary Headers to bypass blocking
            // These headers mimic a real browser visiting the site where the video is embedded
            const response = await axios({
                method: 'get',
                url: targetUrl,
                responseType: 'stream', // Important for video
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36',
                    'Referer': 'https://streameeeeee.site/', // The magic key to open the door
                    'Origin': 'https://streameeeeee.site'
                }
            });

            // 4. Forward the Content-Type (e.g., application/vnd.apple.mpegurl)
            if (response.headers['content-type']) {
                res.setHeader('Content-Type', response.headers['content-type']);
            }

            // 5. Pipe the data back to the player
            response.data.pipe(res);

        } catch (error) {
            console.error('[Proxy Error]', error.message);
            res.statusCode = 500;
            res.end('Proxy Error: ' + error.message);
        }
    } else {
        res.end('Local Proxy is running. Usage: /proxy?url=TARGET_URL');
    }
});

server.listen(PORT, () => {
    console.log(`\n>>> Local Proxy Server running at http://localhost:${PORT}`);
    console.log(`>>> Use this in your player: http://localhost:${PORT}/proxy?url=...`);
});
