// frontend/js/app.js - dynamic jigsaw puzzle engine with multiplayer synchronization
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
    isComplete: false
};

function initGame() {
    state.canvas = document.getElementById("puzzle-canvas");
    if (!state.canvas) {
        // Create canvas dynamically inside grid area
        const container = document.querySelector(".border-dashed");
        if (container) {
            container.innerHTML = "";
            state.canvas = document.createElement("canvas");
            state.canvas.id = "puzzle-canvas";
            state.canvas.className = "max-w-full max-h-full cursor-grab active:cursor-grabbing border-[4px] border-on-surface bg-dots shadow-[4px_4px_0px_rgba(22,29,31,1)]";
            container.appendChild(state.canvas);
        }
    }

    if (!state.canvas) return;
    state.ctx = state.canvas.getContext("2d");

    // Room ID parser
    const urlParams = new URLSearchParams(window.location.search);
    state.roomId = urlParams.get("room") || "default-room";

    // Setup input events
    state.canvas.addEventListener("pointerdown", onPointerDown);
    state.canvas.addEventListener("pointermove", onPointerMove);
    state.canvas.addEventListener("pointerup", onPointerUp);

    // Initial image load (Space Adventure Default)
    const defaultImg = "https://lh3.googleusercontent.com/aida-public/AB6AXuB0Z4nYxIHMSOBC3Yj8n5lRBvTi8fxFvMgoyNgvzj_Wso5ZuAOxd-97do0MFF_T5DvzEAZAwAVYUVX2F2zoC-9IMAFYS0t_donnJ2lRfwWh9Wk4WyJJ7lzuDX3k8OuqRqZCYE37CVQj1DybDewGAmSWuGmN_jZQ0HsvyCgo4V-jMR1b4A89Zntpq5Z3tnMf_tRBN97vNAaXN2kxsz89ciTJwPIowIqlygxVzvQ1X_5VW_UYEIU-qmz-";
    loadPuzzle(defaultImg, 4, 4);

    connectWS();
    setupGalleryHandlers();
    setupInvitationHandler();
}

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
                 ? "localhost:8000"
                 : "laughing-fishstick-v65wwjwrpw9j2vgv-8000.app.github.dev/"; // Ganti dengan domain Codespaces Anda

    state.ws = new WebSocket(`${wsProto}//${host}/ws/${state.roomId}?player_id=${state.playerId}&name=${state.playerName}`);

    state.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "init") {
            // Synchronize room settings & pieces
            state.grid.rows = msg.rows;
            state.grid.cols = msg.cols;
            if (msg.image_url && state.image.src !== msg.image_url) {
                loadPuzzle(msg.image_url, msg.rows, msg.cols, false);
            }
            state.pieces = msg.pieces;
            updateActivePlayerText(msg.players);
            updateProgressBar();
            draw();
        } else if (msg.type === "player_change") {
            updateActivePlayerText(msg.players);
        } else if (msg.type === "move") {
            const piece = state.pieces.find(p => p.id === msg.piece_id);
            if (piece && (!state.draggedPiece || state.draggedPiece.id !== msg.piece_id)) {
                piece.x = msg.x;
                piece.y = msg.y;
                piece.locked = msg.locked;
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
}

function loadPuzzle(src, rows, cols, isNewRoom = true) {
    state.grid.rows = rows;
    state.grid.cols = cols;
    state.image.crossOrigin = "anonymous";
    state.image.onload = () => {
        // Adjust Canvas Aspect Ratio
        const maxW = 800;
        const maxH = 600;
        let w = state.image.width;
        let h = state.image.height;
        if (w > maxW) {
            h = (maxW / w) * h;
            w = maxW;
        }
        if (h > maxH) {
            w = (maxH / h) * w;
            h = maxH;
        }
        state.canvas.width = w;
        state.canvas.height = h;

        if (isNewRoom) {
            generatePieces(w, h);
        }
        draw();
    };
    state.image.src = src;

    // Update goal image thumbnail
    const goalImg = document.querySelector(".w-full.aspect-video img");
    if (goalImg) goalImg.src = src;
}

function generatePieces(width, height) {
    const pw = width / state.grid.cols;
    const ph = height / state.grid.rows;
    state.pieces = [];
    for (let r = 0; r < state.grid.rows; r++) {
        for (let c = 0; c < state.grid.cols; c++) {
            // Scatter coordinates randomly
            const scatterX = Math.random() * (width - pw);
            const scatterY = Math.random() * (height - ph);
            state.pieces.push({
                id: `p_${r}_${c}`,
                gx: c * pw,
                gy: r * ph,
                x: scatterX,
                y: scatterY,
                locked: false
            });
        }
    }
}

function draw() {
    if (!state.ctx) return;
    const pw = state.canvas.width / state.grid.cols;
    const ph = state.canvas.height / state.grid.rows;

    state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);

    // Draw shadow target grids
    state.ctx.strokeStyle = "rgba(22, 29, 31, 0.15)";
    state.ctx.lineWidth = 2;
    for (let r = 0; r < state.grid.rows; r++) {
        for (let c = 0; c < state.grid.cols; c++) {
            state.ctx.strokeRect(c * pw, r * ph, pw, ph);
        }
    }

    // Draw non-dragged pieces first (so dragged piece stays on top)
    state.pieces.forEach(p => {
        if (p !== state.draggedPiece) {
            drawPiece(p, pw, ph);
        }
    });

    if (state.draggedPiece) {
        drawPiece(state.draggedPiece, pw, ph);
    }

    // Draw remote players cursors
    Object.values(state.otherCursors).forEach(c => {
        state.ctx.beginPath();
        state.ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
        state.ctx.fillStyle = "#ba1a1a";
        state.ctx.fill();
        state.ctx.strokeStyle = "#ffffff";
        state.ctx.lineWidth = 2;
        state.ctx.stroke();

        state.ctx.font = "10px Rubik";
        state.ctx.fillStyle = "#161d1f";
        state.ctx.fillText(c.name, c.x + 10, c.y + 4);
    });
}

function drawPiece(p, pw, ph) {
    state.ctx.save();

    // Draw Border Shadow if not locked
    if (!p.locked) {
        state.ctx.shadowColor = "rgba(22, 29, 31, 0.4)";
        state.ctx.shadowBlur = 6;
        state.ctx.shadowOffsetX = 3;
        state.ctx.shadowOffsetY = 3;
    }

    // Clip & Draw dynamic sub-image
    state.ctx.beginPath();
    state.ctx.rect(p.x, p.y, pw, ph);
    state.ctx.clip();
    state.ctx.drawImage(state.image, p.gx * (state.image.width / state.canvas.width), p.gy * (state.image.height / state.canvas.height), (state.image.width / state.canvas.width) * pw, (state.image.height / state.canvas.height) * ph, p.x, p.y, pw, ph);
    state.ctx.restore();

    // Piece border line
    state.ctx.strokeStyle = p.locked ? "rgba(22,29,31,0.2)" : "#161d1f";
    state.ctx.lineWidth = p.locked ? 1 : 2.5;
    state.ctx.strokeRect(p.x, p.y, pw, ph);
}

function onPointerDown(e) {
    const rect = state.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pw = state.canvas.width / state.grid.cols;
    const ph = state.canvas.height / state.grid.rows;

    // Search pieces top-to-bottom (reversed array order)
    for (let i = state.pieces.length - 1; i >= 0; i--) {
        const p = state.pieces[i];
        if (!p.locked && x >= p.x && x <= p.x + pw && y >= p.y && y <= p.y + ph) {
            state.draggedPiece = p;
            state.dragOffset.x = x - p.x;
            state.dragOffset.y = y - p.y;

            // Bring to top
            state.pieces.splice(i, 1);
            state.pieces.push(p);
            break;
        }
    }
}

function onPointerMove(e) {
    const rect = state.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Broadcast transient cursor coordinate
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: "cursor",
            x: x,
            y: y
        }));
    }

    if (state.draggedPiece) {
        state.draggedPiece.x = x - state.dragOffset.x;
        state.draggedPiece.y = y - state.dragOffset.y;

        // Throttled WebSocket movement broadcast
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: "move",
                piece_id: state.draggedPiece.id,
                x: state.draggedPiece.x,
                y: state.draggedPiece.y
            }));
        }
        draw();
    }
}

function onPointerUp() {
    if (!state.draggedPiece) return;
    const p = state.draggedPiece;

    // Check snap matching distance (20px threshold)
    const dist = Math.hypot(p.x - p.gx, p.y - p.gy);
    if (dist < 20) {
        p.x = p.gx;
        p.y = p.gy;
        p.locked = true;

        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: "lock",
                piece_id: p.id,
                x: p.x,
                y: p.y
            }));
        }
        updateProgressBar();
    } else {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: "move",
                piece_id: p.id,
                x: p.x,
                y: p.y,
                locked: false
            }));
        }
    }

    state.draggedPiece = null;
    draw();
}

function updateProgressBar() {
    const lockedCount = state.pieces.filter(p => p.locked).length;
    const total = state.pieces.length;
    state.progress = total > 0 ? Math.round((lockedCount / total) * 100) : 0;

    const textNode = document.querySelector(".mt-3.flex .text-primary");
    if (textNode) textNode.innerText = `${state.progress}%`;

    const barNode = document.querySelector(".h-4.mt-1 div");
    if (barNode) barNode.style.width = `${state.progress}%`;
}

function updateActivePlayerText(players) {
    const textNode = document.querySelector(".font-label-bold.text-on-primary-fixed");
    if (textNode && players) {
        const names = players.map(p => p.name).join(" & ");
        textNode.innerText = names + (players.length > 1 ? " are playing" : " is playing");
    }
}

function setupGalleryHandlers() {
    // Override click selection in Gallery Modal
    const cards = document.querySelectorAll("#gallery-modal .cursor-pointer");
    cards.forEach((card, idx) => {
        card.onclick = () => {
            const img = card.querySelector("img");
            if (img && img.src) {
                // Determine difficulty level
                const diffLabel = card.querySelector(".absolute");
                let side = 4;
                if (diffLabel) {
                    const text = diffLabel.innerText.toLowerCase();
                    if (text === "medium") side = 6;
                    if (text === "hard") side = 8;
                }
                loadPuzzle(img.src, side, side);

                // Broadcast change to server
                if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                    state.ws.send(JSON.stringify({
                        type: "change_image",
                        image_url: img.src,
                        rows: side,
                        cols: side
                    }));
                }

                // Hide modal
                const modal = document.getElementById("gallery-modal");
                if (modal) {
                    modal.classList.add("hidden");
                    modal.classList.remove("flex");
                }
            }
        };
    });
}

function setupInvitationHandler() {
    // Generate actual URL parameters for invitation
    const input = document.querySelector("#invite-modal input");
    if (input) {
        // Generate actual random room ID if not set
        if (state.roomId === "default-room") {
            const nextRoom = Math.random().toString(36).substring(2, 9);
            const nextUrl = `${window.location.origin}${window.location.pathname}?room=${nextRoom}`;
            input.value = nextUrl;

            // Push state browser
            window.history.pushState({}, "", nextUrl);
            state.roomId = nextRoom;
        } else {
            input.value = `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;
        }
    }

    const copyBtn = document.querySelector("#invite-modal button.bg-primary");
    if (copyBtn) {
        copyBtn.onclick = () => {
            if (input) {
                navigator.clipboard.writeText(input.value);
                copyBtn.innerText = "Copied!";
                setTimeout(() => { copyBtn.innerText = "Copy Link"; }, 2000);
            }
        };
    }
}

// Bootstrap Initialization
window.addEventListener("DOMContentLoaded", initGame);
