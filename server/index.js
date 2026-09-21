const WebSocket = require("ws");
const os = require("os");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

// 房间号 -> Set<WebSocket>
const rooms = new Map();

// 打印本机所有 IPv4 地址，方便你确认该填哪个
function getLocalIPs() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === "IPv4" && !net.internal) {
                ips.push({ iface: name, ip: net.address });
            }
        }
    }
    return ips;
}

console.log("========================================");
console.log(`Video Sync server listening on port ${PORT}`);
console.log("----------------------------------------");
console.log("本机可用 IPv4 地址：");
for (const { iface, ip } of getLocalIPs()) {
    console.log(`  [${iface}] ${ip}`);
}
console.log("----------------------------------------");
console.log("另一台机器请填：ws://<上面某个IP>:3000/ws");
console.log("本机自己请填：  ws://127.0.0.1:3000/ws");
console.log("========================================");

wss.on("connection", (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get("room") || "default";

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);
    ws.roomId = roomId;

    const peers = rooms.get(roomId);
    console.log(`[+] room=${roomId} 当前连接数=${peers.size}`);

    // 通知客户端已加入
    ws.send(JSON.stringify({ type: "joined", room: roomId }));

    ws.on("message", (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        // 心跳：直接回 pong，不走广播
        if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", t: data.t }));
            return;
        }

        // 广播给同房间其他连接
        const out = raw.toString();
        for (const peer of peers) {
            if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                peer.send(out);
            }
        }
    });

    ws.on("close", () => {
        peers.delete(ws);
        console.log(`[-] room=${roomId} 当前连接数=${peers.size}`);
        if (peers.size === 0) rooms.delete(roomId);
    });

    ws.on("error", () => {
        try { ws.close(); } catch { }
    });
});