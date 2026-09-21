let ws = null;
let reconnectTimer = null;
let keepaliveTimer = null;
let currentRoomId = null;
let currentServerUrl = null;
let reconnectAttempts = 0;

async function getConfig() {
    const { serverUrl, roomId } = await chrome.storage.local.get(["serverUrl", "roomId"]);
    return { serverUrl: (serverUrl || "").trim(), roomId: (roomId || "").trim() };
}

// 判断两个 URL 是否指向同一个视频（针对 B 站优化）
function isSameVideo(url1, url2) {
    if (!url1 || !url2) return false;

    try {
        const a = new URL(url1);
        const b = new URL(url2);

        // B 站特殊处理
        if (a.hostname.includes("bilibili.com") && b.hostname.includes("bilibili.com")) {
            const bvA = a.pathname.match(/\/(BV[0-9A-Za-z]+)/);
            const bvB = b.pathname.match(/\/(BV[0-9A-Za-z]+)/);
            const avA = a.pathname.match(/\/av(\d+)/);
            const avB = b.pathname.match(/\/av(\d+)/);

            const idA = bvA ? bvA[1] : (avA ? "av" + avA[1] : null);
            const idB = bvB ? bvB[1] : (avB ? "av" + avB[1] : null);

            if (!idA || !idB) return false;
            if (idA !== idB) return false;

            const pA = a.searchParams.get("p") || "1";
            const pB = b.searchParams.get("p") || "1";
            return pA === pB;
        }

        // 其他网站：origin + pathname 相同即可
        return a.origin === b.origin && a.pathname === b.pathname;
    } catch {
        return url1 === url2;
    }
}

async function connect() {
    const { serverUrl, roomId } = await getConfig();
    currentServerUrl = serverUrl;
    currentRoomId = roomId;

    if (!serverUrl || !roomId) {
        console.log("Config incomplete, not connecting");
        return;
    }

    if (ws) {
        try { ws.close(); } catch { }
        ws = null;
    }

    try {
        const url = `${serverUrl}?room=${encodeURIComponent(roomId)}`;
        ws = new WebSocket(url);
    } catch (e) {
        console.error("WebSocket create failed:", e);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        console.log("WS connected");
        reconnectAttempts = 0;
        ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        startKeepalive();
    };

    ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === "pong" || data.type === "joined") return;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            const currentUrl = tabs[0].url || "";

            // 对方发来的 URL 和当前页不是同一个视频，弹提示
            if (data.url && currentUrl && !isSameVideo(data.url, currentUrl)) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: "show-open-hint",
                    url: data.url,
                    title: data.title
                }).catch(() => { });
                return;
            }

            // 同一个视频（或对方没带 url），正常同步播放状态
            chrome.tabs.sendMessage(tabs[0].id, data).catch(() => { });
        });
    };

    ws.onclose = () => {
        console.log("WS closed, reconnecting...");
        stopKeepalive();
        scheduleReconnect();
    };

    ws.onerror = () => {
        try { ws?.close(); } catch { }
    };
}

function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        }
        // 官方推荐的保活方式，重置 Service Worker 空闲计时器
        chrome.runtime.getPlatformInfo(() => { });
    }, 20000);
}

function stopKeepalive() {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

function scheduleReconnect() {
    if (reconnectTimer) return;

    const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;

    console.log(`Reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "sync-action" && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg.payload));
    }
    if (msg.type === "get-status") {
        sendResponse({
            connected: ws?.readyState === WebSocket.OPEN,
            room: currentRoomId,
            server: currentServerUrl
        });
    }
    if (msg.type === "config-updated") {
        reconnectAttempts = 0;
        connect();
    }
    return true;
});

chrome.tabs.onActivated.addListener(() => {
    if (ws?.readyState !== WebSocket.OPEN) connect();
});

connect();