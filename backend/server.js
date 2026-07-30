import express from "express";
import cors from "cors";
import multer from "multer";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pg from "pg";
import path from "node:path";
import { promises as fs } from "node:fs";

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 4000);
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || "/app/storage");
const UPLOAD_TEMP_ROOT = path.join(STORAGE_ROOT, ".uploads");
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) throw new Error("JWT_SECRET must be set");

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());
// Staging uploads inside the mounted storage filesystem avoids exhausting Node.js memory,
// while letting the verified file be moved atomically into its shared folder.
const upload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, done) => done(null, UPLOAD_TEMP_ROOT) }),
  limits: { fileSize: 20 * 1024 * 1024 * 1024 },
});

function cleanName(value, label = "Name") {
  const name = String(value || "").trim();
  if (!name || name !== path.basename(name) || name.includes("..") || /[\\/\0]/.test(name)) {
    throw new Error(`${label} must be a simple, non-empty name.`);
  }
  return name;
}

function folderPath(folderName) {
  // Resolve and verify again so a database value can never escape STORAGE_ROOT.
  const candidate = path.resolve(STORAGE_ROOT, folderName);
  if (!candidate.startsWith(`${STORAGE_ROOT}${path.sep}`)) throw new Error("Unsafe folder path.");
  return candidate;
}

async function getDirectorySize(directory) {
  let total = 0;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await getDirectorySize(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  return total;
}

export async function getUniqueFilename(directory, requestedFilename) {
  const safeFilename = cleanName(requestedFilename, "File name");
  const extension = path.extname(safeFilename);
  const stem = path.basename(safeFilename, extension);
  let attempt = safeFilename;
  let index = 1;
  while (true) {
    try { await fs.access(path.join(directory, attempt)); attempt = `${stem} (${index++})${extension}`; }
    catch { return attempt; }
  }
}

function signUser(user) {
  return jwt.sign({ id: user.id, username: user.username, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: "8h" });
}

function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: "Please sign in again." }); }
}

function requireAdmin(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Administrator access is required." });
  next();
}

async function getFolder(folderId) {
  const result = await pool.query("SELECT * FROM shared_folders WHERE id = $1", [folderId]);
  if (!result.rowCount) throw new Error("Folder not found.");
  return result.rows[0];
}

async function requireFolderPermission(req, res, next) {
  try {
    const folder = await getFolder(req.params.folderId);
    if (req.user.isAdmin) { req.folder = folder; req.permission = { can_read: true, can_write: true, can_delete: true }; return next(); }
    const result = await pool.query(
      "SELECT can_read, can_write, can_delete FROM folder_permissions WHERE user_id = $1 AND folder_id = $2",
      [req.user.id, folder.id]
    );
    if (!result.rowCount) return res.status(403).json({ error: "You do not have access to this folder." });
    req.folder = folder;
    req.permission = result.rows[0];
    next();
  } catch (error) { res.status(error.message === "Folder not found." ? 404 : 400).json({ error: error.message }); }
}

function requireCapability(capability) {
  return (req, res, next) => req.permission[capability]
    ? next()
    : res.status(403).json({ error: `This folder does not grant ${capability.replace("can_", "")} permission.` });
}

async function createInitialAdmin() {
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (count.rows[0].count || !process.env.INITIAL_ADMIN_USERNAME || !process.env.INITIAL_ADMIN_PASSWORD) return;
  const hash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD, 12);
  await pool.query("INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, TRUE)", [process.env.INITIAL_ADMIN_USERNAME, hash]);
  console.log("Initial SkyNest administrator created.");
}

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) return res.status(401).json({ error: "Invalid username or password." });
    res.json({ token: signUser(user), user: { id: user.id, username: user.username, isAdmin: user.is_admin } });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ id: req.user.id, username: req.user.username, isAdmin: req.user.isAdmin }));

app.get("/api/folders", requireAuth, async (req, res, next) => {
  try {
    const query = req.user.isAdmin
      ? "SELECT f.*, TRUE can_read, TRUE can_write, TRUE can_delete FROM shared_folders f ORDER BY folder_name"
      : "SELECT f.*, p.can_read, p.can_write, p.can_delete FROM shared_folders f JOIN folder_permissions p ON p.folder_id = f.id WHERE p.user_id = $1 AND p.can_read ORDER BY f.folder_name";
    const result = await pool.query(query, req.user.isAdmin ? [] : [req.user.id]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.get("/api/folders/:folderId/files", requireAuth, requireFolderPermission, requireCapability("can_read"), async (req, res, next) => {
  try {
    const diskPath = folderPath(req.folder.folder_name);
    const entries = await fs.readdir(diskPath, { withFileTypes: true });
    const files = await Promise.all(entries.filter(e => e.isFile()).map(async entry => {
      const stat = await fs.stat(path.join(diskPath, entry.name));
      return { name: entry.name, size: stat.size, modifiedAt: stat.mtime };
    }));
    const usedBytes = await getDirectorySize(diskPath);
    res.json({ files, usedBytes, quotaLimitBytes: Number(req.folder.quota_limit_bytes), permissions: req.permission });
  } catch (error) { next(error); }
});

app.post("/api/folders/:folderId/upload", requireAuth, requireFolderPermission, requireCapability("can_write"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new Error("Choose a file to upload.");
    const diskPath = folderPath(req.folder.folder_name);
    const usedBytes = await getDirectorySize(diskPath);
    if (usedBytes + req.file.size > Number(req.folder.quota_limit_bytes)) {
      await fs.unlink(req.file.path);
      return res.status(413).json({ error: "Upload rejected: this folder quota would be exceeded." });
    }
    const filename = await getUniqueFilename(diskPath, req.file.originalname);
    await fs.rename(req.file.path, path.join(diskPath, filename));
    res.status(201).json({ name: filename });
  } catch (error) {
    await fs.unlink(req.file?.path).catch(() => {});
    next(error);
  }
});

app.get("/api/folders/:folderId/files/:filename/download", requireAuth, requireFolderPermission, requireCapability("can_read"), async (req, res, next) => {
  try { const name = cleanName(req.params.filename, "File name"); res.download(path.join(folderPath(req.folder.folder_name), name), name); }
  catch (error) { next(error); }
});

app.patch("/api/folders/:folderId/files/:filename", requireAuth, requireFolderPermission, requireCapability("can_write"), async (req, res, next) => {
  try {
    const oldName = cleanName(req.params.filename, "File name");
    const newName = await getUniqueFilename(folderPath(req.folder.folder_name), req.body.name);
    await fs.rename(path.join(folderPath(req.folder.folder_name), oldName), path.join(folderPath(req.folder.folder_name), newName));
    res.json({ name: newName });
  } catch (error) { next(error); }
});

app.delete("/api/folders/:folderId/files/:filename", requireAuth, requireFolderPermission, requireCapability("can_delete"), async (req, res, next) => {
  try { await fs.unlink(path.join(folderPath(req.folder.folder_name), cleanName(req.params.filename, "File name"))); res.status(204).end(); }
  catch (error) { next(error); }
});

app.get("/api/admin/disk", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    // statfs reads the actual mounted filesystem, not Docker's container overlay.
    const stats = await fs.statfs(STORAGE_ROOT);
    const totalBytes = Number(stats.blocks * stats.bsize);
    const freeBytes = Number(stats.bfree * stats.bsize);
    res.json({ totalBytes, freeBytes, usedBytes: totalBytes - freeBytes });
  } catch (error) { next(error); }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res, next) => { try { res.json((await pool.query("SELECT id, username, is_admin FROM users ORDER BY username")).rows); } catch (e) { next(e); } });
app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const username = cleanName(req.body.username, "Username");
    if (String(req.body.password || "").length < 8) throw new Error("Password must contain at least 8 characters.");
    const hash = await bcrypt.hash(req.body.password, 12);
    const result = await pool.query("INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING id, username, is_admin", [username, hash, Boolean(req.body.isAdmin)]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});
app.post("/api/admin/folders", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const name = cleanName(req.body.folderName, "Folder name");
    const quota = Number(req.body.quotaLimitBytes);
    if (!Number.isSafeInteger(quota) || quota < 0) throw new Error("Quota must be a non-negative whole number of bytes.");
    const result = await pool.query("INSERT INTO shared_folders (folder_name, quota_limit_bytes) VALUES ($1, $2) RETURNING *", [name, quota]);
    await fs.mkdir(folderPath(name), { recursive: true });
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});
app.patch("/api/admin/folders/:folderId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const folder = await getFolder(req.params.folderId);
    const name = cleanName(req.body.folderName ?? folder.folder_name, "Folder name");
    const quota = Number(req.body.quotaLimitBytes ?? folder.quota_limit_bytes);
    if (!Number.isSafeInteger(quota) || quota < 0) throw new Error("Quota must be a non-negative whole number of bytes.");

    const currentPath = folderPath(folder.folder_name);
    const usedBytes = await getDirectorySize(currentPath);
    if (quota < usedBytes) throw new Error(`Quota cannot be lower than the ${usedBytes} bytes currently stored in this folder.`);

    const renamed = name !== folder.folder_name;
    const nextPath = folderPath(name);
    if (renamed) {
      try {
        await fs.access(nextPath);
        throw new Error("A storage folder with that name already exists.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (renamed) await fs.rename(currentPath, nextPath);
    try {
      const result = await pool.query(
        "UPDATE shared_folders SET folder_name = $1, quota_limit_bytes = $2 WHERE id = $3 RETURNING *",
        [name, quota, folder.id]
      );
      res.json(result.rows[0]);
    } catch (error) {
      if (renamed) await fs.rename(nextPath, currentPath).catch(() => {});
      throw error;
    }
  } catch (error) { next(error); }
});
app.delete("/api/admin/folders/:folderId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const folder = await getFolder(req.params.folderId);
    // rmdir intentionally refuses a non-empty directory, so delete cannot remove files by accident.
    await fs.rmdir(folderPath(folder.folder_name));
    await pool.query("DELETE FROM shared_folders WHERE id = $1", [folder.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get("/api/admin/folders/:folderId/permissions", requireAuth, requireAdmin, async (req, res, next) => { try { res.json((await pool.query("SELECT user_id, can_read, can_write, can_delete FROM folder_permissions WHERE folder_id = $1", [req.params.folderId])).rows); } catch (e) { next(e); } });
app.put("/api/admin/folders/:folderId/permissions/:userId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { canRead, canWrite, canDelete } = req.body;
    if ((canWrite || canDelete) && !canRead) throw new Error("Write or delete requires read permission.");
    if (!canRead && !canWrite && !canDelete) await pool.query("DELETE FROM folder_permissions WHERE folder_id = $1 AND user_id = $2", [req.params.folderId, req.params.userId]);
    else await pool.query("INSERT INTO folder_permissions (folder_id, user_id, can_read, can_write, can_delete) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,folder_id) DO UPDATE SET can_read=$3,can_write=$4,can_delete=$5", [req.params.folderId, req.params.userId, !!canRead, !!canWrite, !!canDelete]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Upload exceeds the 20 GB file-size limit." });
  if (error.code === "23505") return res.status(409).json({ error: "That name already exists." });
  if (error.code === "ENOTEMPTY") return res.status(409).json({ error: "Folder must be empty before it can be deleted." });
  res.status(500).json({ error: error.message || "Unexpected server error." });
});

await fs.mkdir(STORAGE_ROOT, { recursive: true });
await fs.mkdir(UPLOAD_TEMP_ROOT, { recursive: true });
await createInitialAdmin();
app.listen(PORT, () => console.log(`SkyNest API listening on ${PORT}`));
