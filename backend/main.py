from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List, Any
import json
import database

app = FastAPI(title="PuzzlePals API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session tracking for websockets: {room_id: {player_id: {"ws": WebSocket, "name": str}}}
rooms_active: Dict[str, Dict[str, Dict[str, Any]]] = {}

def get_or_create_room_db(room_id: str, default_img: str = "", default_rows: int = 4, default_cols: int = 4):
    with database.get_db() as conn:
        row = conn.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO rooms (id, image_url, rows, cols) VALUES (?, ?, ?, ?)",
                (room_id, default_img, default_rows, default_cols)
            )
            # Generate initial pieces
            pw = 800 / default_cols
            ph = 600 / default_rows
            import random
            for r in range(default_rows):
                for c in range(default_cols):
                    scatter_x = random.uniform(0, 800 - pw)
                    scatter_y = random.uniform(0, 600 - ph)
                    conn.execute(
                        "INSERT INTO pieces (id, room_id, gx, gy, x, y, locked) VALUES (?, ?, ?, ?, ?, ?, 0)",
                        (f"p_{r}_{c}", room_id, c * pw, r * ph, scatter_x, scatter_y)
                    )
            conn.commit()
            return {"id": room_id, "image_url": default_img, "rows": default_rows, "cols": default_cols}
        return dict(row)

def get_room_pieces(room_id: str):
    with database.get_db() as conn:
        rows = conn.execute("SELECT * FROM pieces WHERE room_id = ?", (room_id,)).fetchall()
        return [dict(r) for r in rows]

def update_piece_db(room_id: str, piece_id: str, x: float, y: float, locked: int):
    with database.get_db() as conn:
        conn.execute(
            "UPDATE pieces SET x = ?, y = ?, locked = ? WHERE id = ? AND room_id = ?",
            (x, y, locked, piece_id, room_id)
        )
        conn.commit()

def change_room_image_db(room_id: str, image_url: str, rows: int, cols: int):
    with database.get_db() as conn:
        conn.execute(
            "UPDATE rooms SET image_url = ?, rows = ?, cols = ? WHERE id = ?",
            (image_url, rows, cols, room_id)
        )
        # Clear old pieces and regenerate
        conn.execute("DELETE FROM pieces WHERE room_id = ?", (room_id,))
        pw = 800 / cols
        ph = 600 / rows
        import random
        for r in range(rows):
            for c in range(cols):
                scatter_x = random.uniform(0, 800 - pw)
                scatter_y = random.uniform(0, 600 - ph)
                conn.execute(
                    "INSERT INTO pieces (id, room_id, gx, gy, x, y, locked) VALUES (?, ?, ?, ?, ?, ?, 0)",
                    (f"p_{r}_{c}", room_id, c * pw, r * ph, scatter_x, scatter_y)
                )
        conn.commit()

async def broadcast_to_room(room_id: str, message: dict, exclude_player_id: str = None):
    if room_id not in rooms_active:
        return
    for p_id, p_info in list(rooms_active[room_id].items()):
        if p_id == exclude_player_id:
            continue
        try:
            await p_info["ws"].send_json(message)
        except Exception:
            # Clean up dead socket on failure
            rooms_active[room_id].pop(p_id, None)

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, player_id: str, name: str):
    await websocket.accept()

    if room_id not in rooms_active:
        rooms_active[room_id] = {}

    rooms_active[room_id][player_id] = {"ws": websocket, "name": name}

    # Ensure room config exists
    default_img = "https://lh3.googleusercontent.com/aida-public/AB6AXuB0Z4nYxIHMSOBC3Yj8n5lRBvTi8fxFvMgoyNgvzj_Wso5ZuAOxd-97do0MFF_T5DvzEAZAwAVYUVX2F2zoC-9IMAFYS0t_donnJ2lRfwWh9Wk4WyJJ7lzuDX3k8OuqRqZCYE37CVQj1DybDewGAmSWuGmN_jZQ0HsvyCgo4V-jMR1b4A89Zntpq5Z3tnMf_tRBN97vNAaXN2kxsz89ciTJwPIowIqlygxVzvQ1X_5VW_UYEIU-qmz-"
    room_info = get_or_create_room_db(room_id, default_img)
    pieces = get_room_pieces(room_id)

    # Compile current players list
    players_list = [{"id": p_id, "name": info["name"]} for p_id, info in rooms_active[room_id].items()]

    # 1. Send initial room state to connecting client
    await websocket.send_json({
        "type": "init",
        "rows": room_info["rows"],
        "cols": room_info["cols"],
        "image_url": room_info["image_url"],
        "pieces": pieces,
        "players": players_list
    })

    # 2. Notify others of join
    await broadcast_to_room(room_id, {
        "type": "player_change",
        "players": players_list
    }, exclude_player_id=player_id)

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg["type"] == "move":
                # Broadcast real-time move event (exclude sender to prevent jitter)
                await broadcast_to_room(room_id, {
                    "type": "move",
                    "piece_id": msg["piece_id"],
                    "x": msg["x"],
                    "y": msg["y"],
                    "locked": msg.get("locked", False)
                }, exclude_player_id=player_id)
                # Transient coordinate, only write to DB on lock or periodic (YAGNI write only on lock/up)

            elif msg["type"] == "cursor":
                # Broadcast cursor position
                await broadcast_to_room(room_id, {
                    "type": "cursor",
                    "player_id": player_id,
                    "name": name,
                    "x": msg["x"],
                    "y": msg["y"]
                }, exclude_player_id=player_id)

            elif msg["type"] == "lock":
                update_piece_db(room_id, msg["piece_id"], msg["x"], msg["y"], 1)
                await broadcast_to_room(room_id, {
                    "type": "lock",
                    "piece_id": msg["piece_id"],
                    "x": msg["x"],
                    "y": msg["y"]
                })

            elif msg["type"] == "change_image":
                change_room_image_db(room_id, msg["image_url"], msg["rows"], msg["cols"])
                new_pieces = get_room_pieces(room_id)
                await broadcast_to_room(room_id, {
                    "type": "init",
                    "rows": msg["rows"],
                    "cols": msg["cols"],
                    "image_url": msg["image_url"],
                    "pieces": new_pieces,
                    "players": [{"id": p_id, "name": info["name"]} for p_id, info in rooms_active[room_id].items()]
                })

    except WebSocketDisconnect:
        rooms_active[room_id].pop(player_id, None)
        if not rooms_active[room_id]:
            rooms_active.pop(room_id, None)
        else:
            # Notify remaining players
            active_players = [{"id": p_id, "name": info["name"]} for p_id, info in rooms_active[room_id].items()]
            await broadcast_to_room(room_id, {
                "type": "player_change",
                "players": active_players
            })
