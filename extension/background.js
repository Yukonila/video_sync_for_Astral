let ws = null;
let reconnectTimer = null;
let keepaliveTimer = null;
let currentRoomId = null;
let currentServerUrl = null;

async function getConfig() {
    const { serverUrl, roomId } = await chrome.storage.local.get(["serverUrl", "roomId"]);
    return { serverUrl: (serverUrl || "").trim(), roomId: (roomId || "").trim() };
}

async function connect() {
    const { serverUrl, roomId } = await getConfig();
    currentServerUrl = serverUrl;
    currentRoomId = roomId;

    // 必须同时有服务器地址和房间号才连接
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
    keepaliveTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        }
    }, 20000);
}

function stopKeepalive() {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 2000);
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
        connect();
    }
    return true;
});

chrome.tabs.onActivated.addListener(() => {
    if (ws?.readyState !== WebSocket.OPEN) connect();
});

// Service Worker 启动时尝试自动连接
connect();