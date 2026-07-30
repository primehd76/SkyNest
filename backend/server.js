import express from "express";
import cors from "cors";
import multer from "multer";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pg from "pg";
import path from "node:path";
import { constants as fsConstants, promises as fs } from "node:fs";
import archiver from "archiver";

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

function storagePath(...segments) {
  // Resolve and verify again so a database value can never escape STORAGE_ROOT.
  const candidate = path.resolve(STORAGE_ROOT, ...segments);
  if (!candidate.startsWith(`${STORAGE_ROOT}${path.sep}`)) throw new Error("Unsafe folder path.");
  return candidate;
}

function cleanRelativePath(value) {
  const segments = String(value || "").split(/[\\/]+/).filter(Boolean);
  if (!segments.length) throw new Error("File path must not be empty.");
  return segments.map(segment => cleanName(segment, "File path"));
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

async function moveUploadedFileUniquely(directory, requestedFilename, sourcePath) {
  const safeFilename = cleanName(requestedFilename, "File name");
  const extension = path.extname(safeFilename);
  const stem = path.basename(safeFilename, extension);
  let index = 0;

  while (true) {
    const filename = index ? `${stem} (${index})${extension}` : safeFilename;
    const targetPath = path.join(directory, filename);
    try {
      // Atomically reserve the destination without copying or overwriting a
      // large file that another client may have uploaded at the same time.
      await fs.link(sourcePath, targetPath);
      try {
        await fs.unlink(sourcePath);
      } catch (error) {
        await fs.unlink(targetPath).catch(() => {});
        throw error;
      }
      return filename;
    } catch (error) {
      if (error.code === "EEXIST") {
        index += 1;
        continue;
      }
      if (error.code === "EXDEV" || error.code === "EPERM") {
        try {
          await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
          await fs.unlink(sourcePath);
          return filename;
        } catch (copyError) {
          if (copyError.code === "EEXIST") {
            index += 1;
            continue;
          }
          throw copyError;
        }
      }
      throw error;
    }
  }
}

async function getUniqueSubfolderName(parent, requestedName) {
  const safeName = cleanName(requestedName, "Folder name");
  const parentPath = await getFolderDiskPath(parent);
  let index = 0;

  while (true) {
    const name = index ? `${safeName} (${index})` : safeName;
    const existing = await pool.query(
      "SELECT 1 FROM shared_folders WHERE parent_id = $1 AND folder_name = $2",
      [parent.id, name],
    );
    let existsOnDisk = false;
    try {
      await fs.access(path.join(parentPath, name));
      existsOnDisk = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!existing.rowCount && !existsOnDisk) return name;
    index += 1;
  }
}

function requireDownloadTicket(req, res, next) {
  try {
    const ticket = jwt.verify(String(req.query.ticket || ""), JWT_SECRET);
    const isFile = ticket.type === "download" && ticket.filename === req.params.filename;
    const isFolder = ticket.type === "folder-download" && !req.params.filename;
    if ((!isFile && !isFolder) || Number(ticket.folderId) !== Number(req.params.folderId)) throw new Error("Invalid download ticket.");
    next();
  } catch { res.status(401).json({ error: "Download link has expired. Please try again." }); }
}

async function getFolderDiskPath(folder) {
  const names = [folder.folder_name];
  let parentId = folder.parent_id;
  while (parentId) {
    const parent = await getFolder(parentId);
    names.unshift(parent.folder_name);
    parentId = parent.parent_id;
  }
  return storagePath(...names);
}

async function getFolderTrail(folder) {
  const trail = [folder];
  let parentId = folder.parent_id;
  while (parentId) {
    const parent = await getFolder(parentId);
    trail.unshift(parent);
    parentId = parent.parent_id;
  }
  return trail;
}

function parseQuota(value) {
  const quota = Number(value);
  if (!Number.isSafeInteger(quota) || quota < 0) throw new Error("Quota must be a non-negative whole number of bytes.");
  return quota;
}

async function ensureSubfolder(parent, name) {
  const existing = await pool.query("SELECT * FROM shared_folders WHERE parent_id = $1 AND folder_name = $2", [parent.id, name]);
  if (existing.rowCount) return existing.rows[0];
  const result = await pool.query(
    "INSERT INTO shared_folders (parent_id, folder_name, quota_limit_bytes) VALUES ($1, $2, $3) RETURNING *",
    [parent.id, name, parent.quota_limit_bytes]
  );
  const folder = result.rows[0];
  await fs.mkdir(await getFolderDiskPath(folder), { recursive: true });
  return folder;
}

async function reconcileStorageFolders(parent) {
  const diskPath = await getFolderDiskPath(parent);
  const entries = await fs.readdir(diskPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter(entry => entry.isDirectory() && entry.name !== ".uploads")) {
    const child = await ensureSubfolder(parent, entry.name);
    await reconcileStorageFolders(child);
  }
}

async function requireFolderPermission(req, res, next) {
  try {
    const folder = await getFolder(req.params.folderId);
    if (req.user.isAdmin) { req.folder = folder; req.permission = { can_read: true, can_write: true, can_delete: true }; return next(); }
    const permission = await getEffectivePermission(req.user.id, folder);
    if (!permission) return res.status(403).json({ error: "You do not have access to this folder." });
    req.folder = folder;
    req.permission = permission;
    next();
  } catch (error) { res.status(error.message === "Folder not found." ? 404 : 400).json({ error: error.message }); }
}

async function getEffectivePermission(userId, folder) {
  let current = folder;
  while (current) {
    const result = await pool.query("SELECT can_read, can_write, can_delete FROM folder_permissions WHERE user_id = $1 AND folder_id = $2", [userId, current.id]);
    if (result.rowCount) return result.rows[0];
    current = current.parent_id ? await getFolder(current.parent_id) : null;
  }
  return null;
}

function requireCapability(capability) {
  return (req, res, next) => req.permission[capability]
    ? next()
    : res.status(403).json({ error: `This folder does not grant ${capability.replace("can_", "")} permission.` });
}

async function listFolders(user, parentId = null) {
  const parentClause = parentId === null ? "f.parent_id IS NULL" : "f.parent_id = $1";
  const params = parentId === null ? [] : [parentId];
  const rows = (await pool.query(`SELECT f.* FROM shared_folders f WHERE ${parentClause} ORDER BY folder_name`, params)).rows;
  if (user.isAdmin) return rows.map(folder => ({ ...folder, can_read: true, can_write: true, can_delete: true }));
  const visible = await Promise.all(rows.map(async folder => ({ folder, permission: await getEffectivePermission(user.id, folder) })));
  return visible.filter(({ permission }) => permission?.can_read).map(({ folder, permission }) => ({ ...folder, ...permission }));
}

async function createInitialAdmin() {
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (count.rows[0].count || !process.env.INITIAL_ADMIN_USERNAME || !process.env.INITIAL_ADMIN_PASSWORD) return;
  const hash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD, 12);
  await pool.query("INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, TRUE)", [process.env.INITIAL_ADMIN_USERNAME, hash]);
  console.log("Initial SkyNest administrator created.");
}

async function migrateDatabase() {
  // Existing deployments predate nested folders, so keep their root folders intact
  // while adding the nullable parent relation in place.
  await pool.query("ALTER TABLE shared_folders ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES shared_folders(id) ON DELETE CASCADE");
  await pool.query("CREATE INDEX IF NOT EXISTS shared_folders_parent_id_idx ON shared_folders(parent_id)");
  // Folder names only need to be unique within their parent, just like a file system.
  await pool.query("ALTER TABLE shared_folders DROP CONSTRAINT IF EXISTS shared_folders_folder_name_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS shared_folders_parent_name_idx ON shared_folders(parent_id, folder_name)");
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
    const parentId = req.query.parentId === undefined ? null : Number(req.query.parentId);
    if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId < 1)) throw new Error("Invalid parent folder.");
    res.json(await listFolders(req.user, parentId));
  } catch (error) { next(error); }
});

app.get("/api/folders/:folderId", requireAuth, requireFolderPermission, requireCapability("can_read"), async (req, res, next) => {
  try { res.json({ folder: req.folder, trail: await getFolderTrail(req.folder) }); }
  catch (error) { next(error); }
});

app.get("/api/folders/:folderId/files", requireAuth, requireFolderPermission, requireCapability("can_read"), async (req, res, next) => {
  try {
    const diskPath = await getFolderDiskPath(req.folder);
    const rootFolder = (await getFolderTrail(req.folder))[0];
    const rootDiskPath = await getFolderDiskPath(rootFolder);
    const entries = await fs.readdir(diskPath, { withFileTypes: true });
    const files = await Promise.all(entries.filter(e => e.isFile()).map(async entry => {
      const stat = await fs.stat(path.join(diskPath, entry.name));
      return { name: entry.name, size: stat.size, modifiedAt: stat.mtime };
    }));
    const usedBytes = await getDirectorySize(rootDiskPath);
    const folders = await listFolders(req.user, req.folder.id);
    res.json({
      folders,
      files,
      usedBytes,
      quotaLimitBytes: Number(rootFolder.quota_limit_bytes),
      quotaFolderName: rootFolder.folder_name,
      permissions: req.permission
    });
  } catch (error) { next(error); }
});

app.post("/api/folders/:folderId/upload", requireAuth, requireFolderPermission, requireCapability("can_write"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new Error("Choose a file to upload.");
    const rootFolder = (await getFolderTrail(req.folder))[0];
    const rootDiskPath = await getFolderDiskPath(rootFolder);
    const relativePath = cleanRelativePath(req.body.relativePath || req.file.originalname);
    const requestedFilename = relativePath.pop();
    let targetFolder = req.folder;
    for (const segment of relativePath) targetFolder = await ensureSubfolder(targetFolder, segment);
    const targetDirectory = await getFolderDiskPath(targetFolder);
    const usedBytes = await getDirectorySize(rootDiskPath);
    if (usedBytes + req.file.size > Number(rootFolder.quota_limit_bytes)) {
      await fs.unlink(req.file.path);
      return res.status(413).json({ error: "Upload rejected: this folder quota would be exceeded." });
    }
    const filename = await moveUploadedFileUniquely(
      targetDirectory,
      requestedFilename,
      req.file.path,
    );
    res.status(201).json({ name: [...relativePath, filename].join("/") });
  } catch (error) {
    await fs.unlink(req.file?.path).catch(() => {});
    next(error);
  }
});

app.post("/api/folders/:folderId/files/:filename/download-ticket", requireAuth, requireFolderPermission, requireCapability("can_read"), async (req, res, next) => {
  try {
    const name = cleanName(req.params.filename, "File name");
    const ticket = jwt.sign({ type: "download", folderId: req.folder.id, filename: name }, JWT_SECRET, { expiresIn: "2m" });
    res.json({ url: `/api/folders/${req.folder.id}/files/${encodeURIComponent(name)}/download?ticket=${encodeURIComponent(ticket)}` });
  } catch (error) { next(error); }
});

app.get("/api/folders/:folderId/files/:filename/download", requireDownloadTicket, async (req, res, next) => {
  try {
    const folder = await getFolder(req.params.folderId);
    const name = cleanName(req.params.filename, "File name");
    res.download(path.join(await getFolderDiskPath(folder), name), name);
  }
  catch (error) { next(error); }
});
app.post("/api/folders/:folderId/download-ticket", requireAuth, requireFolderPermission, requireCapability("can_read"), async (req, res, next) => {
  try {
    const ticket = jwt.sign({ type: "folder-download", folderId: req.folder.id }, JWT_SECRET, { expiresIn: "2m" });
    res.json({ url: `/api/folders/${req.folder.id}/download?ticket=${encodeURIComponent(ticket)}` });
  } catch (error) { next(error); }
});
app.get("/api/folders/:folderId/download", requireDownloadTicket, async (req, res, next) => {
  try {
    const folder = await getFolder(req.params.folderId);
    res.attachment(`${folder.folder_name}.zip`);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", next);
    archive.pipe(res);
    archive.directory(await getFolderDiskPath(folder), folder.folder_name);
    await archive.finalize();
  } catch (error) { next(error); }
});

app.patch("/api/folders/:folderId/files/:filename", requireAuth, requireFolderPermission, requireCapability("can_write"), async (req, res, next) => {
  try {
    const oldName = cleanName(req.params.filename, "File name");
    const diskPath = await getFolderDiskPath(req.folder);
    let requestedName = cleanName(req.body.name, "File name");
    const originalExtension = path.extname(oldName);
    if (originalExtension) requestedName = `${path.basename(requestedName, path.extname(requestedName))}${originalExtension}`;
    const newName = await getUniqueFilename(diskPath, requestedName);
    await fs.rename(path.join(diskPath, oldName), path.join(diskPath, newName));
    res.json({ name: newName });
  } catch (error) { next(error); }
});

app.delete("/api/folders/:folderId/files/:filename", requireAuth, requireFolderPermission, requireCapability("can_delete"), async (req, res, next) => {
  try { await fs.unlink(path.join(await getFolderDiskPath(req.folder), cleanName(req.params.filename, "File name"))); res.status(204).end(); }
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
    const quota = parseQuota(req.body.quotaLimitBytes);
    const result = await pool.query("INSERT INTO shared_folders (folder_name, quota_limit_bytes) VALUES ($1, $2) RETURNING *", [name, quota]);
    await fs.mkdir(await getFolderDiskPath(result.rows[0]), { recursive: true });
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});
app.post("/api/folders/:folderId/subfolders", requireAuth, requireFolderPermission, requireCapability("can_write"), async (req, res, next) => {
  try {
    const name = req.body.makeUnique
      ? await getUniqueSubfolderName(req.folder, req.body.folderName)
      : cleanName(req.body.folderName, "Folder name");
    // Subfolders share the root folder's capacity. Only a root folder has its own limit.
    const quota = Number(req.folder.quota_limit_bytes);
    const result = await pool.query(
      "INSERT INTO shared_folders (parent_id, folder_name, quota_limit_bytes) VALUES ($1, $2, $3) RETURNING *",
      [req.folder.id, name, quota]
    );
    const folder = result.rows[0];
    await fs.mkdir(await getFolderDiskPath(folder), { recursive: true });
    res.status(201).json(folder);
  } catch (error) { next(error); }
});
app.delete("/api/folders/:folderId", requireAuth, requireFolderPermission, requireCapability("can_delete"), async (req, res, next) => {
  try {
    if (!req.folder.parent_id) return res.status(403).json({ error: "Only an administrator can delete a root folder." });
    await fs.rm(await getFolderDiskPath(req.folder), { recursive: true, force: false });
    await pool.query("DELETE FROM shared_folders WHERE id = $1", [req.folder.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});
app.patch("/api/admin/folders/:folderId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const folder = await getFolder(req.params.folderId);
    const name = cleanName(req.body.folderName ?? folder.folder_name, "Folder name");
    const quota = parseQuota(req.body.quotaLimitBytes ?? folder.quota_limit_bytes);
    if (folder.parent_id && quota !== Number(folder.quota_limit_bytes)) throw new Error("Only root folders can have their quota changed.");

    const currentPath = await getFolderDiskPath(folder);
    const usedBytes = await getDirectorySize(currentPath);
    if (quota < usedBytes) throw new Error(`Quota cannot be lower than the ${usedBytes} bytes currently stored in this folder.`);

    const renamed = name !== folder.folder_name;
    const parentSegments = path.relative(STORAGE_ROOT, path.dirname(currentPath)).split(path.sep).filter(Boolean);
    const nextPath = storagePath(...parentSegments, name);
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
    await fs.rm(await getFolderDiskPath(folder), { recursive: true, force: false });
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
await migrateDatabase();
for (const rootFolder of await listFolders({ isAdmin: true })) await reconcileStorageFolders(rootFolder);
await createInitialAdmin();
const server = app.listen(PORT, () =>
  console.log(`SkyNest API listening on ${PORT}`),
);
// Large uploads may legitimately take longer than Node's default request
// timeout. Authentication and Multer's size limit still constrain requests.
server.requestTimeout = 0;
