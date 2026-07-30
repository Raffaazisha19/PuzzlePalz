import asyncio
import websockets
import json
import sqlite3
import os

BACKEND_URL = "ws://localhost:8000/ws/test-room"

async def simulated_player(player_id: str, name: str, is_leader: bool):
    url = f"{BACKEND_URL}?player_id={player_id}&name={name}"
    async with websockets.connect(url) as websocket:
        print(f"[Player {name}] Connected.")

        # Receive Initial state
        init_data = await websocket.recv()
        state = json.loads(init_data)
        print(f"[Player {name}] Initial state received. Pieces count: {len(state.get('pieces', []))}")
        assert state["type"] == "init"
        assert len(state["pieces"]) > 0

        # Broadcast Cursor Move
        await websocket.send(json.dumps({
            "type": "cursor",
            "x": 100.0,
            "y": 150.0
        }))
        print(f"[Player {name}] Sent cursor coordinate (100.0, 150.0)")

        if is_leader:
            # Simulated player 1 (leader) drags piece 0
            first_piece = state["pieces"][0]
            await websocket.send(json.dumps({
                "type": "move",
                "piece_id": first_piece["id"],
                "x": 200.0,
                "y": 250.0,
                "locked": False
            }))
            print(f"[Player {name}] Moved piece {first_piece['id']} to (200.0, 250.0)")

            # Snap/Lock piece 0
            await websocket.send(json.dumps({
                "type": "lock",
                "piece_id": first_piece["id"],
                "x": first_piece["gx"],
                "y": first_piece["gy"]
            }))
            print(f"[Player {name}] Locked piece {first_piece['id']}")
        else:
            # Simulated player 2 waits for movement broadcasts
            for _ in range(3):
                msg = json.loads(await websocket.recv())
                print(f"[Player {name}] Received event: {msg['type']} from other player")
                if msg["type"] == "lock":
                    print(f"[Player {name}] Verified piece {msg['piece_id']} lock synchronized!")
                    break

        await asyncio.sleep(1)

def verify_sqlite_integrity():
    print("[SQLite Verification] Reading db.sqlite3...")
    db_file = os.path.join(os.path.dirname(__file__), "backend", "db.sqlite3")
    if not os.path.exists(db_file):
         # If executed in backend directory, adjust path
         db_file = "db.sqlite3"

    if not os.path.exists(db_file):
        print(f"[SQLite Verification] Database file not found at {db_file}, skipping verification.")
        return

    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    try:
        # Check locked piece in db
        row = conn.execute("SELECT COUNT(*) as count FROM pieces WHERE locked = 1").fetchone()
        print(f"[SQLite Verification] Pieces locked count in database: {row['count']}")
        assert row["count"] >= 1, "No pieces were locked in database!"
        print("[SQLite Verification] Database integrity checked successfully.")
    finally:
        conn.close()

async def main():
    print("Starting dual player simulation test...")
    # Launch player tasks concurrently
    task1 = asyncio.create_task(simulated_player("p1", "Alice", is_leader=True))
    await asyncio.sleep(0.5) # Allow Alice to register first
    task2 = asyncio.create_task(simulated_player("p2", "Bob", is_leader=False))

    await asyncio.gather(task1, task2)
    print("Simulation completed.")

    # Verify SQLite Data Integrity
    verify_sqlite_integrity()

if __name__ == "__main__":
    asyncio.run(main())
