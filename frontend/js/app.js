// frontend/js/app.js — PuzzlePals multiplayer puzzle engine
const state = {
    ws: null,
    roomId: null,
    playerId: Math.random().toString(36).substring(2, 9),
    playerName: "Player_" + Math.random().toString(36).substring(2, 5),
    canvas: null,
    ctx: null,
    image: new Image(),
    pieces: [],
    draggedPiece: null,
    dragOffset: { x: 0, y: 0 },
    otherCursors: {},
    grid: { rows: 4, cols: 4 },
    progress: 0,
    timerInterval: null,
    timerSeconds: 0,
    initializedFromServer: false,
    pendingImageChange: null
};

// ── Bootstrap ──
window.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    state.roomId = urlParams.get("room") || null;

    // Hide gallery modal on load if room param exists (rejoin via invite link)
    const galleryModal = document.getElementById("gallery-modal");
    if (state.roomId && galleryModal) {
        galleryModal.classList.add("hidden");
        galleryModal.classList.remove("flex");
    }

    // Remove static decorative puzzle pieces from the HTML
    document.querySelectorAll("main > .absolute.z-20").forEach(el => el.remove());

    setupGalleryHandlers();
    setupInvitationHandler();

    // If a room param exists, start game immediately with default image
    if (state.roomId) {
        startGame(
            "https://lh3.googleusercontent.com/aida-public/AB6AXuB0Z4nYxIHMSOBC3Yj8n5lRBvTi8fxFvMgoyNgvzj_Wso5ZuAOxd-97do0MFF_T5DvzEAZAwAVYUVX2F2zoC-9IMAFYS0t_donnJ2lRfwWh9Wk4WyJJ7lzuDX3k8OuqRqZCYE37CVQj1DybDewGAmSWuGmN_jZQ0HsvyCgo4V-jMR1b4A89Zntpq5Z3tnMf_tRBN97vNAaXN2kxsz89ciTJwPIowIqlygxVzvQ1X_5VW_UYEIU-qmz-",
            4, 4
        );
    }
});

// ── Gallery Selection ──
function setupGalleryHandlers() {
    const cards = document.querySelectorAll("#gallery-modal .cursor-pointer");
    cards.forEach(card => {
        card.addEventListener("click", () => {
            const img = card.querySelector("img");
            const diffLabel = card.querySelector(".absolute");
            let side = 4;
            if (diffLabel) {
                const t = diffLabel.innerText.trim().toLowerCase();
                if (t === "medium") side = 5;
                else if (t === "hard") side = 6;
                else if (t === "new") {
                    // Custom puzzle upload
                    const fileInput = document.createElement("input");
                    fileInput.type = "file";
                    fileInput.accept = "image/*";
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                closeModal("gallery-modal");
                                if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                                    wsSend({
                                        type: "change_image",
                                        image_url: ev.target.result,
                                        rows: 4,
                                        cols: 4
                                    });
                                } else {
                                    state.pendingImageChange = {
                                        image_url: ev.target.result,
                                        rows: 4,
                                        cols: 4
                                    };
                                    startGame(ev.target.result, 4, 4);
                                }
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                    fileInput.click();
                    return;
                }
            }
            if (img && img.src) {
                closeModal("gallery-modal");
                if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                    wsSend({
                        type: "change_image",
                        image_url: img.src,
                        rows: side,
                        cols: side
                    });
                } else {
                    state.pendingImageChange = {
                        image_url: img.src,
                        rows: side,
                        cols: side
                    };
                    startGame(img.src, side, side);
                }
            }
        });
    });
}

// ── Start Game ──
function startGame(imageUrl, rows, cols) {
    state.grid.rows = rows;
    state.grid.cols = cols;
    state.initializedFromServer = false;

    // Generate room if none
    if (!state.roomId) {
        state.roomId = Math.random().toString(36).substring(2, 9);
        window.history.pushState({}, "", `${window.location.pathname}?room=${state.roomId}`);
    }

    // Update invite link input
    const inviteInput = document.querySelector("#invite-modal input");
    if (inviteInput) {
        inviteInput.value = `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;
    }

    // Setup canvas inside the dashed grid area
    const container = document.querySelector(".border-dashed");
    if (!container) return;
    container.innerHTML = "";
    container.style.position = "relative";

    state.canvas = document.createElement("canvas");
    state.canvas.id = "puzzle-canvas";
    state.canvas.style.cssText = "width:100%;height:100%;display:block;cursor:grab;";
    container.appendChild(state.canvas);
    state.ctx = state.canvas.getContext("2d");

    // Load image then generate pieces
    state.image = new Image();
    state.image.crossOrigin = "anonymous";
    state.image.onload = () => {
        const rect = container.getBoundingClientRect();
        state.canvas.width = rect.width;
        state.canvas.height = rect.height;
        if (!state.initializedFromServer) {
            generatePieces();
        }
        draw();
        startTimer();
    };
    state.image.src = imageUrl;

    // Update goal thumbnail
    const goalImg = document.querySelector(".aspect-video img");
    if (goalImg) goalImg.src = imageUrl;

    updateProgressBar();

    // Pointer events
    state.canvas.addEventListener("pointerdown", onPointerDown);
    state.canvas.addEventListener("pointermove", onPointerMove);
    state.canvas.addEventListener("pointerup", onPointerUp);
    state.canvas.addEventListener("pointerleave", onPointerUp);

    connectWS();
}

// ── Piece Generation — scatter around edges ──
function generatePieces() {
    const cw = state.canvas.width;
    const ch = state.canvas.height;
    const pw = cw / state.grid.cols;
    const ph = ch / state.grid.rows;
    state.pieces = [];

    const margin = 10;
    const zones = [
        { xMin: margin, xMax: cw - pw - margin, yMin: margin, yMax: ph },
        { xMin: margin, xMax: cw - pw - margin, yMin: ch - ph * 1.5, yMax: ch - ph * 0.5 },
        { xMin: margin, xMax: pw, yMin: margin, yMax: ch - ph - margin },
        { xMin: cw - pw * 1.5, xMax: cw - pw * 0.5, yMin: margin, yMax: ch - ph - margin }
    ];

    for (let r = 0; r < state.grid.rows; r++) {
        for (let c = 0; c < state.grid.cols; c++) {
            const zone = zones[Math.floor(Math.random() * zones.length)];
            const sx = zone.xMin + Math.random() * (zone.xMax - zone.xMin);
            const sy = zone.yMin + Math.random() * (zone.yMax - zone.yMin);
            state.pieces.push({
                id: `p_${r}_${c}`,
                gx: c * pw,
                gy: r * ph,
                x: sx,
                y: sy,
                locked: false
            });
        }
    }
}

// ── Drawing ──
function draw() {
    if (!state.ctx) return;
    const cw = state.canvas.width;
    const ch = state.canvas.height;
    const pw = cw / state.grid.cols;
    const ph = ch / state.grid.rows;

    state.ctx.clearRect(0, 0, cw, ch);

    // Draw target grid lines
    state.ctx.strokeStyle = "rgba(22, 29, 31, 0.12)";
    state.ctx.lineWidth = 1;
    for (let r = 0; r < state.grid.rows; r++) {
        for (let c = 0; c < state.grid.cols; c++) {
            state.ctx.strokeRect(c * pw, r * ph, pw, ph);
        }
    }

    const scaleX = state.image.naturalWidth / cw;
    const scaleY = state.image.naturalHeight / ch;

    state.pieces.forEach(p => { if (p !== state.draggedPiece) drawPiece(p, pw, ph, scaleX, scaleY); });
    if (state.draggedPiece) drawPiece(state.draggedPiece, pw, ph, scaleX, scaleY);

    // Draw remote cursors
    Object.values(state.otherCursors).forEach(c => {
        state.ctx.beginPath();
        state.ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
        state.ctx.fillStyle = "#ba1a1a";
        state.ctx.fill();
        state.ctx.strokeStyle = "#fff";
        state.ctx.lineWidth = 2;
        state.ctx.stroke();
        state.ctx.font = "bold 11px Rubik, sans-serif";
        state.ctx.fillStyle = "#161d1f";
        state.ctx.fillText(c.name, c.x + 10, c.y + 4);
    });
}

function drawPiece(p, pw, ph, scaleX, scaleY) {
    const ctx = state.ctx;
    ctx.save();
    if (!p.locked) {
        ctx.shadowColor = "rgba(22, 29, 31, 0.5)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
    }
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, pw, ph, 4);
    ctx.clip();
    ctx.drawImage(state.image, p.gx * scaleX, p.gy * scaleY, pw * scaleX, ph * scaleY, p.x, p.y, pw, ph);
    ctx.restore();
    ctx.strokeStyle = p.locked ? "rgba(76, 179, 65, 0.6)" : "#161d1f";
    ctx.lineWidth = p.locked ? 2 : 2.5;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, pw, ph, 4);
    ctx.stroke();
}

// ── Pointer Events ──
function getCanvasPos(e) {
    const rect = state.canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (state.canvas.width / rect.width),
        y: (e.clientY - rect.top) * (state.canvas.height / rect.height)
    };
}

function onPointerDown(e) {
    const { x, y } = getCanvasPos(e);
    const pw = state.canvas.width / state.grid.cols;
    const ph = state.canvas.height / state.grid.rows;
    for (let i = state.pieces.length - 1; i >= 0; i--) {
        const p = state.pieces[i];
        if (!p.locked && x >= p.x && x <= p.x + pw && y >= p.y && y <= p.y + ph) {
            state.draggedPiece = p;
            state.dragOffset.x = x - p.x;
            state.dragOffset.y = y - p.y;
            state.pieces.splice(i, 1);
            state.pieces.push(p);
            state.canvas.style.cursor = "grabbing";
            break;
        }
    }
}

function onPointerMove(e) {
    const { x, y } = getCanvasPos(e);
    wsSend({ type: "cursor", x, y });
    if (state.draggedPiece) {
        state.draggedPiece.x = x - state.dragOffset.x;
        state.draggedPiece.y = y - state.dragOffset.y;
        wsSend({ type: "move", piece_id: state.draggedPiece.id, x: state.draggedPiece.x, y: state.draggedPiece.y });
        draw();
    }
}

function onPointerUp() {
    if (!state.draggedPiece) return;
    const p = state.draggedPiece;
    state.canvas.style.cursor = "grab";
    if (Math.hypot(p.x - p.gx, p.y - p.gy) < 25) {
        p.x = p.gx;
        p.y = p.gy;
        p.locked = true;
        wsSend({ type: "lock", piece_id: p.id, x: p.x, y: p.y });
        updateProgressBar();
        if (state.pieces.every(pc => pc.locked)) {
            stopTimer();
            setTimeout(() => alert(`🎉 Puzzle selesai! Waktu: ${formatTime(state.timerSeconds)}`), 200);
        }
    } else {
        wsSend({ type: "move", piece_id: p.id, x: p.x, y: p.y, locked: false });
    }
    state.draggedPiece = null;
    draw();
}

// ── UI Updates ──
function updateProgressBar() {
    const locked = state.pieces.filter(p => p.locked).length;
    const total = state.pieces.length || 1;
    state.progress = Math.round((locked / total) * 100);
    const pctText = document.querySelector(".mt-3.flex .text-primary");
    if (pctText) pctText.innerText = `${state.progress}%`;
    const bar = document.querySelector(".h-4.mt-1 div");
    if (bar) bar.style.width = `${state.progress}%`;
}

function updateActivePlayerText(players) {
    const el = document.querySelector(".font-label-bold.text-on-primary-fixed");
    if (el && players) {
        const names = players.map(p => p.name).join(" & ");
        el.innerText = names + (players.length > 1 ? " are playing" : " is playing");
    }
}

// ── Timer ──
function startTimer() {
    stopTimer();
    state.timerSeconds = 0;
    const timerEl = document.querySelector("header .text-on-surface");
    state.timerInterval = setInterval(() => {
        state.timerSeconds++;
        if (timerEl) timerEl.innerText = formatTime(state.timerSeconds);
    }, 1000);
}

function stopTimer() {
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

function formatTime(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
}

// ── WebSocket ──
function connectWS() {
    try {
        if (state.ws) {
            try {
                state.ws.close();
            } catch (e) {
                console.error("Error closing old WebSocket", e);
            }
        }

        const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
                     ? "localhost:8000"
                     : "laughing-fishstick-v65wwjwrpw9j2vgv-8000.app.github.dev";

        state.ws = new WebSocket(`${wsProto}//${host}/ws/${state.roomId}?player_id=${state.playerId}&name=${state.playerName}`);

        state.ws.onopen = () => {
            console.log("WebSocket connected");
            if (state.pendingImageChange) {
                wsSend({
                    type: "change_image",
                    image_url: state.pendingImageChange.image_url,
                    rows: state.pendingImageChange.rows,
                    cols: state.pendingImageChange.cols
                });
                state.pendingImageChange = null;
            }
        };

        state.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === "init") {
                state.initializedFromServer = true;
                state.grid.rows = msg.rows;
                state.grid.cols = msg.cols;
                if (msg.players) updateActivePlayerText(msg.players);

                if (msg.image_url && (!state.image.src || state.image.src !== msg.image_url)) {
                    state.image = new Image();
                    state.image.crossOrigin = "anonymous";
                    state.image.onload = () => {
                        const container = document.querySelector(".border-dashed");
                        if (container && state.canvas) {
                            const rect = container.getBoundingClientRect();
                            state.canvas.width = rect.width;
                            state.canvas.height = rect.height;
                        }
                        if (msg.pieces) state.pieces = msg.pieces;
                        updateProgressBar();
                        draw();
                    };
                    state.image.src = msg.image_url;

                    const goalImg = document.querySelector(".aspect-video img");
                    if (goalImg) goalImg.src = msg.image_url;
                } else {
                    if (msg.pieces) state.pieces = msg.pieces;
                    updateProgressBar();
                    draw();
                }
            } else if (msg.type === "player_change") {
                updateActivePlayerText(msg.players);
            } else if (msg.type === "move") {
                const piece = state.pieces.find(p => p.id === msg.piece_id);
                if (piece && piece !== state.draggedPiece) {
                    piece.x = msg.x;
                    piece.y = msg.y;
                    draw();
                }
            } else if (msg.type === "cursor") {
                state.otherCursors[msg.player_id] = { x: msg.x, y: msg.y, name: msg.name };
                draw();
            } else if (msg.type === "lock") {
                const piece = state.pieces.find(p => p.id === msg.piece_id);
                if (piece) {
                    piece.x = msg.x;
                    piece.y = msg.y;
                    piece.locked = true;
                    updateProgressBar();
                    draw();
                }
            }
        };

        state.ws.onerror = () => { console.warn("WebSocket error — game works offline (single player)"); };
    } catch (e) {
        console.warn("WebSocket unavailable — single player mode");
    }
}

function wsSend(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
    }
}

// ── Invite Link ──
function setupInvitationHandler() {
    const copyBtn = document.querySelector("#invite-modal button.bg-primary");
    if (copyBtn) {
        copyBtn.addEventListener("click", () => {
            const input = document.querySelector("#invite-modal input");
            if (input && input.value) {
                navigator.clipboard.writeText(input.value).then(() => {
                    copyBtn.innerText = "Copied!";
                    setTimeout(() => { copyBtn.innerText = "Copy Link"; }, 2000);
                });
            }
        });
    }
}

// ── Modal Helper ──
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.add("hidden"); m.classList.remove("flex"); }
}
