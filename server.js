// backend/server.js
import express from "express";
import cors from "cors";
import { createDb } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

let db;
createDb().then((d) => (db = d));

const SUPER_VIP_EMAIL = "gggyyyjunk@gmail.com";

// Fake auth for now: always treat SUPER VIP as logged in
async function getCurrentUser(req) {
  const user = await db.get("SELECT * FROM users WHERE email = ?", SUPER_VIP_EMAIL);
  return user;
}

function requireRole(allowedRoles) {
  return async (req, res, next) => {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!allowedRoles.includes(user.role))
      return res.status(403).json({ error: "Forbidden" });
    req.user = user;
    next();
  };
}

// GET /api/me
app.get("/api/me", async (req, res) => {
  const user = await getCurrentUser(req);
  res.json(user || null);
});

// POSTS

app.get("/api/posts", async (req, res) => {
  const rows = await db.all(
    "SELECT * FROM posts ORDER BY datetime(created_date) DESC LIMIT 100"
  );
  const posts = rows.map((p) => ({
    ...p,
    links: p.links ? JSON.parse(p.links) : [],
    liked_by: p.liked_by ? JSON.parse(p.liked_by) : [],
  }));
  res.json(posts);
});

app.get("/api/posts/search", async (req, res) => {
  const q = req.query.q || "";
  const rows = await db.all(
    "SELECT * FROM posts WHERE title LIKE ? ORDER BY datetime(created_date) DESC",
    `%${q}%`
  );
  const posts = rows.map((p) => ({
    ...p,
    links: p.links ? JSON.parse(p.links) : [],
    liked_by: p.liked_by ? JSON.parse(p.liked_by) : [],
  }));
  res.json(posts);
});

app.post("/api/posts", requireRole(["admin", "vip", "super_vip"]), async (req, res) => {
  const { title, content, image_url, video_url, links = [] } = req.body;
  const user = await getCurrentUser(req);
  const created_date = new Date().toISOString();
  const result = await db.run(
    `INSERT INTO posts (title, content, image_url, video_url, links, likes, liked_by, created_date, author_email)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    title,
    content,
    image_url || "",
    video_url || "",
    JSON.stringify(links),
    JSON.stringify([]),
    created_date,
    user.email
  );
  const post = await db.get("SELECT * FROM posts WHERE id = ?", result.lastID);
  post.links = JSON.parse(post.links || "[]");
  post.liked_by = JSON.parse(post.liked_by || "[]");
  res.json(post);
});

app.post("/api/posts/:id", requireRole(["admin", "vip", "super_vip"]), async (req, res) => {
  const id = req.params.id;
  const { title, content, image_url, video_url, links = [] } = req.body;
  await db.run(
    `UPDATE posts SET title = ?, content = ?, image_url = ?, video_url = ?, links = ? WHERE id = ?`,
    title,
    content,
    image_url || "",
    video_url || "",
    JSON.stringify(links),
    id
  );
  const post = await db.get("SELECT * FROM posts WHERE id = ?", id);
  post.links = JSON.parse(post.links || "[]");
  post.liked_by = JSON.parse(post.liked_by || "[]");
  res.json(post);
});

app.delete("/api/posts/:id", requireRole(["admin", "vip", "super_vip"]), async (req, res) => {
  const id = req.params.id;
  await db.run("DELETE FROM posts WHERE id = ?", id);
  res.json({ success: true });
});

// Like / Unlike
app.post("/api/posts/:id/like", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const id = req.params.id;
  const post = await db.get("SELECT * FROM posts WHERE id = ?", id);
  if (!post) return res.status(404).json({ error: "Post not found" });

  const liked_by = post.liked_by ? JSON.parse(post.liked_by) : [];
  const already = liked_by.includes(user.email);
  const newLikedBy = already
    ? liked_by.filter((e) => e !== user.email)
    : [...liked_by, user.email];

  await db.run(
    "UPDATE posts SET likes = ?, liked_by = ? WHERE id = ?",
    newLikedBy.length,
    JSON.stringify(newLikedBy),
    id
  );

  const updated = await db.get("SELECT * FROM posts WHERE id = ?", id);
  updated.links = JSON.parse(updated.links || "[]");
  updated.liked_by = JSON.parse(updated.liked_by || "[]");
  res.json(updated);
});

// COMMENTS

app.get("/api/comments/:postId", async (req, res) => {
  const postId = req.params.postId;
  const rows = await db.all(
    "SELECT * FROM comments WHERE post_id = ? ORDER BY datetime(created_date) DESC",
    postId
  );
  res.json(rows);
});

app.post("/api/comments", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const { post_id, content, author_name, author_email, author_avatar } = req.body;
  const created_date = new Date().toISOString();
  const result = await db.run(
    `INSERT INTO comments (post_id, content, author_name, author_email, author_avatar, created_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    post_id,
    content,
    author_name,
    author_email,
    author_avatar || "",
    created_date
  );
  const comment = await db.get("SELECT * FROM comments WHERE id = ?", result.lastID);
  res.json(comment);
});

// ROLE HELPERS

async function setRole(email, role) {
  const existing = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!existing) {
    await db.run(
      `INSERT INTO users (email, display_name, avatar_url, role, timeout_until)
       VALUES (?, ?, ?, ?, NULL)`,
      email,
      email,
      "",
      role
    );
  } else {
    await db.run("UPDATE users SET role = ? WHERE email = ?", role, email);
  }
}

// Promote to admin (vip + super_vip)
app.post("/api/admin/promote", requireRole(["vip", "super_vip"]), async (req, res) => {
  const { email } = req.body;
  await setRole(email, "admin");
  res.json({ success: true });
});

// Demote admin to user (vip + super_vip)
app.post("/api/admin/demote", requireRole(["vip", "super_vip"]), async (req, res) => {
  const { email } = req.body;
  const target = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!target || target.role !== "admin") {
    return res.status(400).json({ error: "Target is not admin" });
  }
  await setRole(email, "user");
  res.json({ success: true });
});

// Promote to VIP (super_vip only)
app.post("/api/vip/promote", requireRole(["super_vip"]), async (req, res) => {
  const { email } = req.body;
  await setRole(email, "vip");
  res.json({ success: true });
});

// Demote VIP to user (super_vip only)
app.post("/api/vip/demote", requireRole(["super_vip"]), async (req, res) => {
  const { email } = req.body;
  const target = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!target || target.role !== "vip") {
    return res.status(400).json({ error: "Target is not vip" });
  }
  await setRole(email, "user");
  res.json({ success: true });
});

// Promote to super_vip (super_vip only)
app.post("/api/supervip/promote", requireRole(["super_vip"]), async (req, res) => {
  const { email } = req.body;
  await setRole(email, "super_vip");
  res.json({ success: true });
});

// Demote super_vip to user (super_vip only, but protect root)
app.post("/api/supervip/demote", requireRole(["super_vip"]), async (req, res) => {
  const { email } = req.body;
  if (email === SUPER_VIP_EMAIL) {
    return res.status(400).json({ error: "Cannot demote root super_vip" });
  }
  await setRole(email, "user");
  res.json({ success: true });
});

// Chat timeout
app.post("/api/chat/timeout", requireRole(["vip", "super_vip"]), async (req, res) => {
  const { email, minutes } = req.body;
  const target = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === "super_vip") {
    return res.status(400).json({ error: "Cannot timeout super_vip" });
  }
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();

  await db.run(
    "UPDATE users SET timeout_until = ? WHERE email = ?",
    until,
    email
  );

  res.json({ success: true, timeout_until: until });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});