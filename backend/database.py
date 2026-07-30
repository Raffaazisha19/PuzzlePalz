import sqlite3
import os

DATABASE_FILE = os.getenv("SQLITE_PATH", "db.sqlite3")

def get_db():
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        # Create Tables
        conn.execute("""
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            image_url TEXT,
            rows INTEGER,
            cols INTEGER
        );
        """)
        conn.execute("""
        CREATE TABLE IF NOT EXISTS pieces (
            id TEXT,
            room_id TEXT,
            gx REAL,
            gy REAL,
            x REAL,
            y REAL,
            locked INTEGER,
            PRIMARY KEY (id, room_id),
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        );
        """)
        conn.commit()

# Run migrations instantly
init_db()
