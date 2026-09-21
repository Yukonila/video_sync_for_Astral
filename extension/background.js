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
        reconnectAttempts = 0;           // 连接成功，重置退避计数
        ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        startKeepalive();
    };

    ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === "pong" || data.type === "joined") return;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, data).catch(() => { });
            }
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

    // 每 20 秒做两件事：
    // 1. 发 WebSocket ping，保持连接活跃
    // 2. 调一次 chrome.runtime.getPlatformInfo，
    //    这是 Chrome 官方推荐的方式，能重置 Service Worker 的 30 秒空闲计时器
    keepaliveTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        }
        chrome.runtime.getPlatformInfo(() => { });
    }, 20000);
}

function stopKeepalive() {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

function scheduleReconnect() {
    if (reconnectTimer) return;

    // 指数退避：2s, 4s, 8s, 16s, 最多 30s
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

// Service Worker 启动时自动连接
connect();