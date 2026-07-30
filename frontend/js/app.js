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
    // Prompt for player name
    const storedName = localStorage.getItem("playerName");
    let name = prompt("Masukkan nama Anda untuk bermain (atau kosongkan untuk default):", storedName || "");
    if (name && name.trim()) {
        state.playerName = name.trim();
        localStorage.setItem("playerName", state.playerName);
    } else if (storedName) {
        state.playerName = storedName;
    }

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
                if (t === "medium") side = 6;
                else if (t === "hard") side = 8;
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
        state.canvas.width = 800;
        state.canvas.height = 600;
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

// ── Piece Generation ──
function generatePieces() {
    const boardWidth = 480;
    const boardHeight = 360;
    const boardX = 160;
    const boardY = 120;
    const pw = boardWidth / state.grid.cols;
    const ph = boardHeight / state.grid.rows;
    state.pieces = [];

    // Define outside zones
    const zones = [];
    // Left zone
    if (boardX - pw - 20 > 10) {
        zones.push({ xMin: 10, xMax: boardX - pw - 10, yMin: 10, yMax: 600 - ph - 10 });
    }
    // Right zone
    if (800 - pw - 10 > boardX + boardWidth + 10) {
        zones.push({ xMin: boardX + boardWidth + 10, xMax: 800 - pw - 10, yMin: 10, yMax: 600 - ph - 10 });
    }
    // Top zone
    if (boardY - ph - 20 > 10) {
        zones.push({ xMin: boardX, xMax: boardX + boardWidth - pw, yMin: 10, yMax: boardY - ph - 10 });
    }
    // Bottom zone
    if (600 - ph - 10 > boardY + boardHeight + 10) {
        zones.push({ xMin: boardX, xMax: boardX + boardWidth - pw, yMin: boardY + boardHeight + 10, yMax: 600 - ph - 10 });
    }

    for (let r = 0; r < state.grid.rows; r++) {
        for (let c = 0; c < state.grid.cols; c++) {
            let sx, sy;
            if (zones.length > 0) {
                const zone = zones[Math.floor(Math.random() * zones.length)];
                sx = zone.xMin + Math.random() * (zone.xMax - zone.xMin);
                sy = zone.yMin + Math.random() * (zone.yMax - zone.yMin);
            } else {
                sx = Math.random() * (800 - pw);
                sy = Math.random() * (600 - ph);
            }
            state.pieces.push({
                id: `p_${r}_${c}`,
                gx: boardX + c * pw,
                gy: boardY + r * ph,
                x: sx,
                y: sy,
                locked: false
            });
        }
    }
}

// ── Drawing ──
function createJigsawPath(ctx, x, y, w, h, r, c, rows, cols) {
    const top = r === 0 ? 0 : -(((r - 1) * cols + c) % 2 === 0 ? 1 : -1);
    const left = c === 0 ? 0 : -((r + (c - 1)) % 2 === 0 ? 1 : -1);
    const bottom = r === rows - 1 ? 0 : ((r * cols + c) % 2 === 0 ? 1 : -1);
    const right = c === cols - 1 ? 0 : ((r + c) % 2 === 0 ? 1 : -1);
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    
    // 1. Top Edge (going right to x + w, y)
    if (top === 0) {
        ctx.lineTo(x + w, y);
    } else {
        ctx.lineTo(x + w * 0.35, y);
        ctx.bezierCurveTo(x + w * 0.35, y - top * h * 0.15, x + w * 0.40, y - top * h * 0.20, x + w * 0.40, y - top * h * 0.20);
        ctx.bezierCurveTo(x + w * 0.30, y - top * h * 0.25, x + w * 0.35, y - top * h * 0.30, x + w * 0.50, y - top * h * 0.30);
        ctx.bezierCurveTo(x + w * 0.65, y - top * h * 0.30, x + w * 0.70, y - top * h * 0.25, x + w * 0.60, y - top * h * 0.20);
        ctx.bezierCurveTo(x + w * 0.60, y - top * h * 0.20, x + w * 0.65, y - top * h * 0.15, x + w * 0.65, y);
        ctx.lineTo(x + w, y);
    }
    
    // 2. Right Edge (going down to x + w, y + h)
    if (right === 0) {
        ctx.lineTo(x + w, y + h);
    } else {
        ctx.lineTo(x + w, y + h * 0.35);
        ctx.bezierCurveTo(x + w + right * w * 0.15, y + h * 0.35, x + w + right * w * 0.20, y + h * 0.40, x + w + right * w * 0.20, y + h * 0.40);
        ctx.bezierCurveTo(x + w + right * w * 0.25, y + h * 0.30, x + w + right * w * 0.30, y + h * 0.35, x + w + right * w * 0.30, y + h * 0.50);
        ctx.bezierCurveTo(x + w + right * w * 0.30, y + h * 0.65, x + w + right * w * 0.25, y + h * 0.70, x + w + right * w * 0.20, y + h * 0.60);
        ctx.bezierCurveTo(x + w + right * w * 0.20, y + h * 0.60, x + w + right * w * 0.15, y + h * 0.65, x + w, y + h * 0.65);
        ctx.lineTo(x + w, y + h);
    }
    
    // 3. Bottom Edge (going left to x, y + h)
    if (bottom === 0) {
        ctx.lineTo(x, y + h);
    } else {
        ctx.lineTo(x + w * 0.65, y + h);
        ctx.bezierCurveTo(x + w * 0.65, y + h + bottom * h * 0.15, x + w * 0.60, y + h + bottom * h * 0.20, x + w * 0.60, y + h + bottom * h * 0.20);
        ctx.bezierCurveTo(x + w * 0.70, y + h + bottom * h * 0.25, x + w * 0.65, y + h + bottom * h * 0.30, x + w * 0.50, y + h + bottom * h * 0.30);
        ctx.bezierCurveTo(x + w * 0.35, y + h + bottom * h * 0.30, x + w * 0.30, y + h + bottom * h * 0.25, x + w * 0.40, y + h + bottom * h * 0.20);
        ctx.bezierCurveTo(x + w * 0.40, y + h + bottom * h * 0.20, x + w * 0.35, y + h + bottom * h * 0.15, x + w * 0.35, y + h);
        ctx.lineTo(x, y + h);
    }
    
    // 4. Left Edge (going up to x, y)
    if (left === 0) {
        ctx.lineTo(x, y);
    } else {
        ctx.lineTo(x, y + h * 0.65);
        ctx.bezierCurveTo(x - left * w * 0.15, y + h * 0.65, x - left * w * 0.20, y + h * 0.60, x - left * w * 0.20, y + h * 0.60);
        ctx.bezierCurveTo(x - left * w * 0.25, y + h * 0.70, x - left * w * 0.30, y + h * 0.65, x - left * w * 0.30, y + h * 0.50);
        ctx.bezierCurveTo(x - left * w * 0.30, y + h * 0.35, x - left * w * 0.25, y + h * 0.30, x - left * w * 0.20, y + h * 0.40);
        ctx.bezierCurveTo(x - left * w * 0.20, y + h * 0.40, x - left * w * 0.15, y + h * 0.35, x, y + h * 0.35);
        ctx.lineTo(x, y);
    }
}

function draw() {
    if (!state.ctx) return;
    const cw = state.canvas.width;
    const ch = state.canvas.height;
    
    const boardWidth = 480;
    const boardHeight = 360;
    const boardX = 160;
    const boardY = 120;
    const pw = boardWidth / state.grid.cols;
    const ph = boardHeight / state.grid.rows;

    state.ctx.clearRect(0, 0, cw, ch);

    state.pieces.forEach(p => { if (p !== state.draggedPiece) drawPiece(p, pw, ph, boardWidth, boardHeight, boardX, boardY); });
    if (state.draggedPiece) drawPiece(state.draggedPiece, pw, ph, boardWidth, boardHeight, boardX, boardY);

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

function drawPiece(p, pw, ph, boardWidth, boardHeight, boardX, boardY) {
    const ctx = state.ctx;
    const parts = p.id.split("_");
    const r = parseInt(parts[1], 10);
    const c = parseInt(parts[2], 10);

    ctx.save();
    if (!p.locked) {
        ctx.shadowColor = "rgba(22, 29, 31, 0.5)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
    }
    createJigsawPath(ctx, p.x, p.y, pw, ph, r, c, state.grid.rows, state.grid.cols);
    ctx.clip();
    
    ctx.translate(p.x - (p.gx - boardX), p.y - (p.gy - boardY));
    ctx.drawImage(state.image, 0, 0, boardWidth, boardHeight);
    ctx.restore();
    
    ctx.strokeStyle = p.locked ? "rgba(76, 179, 65, 0.6)" : "#161d1f";
    ctx.lineWidth = p.locked ? 2 : 2.5;
    createJigsawPath(ctx, p.x, p.y, pw, ph, r, c, state.grid.rows, state.grid.cols);
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
    const boardWidth = 480;
    const boardHeight = 360;
    const pw = boardWidth / state.grid.cols;
    const ph = boardHeight / state.grid.rows;
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

// ── Connection Status ──
function updateConnectionStatus(status) {
    const badge = document.getElementById("connection-status");
    if (!badge) return;
    const textEl = badge.querySelector(".font-label-bold");
    const iconEl = badge.querySelector(".material-symbols-outlined");

    if (status === "connecting") {
        badge.style.backgroundColor = "#ffe086"; // yellow
        badge.style.color = "#231b00";
        if (textEl) {
            textEl.innerText = "Connecting...";
            textEl.style.color = "#231b00";
        }
        if (iconEl) {
            iconEl.innerText = "sync";
            iconEl.style.color = "#231b00";
        }
    } else if (status === "online") {
        badge.style.backgroundColor = "#91fb7f"; // green
        badge.style.color = "#002201";
        if (textEl) {
            textEl.innerText = "Multiplayer Online";
            textEl.style.color = "#002201";
        }
        if (iconEl) {
            iconEl.innerText = "group";
            iconEl.style.color = "#002201";
        }
    } else {
        badge.style.backgroundColor = "#ffdad6"; // red
        badge.style.color = "#93000a";
        if (textEl) {
            textEl.innerText = "Offline Mode (Single)";
            textEl.style.color = "#93000a";
        }
        if (iconEl) {
            iconEl.innerText = "cloud_off";
            iconEl.style.color = "#93000a";
        }
    }
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

        updateConnectionStatus("connecting");

        const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
                     ? "localhost:8000"
                     : "6ae4e4f29d4830.lhr.life";

        state.ws = new WebSocket(`${wsProto}//${host}/ws/${state.roomId}?player_id=${state.playerId}&name=${state.playerName}`);

        state.ws.onopen = () => {
            console.log("WebSocket connected");
            updateConnectionStatus("online");
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

                if (state.canvas) {
                    state.canvas.width = 800;
                    state.canvas.height = 600;
                }

                if (msg.image_url && (!state.image.src || state.image.src !== msg.image_url)) {
                    state.image = new Image();
                    state.image.crossOrigin = "anonymous";
                    state.image.onload = () => {
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

        state.ws.onclose = () => {
            console.warn("WebSocket closed — game works offline");
            updateConnectionStatus("offline");
        };

        state.ws.onerror = () => {
            console.warn("WebSocket error — game works offline (single player)");
            updateConnectionStatus("offline");
        };
    } catch (e) {
        console.warn("WebSocket unavailable — single player mode");
        updateConnectionStatus("offline");
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
