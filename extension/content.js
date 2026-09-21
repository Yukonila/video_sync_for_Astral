let currentVideo = null;
let isRemoteAction = false;
let remoteActionTimer = null;

const DRIFT_TOLERANCE = 0.3;
const REMOTE_LOCK_MS = 80;
const SEEK_THROTTLE_MS = 120;

function findVideo() {
    // B 站专用选择器
    if (location.hostname.includes("bilibili.com")) {
        const biliVideo =
            document.querySelector(".bpx-player-video-wrap video") ||
            document.querySelector("#bilibili-player video") ||
            document.querySelector(".bilibili-player-video video");
        if (biliVideo && biliVideo.readyState > 0) return biliVideo;
    }

    // 通用逻辑
    const knownSelectors = ["video.html5-main-video", "video"];
    for (const sel of knownSelectors) {
        const v = document.querySelector(sel);
        if (v && v.readyState > 0 && v.offsetParent !== null) return v;
    }

    const videos = Array.from(document.querySelectorAll("video"))
        .filter((v) => v.offsetParent !== null);
    return videos.sort((a, b) => {
        const areaA = (a.videoWidth || 0) * (a.videoHeight || 0);
        const areaB = (b.videoWidth || 0) * (b.videoHeight || 0);
        return areaB - areaA;
    })[0] || null;
}

function lockRemote() {
    isRemoteAction = true;
    if (remoteActionTimer) clearTimeout(remoteActionTimer);
    remoteActionTimer = setTimeout(() => {
        isRemoteAction = false;
        remoteActionTimer = null;
    }, REMOTE_LOCK_MS);
}

function applyRemote(data) {
    if (!currentVideo) return;
    lockRemote();

    if (data.type === "play") {
        const drift = Math.abs(currentVideo.currentTime - data.time);
        if (drift > DRIFT_TOLERANCE) currentVideo.currentTime = data.time;
        if (currentVideo.paused) currentVideo.play().catch(() => { });
    } else if (data.type === "pause") {
        if (!currentVideo.paused) currentVideo.pause();
        const drift = Math.abs(currentVideo.currentTime - data.time);
        if (drift > DRIFT_TOLERANCE) currentVideo.currentTime = data.time;
    } else if (data.type === "seek") {
        currentVideo.currentTime = data.time;
    }
}

let lastSeekTime = 0;

function reportLocal(action) {
    if (isRemoteAction || !currentVideo) return;

    if (action === "seek") {
        const now = Date.now();
        if (now - lastSeekTime < SEEK_THROTTLE_MS) return;
        lastSeekTime = now;
    }

    chrome.runtime.sendMessage({
        type: "sync-action",
        payload: {
            type: action,
            time: currentVideo.currentTime,
            paused: currentVideo.paused,
            url: location.href,
            title: document.title
        }
    }).catch(() => { });
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function showOpenHint(url, title) {
    if (document.getElementById("video-sync-hint")) return;

    const bar = document.createElement("div");
    bar.id = "video-sync-hint";
    bar.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
    background: #2563eb; color: white; padding: 10px 16px;
    font-family: system-ui, sans-serif; font-size: 14px;
    display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  `;

    const safeTitle = (title || url).slice(0, 60);
    bar.innerHTML = `
    <span>对方正在观看：<b>${escapeHtml(safeTitle)}</b></span>
    <span style="display:flex;align-items:center;gap:12px;">
      <a id="video-sync-hint-open" href="javascript:void(0)"
         style="color:white;text-decoration:underline;cursor:pointer;">打开</a>
      <button id="video-sync-hint-close"
        style="background:transparent;border:1px solid white;color:white;
               padding:4px 10px;border-radius:4px;cursor:pointer;">关闭</button>
    </span>
  `;
    document.body.appendChild(bar);

    document.getElementById("video-sync-hint-open").onclick = () => {
        window.open(url, "_blank");
        bar.remove();
    };
    document.getElementById("video-sync-hint-close").onclick = () => bar.remove();

    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 15000);
}

function setupListeners() {
    if (!currentVideo) return;
    currentVideo.removeEventListener("play", onPlay);
    currentVideo.removeEventListener("pause", onPause);
    currentVideo.removeEventListener("seeked", onSeek);
    currentVideo.addEventListener("play", onPlay);
    currentVideo.addEventListener("pause", onPause);
    currentVideo.addEventListener("seeked", onSeek);
}

function onPlay() { reportLocal("play"); }
function onPause() { reportLocal("pause"); }
function onSeek() { reportLocal("seek"); }

function init() {
    currentVideo = findVideo();
    if (!currentVideo) {
        const observer = new MutationObserver(() => {
            const v = findVideo();
            if (v) {
                currentVideo = v;
                setupListeners();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return;
    }
    setupListeners();
}


let lastUrl = location.href;
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => {
            const v = findVideo();
            if (v && v !== currentVideo) {
                currentVideo = v;
                setupListeners();
            }
        }, 1000);
    }
}, 1000);

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "play" || msg.type === "pause" || msg.type === "seek") {
        applyRemote(msg);
    } else if (msg.type === "show-open-hint") {
        showOpenHint(msg.url, msg.title);
    }
});

init();