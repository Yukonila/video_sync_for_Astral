const WebSocket = require("ws");
const os = require("os");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();

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
console.log("扩展里填写服务器地址时，格式如下（注意不要带尖括号）：");
console.log("  另一台机器：ws://<Astral虚拟IP>:3000/ws");
console.log("  本机自己：  ws://127.0.0.1:3000/ws");
console.log("");
console.log("举例：如果 Astral 虚拟 IP 是 10.126.126.1，就填");
console.log("  ws://10.126.126.1:3000/ws");
console.log("========================================");

wss.on("connection", (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roomId = url.searchParams.get("room") || "default";

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);
    ws.roomId = roomId;

    const peers = rooms.get(roomId);
    console.log(`[+] room=${roomId} 当前连接数=${peers.size}`);

    ws.send(JSON.stringify({ type: "joined", room: roomId }));

    ws.on("message", (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch { return; }

        if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", t: data.t }));
            return;
        }

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