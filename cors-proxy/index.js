const cors_proxy = require('cors-anywhere');
const http = require('http');

const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 8085;

// Create the base cors-anywhere server
const proxyServer = cors_proxy.createServer({
    originWhitelist: [], // Allow all origins
    requireHeader: [],
    removeHeaders: ['cookie', 'cookie2']
});

// Intercept requests on our own HTTP server to spoof headers for specific hosts
const server = http.createServer((req, res) => {
    const targetUrl = req.url.substring(1); // Strip leading slash to get target URL

    if (!targetUrl) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('CORS Proxy Active');
        return;
    }

    console.log(`[CORS Proxy] Target: ${targetUrl}`);

    if (targetUrl.includes('kwik.cx') || targetUrl.includes('pahe')) {
        req.headers['referer'] = 'https://kwik.cx/';
        req.headers['origin'] = 'https://kwik.cx';
        console.log(`[CORS Proxy] Spoofing Referer/Origin for Kwik/Pahe`);
    } else if (targetUrl.includes('hitv') || targetUrl.includes('hj.c') || targetUrl.includes('shortv')) {
        req.headers['referer'] = 'https://www.hitv.app/';
        req.headers['origin'] = 'https://www.hitv.app';
        console.log(`[CORS Proxy] Spoofing Referer/Origin for HiTV`);
    }

    res.on('finish', () => {
        console.log(`[CORS Proxy] Status: ${res.statusCode} for ${targetUrl}`);
    });

    // Forward the request to the cors-anywhere handler
    proxyServer.emit('request', req, res);
});

server.listen(port, host, function() {
    console.log('Running CORS Anywhere with Referer Spoofing on ' + host + ':' + port);
});
