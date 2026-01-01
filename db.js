// backend/db.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function createDb() {
  const db = await open({
    filename: "./data.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      role TEXT,
      timeout_until TEXT
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT,
      image_url TEXT,
      video_url TEXT,
      links TEXT,
      likes INTEGER DEFAULT 0,
      liked_by TEXT,
      created_date TEXT,
      author_email TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER,
      content TEXT,
      author_name TEXT,
      author_email TEXT,
      author_avatar TEXT,
      created_date TEXT
    );
  `);

  // Create your super VIP account automatically
  const superVipEmail = "gggyyyjunk@gmail.com";
  const existing = await db.get("SELECT * FROM users WHERE email = ?", superVipEmail);

  if (!existing) {
    await db.run(
      `INSERT INTO users (email, display_name, avatar_url, role, timeout_until)
       VALUES (?, ?, ?, ?, NULL)`,
      superVipEmail,
      "Super VIP",
      "",
      "super_vip"
    );
  }

  return db;
}