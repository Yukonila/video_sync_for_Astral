document.addEventListener("DOMContentLoaded", async () => {
    const { serverUrl, roomId } = await chrome.storage.local.get(["serverUrl", "roomId"]);
    const serverEl = document.getElementById("server");
    const roomEl = document.getElementById("room");
    const saveBtn = document.getElementById("save");
    const statusEl = document.getElementById("status");

    serverEl.value = serverUrl || "";
    roomEl.value = roomId || "";

    function updateButtonState() {
        const ok = serverEl.value.trim() && roomEl.value.trim();
        saveBtn.disabled = !ok;
    }
    updateButtonState();

    serverEl.addEventListener("input", updateButtonState);
    roomEl.addEventListener("input", updateButtonState);

    const status = await chrome.runtime.sendMessage({ type: "get-status" }).catch(() => null);
    statusEl.textContent = status?.connected
        ? `已连接（房间 ${status.room}）`
        : "未连接";

    document.getElementById("generate").onclick = () => {
        roomEl.value = crypto.randomUUID().slice(0, 8);
        updateButtonState();
    };

    saveBtn.onclick = async () => {
        const server = serverEl.value.trim();
        const room = roomEl.value.trim();

        if (!server) { alert("请填写服务器地址"); return; }
        if (!room) { alert("请填写房间号"); return; }
        if (!/^wss?:\/\//.test(server)) {
            alert("服务器地址需要以 ws:// 或 wss:// 开头");
            return;
        }

        await chrome.storage.local.set({ serverUrl: server, roomId: room });
        chrome.runtime.sendMessage({ type: "config-updated" });
        statusEl.textContent = "正在连接...";

        setTimeout(async () => {
            const s = await chrome.runtime.sendMessage({ type: "get-status" }).catch(() => null);
            statusEl.textContent = s?.connected
                ? `已连接（房间 ${s.room}）`
                : "连接失败，请检查服务器地址和网络";
        }, 2000);
    };
});