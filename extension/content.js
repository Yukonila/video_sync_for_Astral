let currentVideo = null;
let isRemoteAction = false;
let remoteActionTimer = null;

const DRIFT_TOLERANCE = 0.3;
const REMOTE_LOCK_MS = 80;
const SEEK_THROTTLE_MS = 120;

function findVideo() {
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
            paused: currentVideo.paused
        }
    }).catch(() => { });
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

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "play" || msg.type === "pause" || msg.type === "seek") {
        applyRemote(msg);
    }
});

init();