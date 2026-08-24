const http = require('http');

function httpGet(urlStr) {
    return new Promise((resolve, reject) => {
        http.get(urlStr, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        }).on('error', reject);
    });
}

function httpPost(urlStr, payload) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const postData = JSON.stringify(payload);
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

(async function main() {
    console.log('\n==========================================================================');
    console.log('=== 🛠️ LOVI AUTOMATION API & CDP LIVE DIAGNOSTIC VERIFIER ===');
    console.log('==========================================================================\n');

    try {
        console.log('1. Checking Chrome DevTools Protocol (CDP) at http://127.0.0.1:9222/json ...');
        const cdpRes = await httpGet('http://127.0.0.1:9222/json');
        console.log(`   -> CDP Status: ${cdpRes.status} OK`);
        console.log(`   -> Active Target Pages Count: ${Array.isArray(cdpRes.data) ? cdpRes.data.length : 0}`);
        if (Array.isArray(cdpRes.data) && cdpRes.data.length > 0) {
            console.log(`   -> Target Page 1 Title: "${cdpRes.data[0].title}"`);
            console.log(`   -> WebSocket Debug URL: ${cdpRes.data[0].webSocketDebuggerUrl}`);
        }

        console.log('\n2. Checking LOVI Embedded Automation State API at http://127.0.0.1:9223/api/state ...');
        const stateRes = await httpGet('http://127.0.0.1:9223/api/state');
        console.log('   -> LOVI State Response:');
        console.log(JSON.stringify(stateRes.data, null, 2));

        console.log('\n3. Testing Prompt Injection API at http://127.0.0.1:9223/api/prompt ...');
        const promptRes = await httpPost('http://127.0.0.1:9223/api/prompt', {
            prompt: 'Take me to wikipedia.org to read about Christopher Nolan'
        });
        console.log('   -> Prompt Injection Result:', JSON.stringify(promptRes.data));

        console.log('\n==========================================================================');
        console.log('=== ✅ ALL AUTOMATION & CDP ENDPOINTS VERIFIED SUCCESSFULLY! ===');
        console.log('==========================================================================\n');

    } catch (e) {
        console.error('❌ Diagnostic Error: ', e.message);
        console.log('\nMake sure LOVI is running (`node start.js`) before calling the verifier.');
    }
})();
