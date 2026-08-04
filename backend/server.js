import express from "express";
import cors from "cors";
import multer from "multer";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pg from "pg";
import path from "node:path";
import os from "node:os";
import { constants as fsConstants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import archiver from "archiver";

const { Pool } = pg;
const execFileAsync = promisify(execFile);
const app = express();
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool();
const PORT = Number(process.env.PORT || 4000);
const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT || "/app/storage");
const UPLOAD_TEMP_ROOT = path.join(STORAGE_ROOT, ".uploads");
const STORAGE_LIMIT_BYTES = process.env.STORAGE_LIMIT_BYTES
  ? Number(process.env.STORAGE_LIMIT_BYTES)
  : null;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) throw new Error("JWT_SECRET must be set");
if (
  STORAGE_LIMIT_BYTES !== null &&
  (!Number.isSafeInteger(STORAGE_LIMIT_BYTES) || STORAGE_LIMIT_BYTES <= 0)
) {
  throw new Error("STORAGE_LIMIT_BYTES must be a positive whole number.");
}

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

let applicationUsedBytesCache = null;
async function getApplicationUsedBytes() {
  if (applicationUsedBytesCache !== null) return applicationUsedBytesCache;
  const entries = await fs.readdir(STORAGE_ROOT, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (entry.name === ".uploads") continue;
    const entryPath = path.join(STORAGE_ROOT, entry.name);
    if (entry.isDirectory()) total += await getDirectorySize(entryPath);
    else if (entry.isFile()) total += (await fs.stat(entryPath)).size;
  }
  applicationUsedBytesCache = total;
  return total;
}

function adjustApplicationUsedBytes(delta) {
  if (applicationUsedBytesCache === null) return;
  applicationUsedBytesCache = Math.max(0, applicationUsedBytesCache + delta);
}

async function getStorageCapacity() {
  const stats = await fs.statfs(STORAGE_ROOT);
  const physicalTotalBytes = Number(stats.blocks * stats.bsize);
  const physicalFreeBytes = Number(stats.bavail * stats.bsize);
  if (STORAGE_LIMIT_BYTES === null) {
    return {
      totalBytes: physicalTotalBytes,
      freeBytes: physicalFreeBytes,
      usedBytes: physicalTotalBytes - physicalFreeBytes,
      configuredLimitBytes: null,
      physicalTotalBytes,
      physicalFreeBytes,
    };
  }

  const totalBytes = Math.min(STORAGE_LIMIT_BYTES, physicalTotalBytes);
  const usedBytes = await getApplicationUsedBytes();
  const freeBytes = Math.max(
    0,
    Math.min(totalBytes - usedBytes, physicalFreeBytes),
  );
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    configuredLimitBytes: STORAGE_LIMIT_BYTES,
    physicalTotalBytes,
    physicalFreeBytes,
  };
}

let previousCpuTotals = null;
let previousNetworkTotals = null;
let diskHealthCache = { checkedAt: 0, value: null };

function readCpuTotals() {
  return os.cpus().reduce(
    (totals, cpu) => {
      const times = cpu.times;
      totals.total += times.user + times.nice + times.sys + times.irq + times.idle;
      totals.idle += times.idle;
      return totals;
    },
    { total: 0, idle: 0 },
  );
}

function getHostCpuMetrics() {
  const current = readCpuTotals();
  const previous = previousCpuTotals;
  previousCpuTotals = current;
  if (!previous) return { usagePercent: 0, cores: os.cpus().length, load1: os.loadavg()[0] || 0 };
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  const usagePercent = totalDelta > 0
    ? Math.max(0, Math.min(100, ((totalDelta - idleDelta) * 100) / totalDelta))
    : 0;
  return { usagePercent, cores: os.cpus().length, load1: os.loadavg()[0] || 0 };
}

async function readOptionalFile(filePath) {
  try { return await fs.readFile(filePath, "utf8"); } catch { return null; }
}

let previousContainerCpu = null;
async function getCpuMetrics() {
  const stat = await readOptionalFile("/sys/fs/cgroup/cpu.stat");
  const max = await readOptionalFile("/sys/fs/cgroup/cpu.max");
  const usageMatch = stat?.match(/(?:^|\n)usage_usec\s+(\d+)/);
  const maxParts = max?.trim().split(/\s+/);
  const quotaCores = maxParts?.[0] !== "max" && Number(maxParts?.[0]) > 0 && Number(maxParts?.[1]) > 0
    ? Number(maxParts[0]) / Number(maxParts[1])
    : null;
  if (!usageMatch || !quotaCores) {
    return { ...getHostCpuMetrics(), scope: "host fallback" };
  }
  const current = { usageUsec: Number(usageMatch[1]), at: Date.now() };
  const previous = previousContainerCpu;
  previousContainerCpu = current;
  if (!previous) return { usagePercent: 0, cores: quotaCores, load1: null, scope: "container" };
  const elapsedUsec = Math.max(1, (current.at - previous.at) * 1000);
  const usagePercent = Math.max(0, Math.min(100, ((current.usageUsec - previous.usageUsec) * 100) / (elapsedUsec * quotaCores)));
  return { usagePercent, cores: quotaCores, load1: null, scope: "container" };
}

async function getMemoryMetrics() {
  const currentRaw = await readOptionalFile("/sys/fs/cgroup/memory.current");
  const maxRaw = await readOptionalFile("/sys/fs/cgroup/memory.max");
  const current = Number(currentRaw);
  const limit = Number(maxRaw);
  if (Number.isFinite(current) && current >= 0 && Number.isFinite(limit) && limit > 0) {
    return { totalBytes: limit, freeBytes: Math.max(0, limit - current), usedBytes: current, usagePercent: (current * 100) / limit, scope: "container" };
  }
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  return { totalBytes, freeBytes, usedBytes, usagePercent: (usedBytes * 100) / totalBytes, scope: "host fallback" };
}

let previousContainerIo = null;
let backendIoTotals = { readBytes: 0, writeBytes: 0 };
function recordBackendIo({ readBytes = 0, writeBytes = 0 } = {}) {
  backendIoTotals.readBytes += Math.max(0, Number(readBytes) || 0);
  backendIoTotals.writeBytes += Math.max(0, Number(writeBytes) || 0);
}
async function getDiskIoMetrics() {
  // /proc/self/io works inside a cgroup namespace and measures the backend
  // process itself. Fall back to cgroup io.stat when proc counters are hidden.
  const proc = await readOptionalFile("/proc/self/io");
  let totals = { ...backendIoTotals };
  let procAvailable = false;
  if (proc) {
    const read = proc.match(/(?:^|\n)read_bytes:\s*(\d+)/)?.[1];
    const write = proc.match(/(?:^|\n)write_bytes:\s*(\d+)/)?.[1];
    if (read !== undefined && write !== undefined) {
      procAvailable = true;
      totals.readBytes = Math.max(totals.readBytes, Number(read));
      totals.writeBytes = Math.max(totals.writeBytes, Number(write));
    }
  }
  if (!procAvailable) {
    const content = await readOptionalFile("/sys/fs/cgroup/io.stat");
    if (content) {
      const cgroupTotals = content.split("\n").reduce((sum, line) => {
      for (const field of line.trim().split(/\s+/)) {
        const [name, value] = field.split("=");
        if (name === "rbytes") sum.readBytes += Number(value) || 0;
        if (name === "wbytes") sum.writeBytes += Number(value) || 0;
      }
      return sum;
      }, { readBytes: 0, writeBytes: 0 });
      totals.readBytes = Math.max(totals.readBytes, cgroupTotals.readBytes);
      totals.writeBytes = Math.max(totals.writeBytes, cgroupTotals.writeBytes);
    }
  }
  if (!totals) return { available: false, readBytesPerSecond: 0, writeBytesPerSecond: 0, scope: "backend container" };
  const now = Date.now();
  const previous = previousContainerIo;
  previousContainerIo = { ...totals, at: now };
  if (!previous) return { available: true, readBytesPerSecond: 0, writeBytesPerSecond: 0, scope: "backend container" };
  const seconds = Math.max(0.001, (now - previous.at) / 1000);
  return {
    available: true,
    readBytesPerSecond: Math.max(0, (totals.readBytes - previous.readBytes) / seconds),
    writeBytesPerSecond: Math.max(0, (totals.writeBytes - previous.writeBytes) / seconds),
    scope: "backend container",
  };
}

async function readNetworkTotals() {
  try {
    const content = await fs.readFile("/proc/net/dev", "utf8");
    return content.split("\n").slice(2).reduce((totals, line) => {
      const [interfaceName, values] = line.trim().split(":");
      if (!values || interfaceName === "lo") return totals;
      const fields = values.trim().split(/\s+/).map(Number);
      totals.rxBytes += fields[0] || 0;
      totals.txBytes += fields[8] || 0;
      return totals;
    }, { rxBytes: 0, txBytes: 0 });
  } catch {
    return { rxBytes: 0, txBytes: 0 };
  }
}

async function getNetworkMetrics() {
  const current = await readNetworkTotals();
  const now = Date.now();
  const previous = previousNetworkTotals;
  previousNetworkTotals = { ...current, at: now };
  if (!previous) return { rxBytesPerSecond: 0, txBytesPerSecond: 0, rxMbps: 0, txMbps: 0 };
  const seconds = Math.max(0.001, (now - previous.at) / 1000);
  const rxBytesPerSecond = Math.max(0, (current.rxBytes - previous.rxBytes) / seconds);
  const txBytesPerSecond = Math.max(0, (current.txBytes - previous.txBytes) / seconds);
  return {
    rxBytesPerSecond,
    txBytesPerSecond,
    rxMbps: (rxBytesPerSecond * 8) / 1024 ** 2,
    txMbps: (txBytesPerSecond * 8) / 1024 ** 2,
  };
}

async function getTemperatureMetrics() {
  try {
    const thermalRoot = "/sys/class/thermal";
    const zones = (await fs.readdir(thermalRoot)).filter((name) => name.startsWith("thermal_zone"));
    const readings = [];
    for (const zone of zones) {
      const temperaturePath = path.join(thermalRoot, zone, "temp");
      try {
        const raw = Number((await fs.readFile(temperaturePath, "utf8")).trim());
        if (Number.isFinite(raw)) {
          const type = (await fs.readFile(path.join(thermalRoot, zone, "type"), "utf8").catch(() => zone)).trim();
          readings.push({ type, celsius: raw > 1000 ? raw / 1000 : raw });
        }
      } catch { /* A thermal zone can disappear while being read. */ }
    }
    if (!readings.length) return { status: "unavailable", celsius: null, label: "No thermal sensor" };
    const hottest = readings.reduce((max, item) => item.celsius > max.celsius ? item : max);
    return { status: "available", celsius: Math.round(hottest.celsius * 10) / 10, label: hottest.type };
  } catch {
    return { status: "unavailable", celsius: null, label: "No thermal sensor" };
  }
}

async function getDiskHealthMetrics() {
  const now = Date.now();
  if (diskHealthCache.value && now - diskHealthCache.checkedAt < 300_000) return diskHealthCache.value;
  const device = process.env.DISK_HEALTH_DEVICE;
  if (!device) {
    const value = { status: "unavailable", message: "Set DISK_HEALTH_DEVICE and expose SMART access to enable this check.", device: null, temperatureCelsius: null };
    diskHealthCache = { checkedAt: now, value };
    return value;
  }
  try {
    const command = process.env.SMARTCTL_BIN || "smartctl";
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync(command, ["-a", "-j", device], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }));
    } catch (error) {
      // smartctl can exit non-zero for a SMART warning while still returning
      // a valid JSON report; parse that report before treating it as failure.
      if (!error.stdout) throw error;
      stdout = error.stdout;
    }
    const report = JSON.parse(stdout);
    const passed = report.smart_status?.passed === true || report.smart_status?.passed === "true" || report.nvme_smart_health_information_log?.critical_warning === 0;
    const temperatureAttribute = report.ata_smart_attributes?.table?.find((item) => [190, 194].includes(Number(item.id)));
    const rawTemperature = temperatureAttribute?.raw?.value;
    const stringTemperature = temperatureAttribute?.raw?.string?.match(/-?\d+(?:\.\d+)?/)?.[0];
    const directTemperature = Number(report.temperature?.current);
    const temperatureCelsius = directTemperature > 0 ? directTemperature : (Number(rawTemperature) > 0 ? rawTemperature : stringTemperature) ?? null;
    const value = { status: passed ? "healthy" : "warning", message: passed ? "SMART health check passed." : "SMART reported a warning.", device, temperatureCelsius: Number.isFinite(Number(temperatureCelsius)) ? Number(temperatureCelsius) : null };
    diskHealthCache = { checkedAt: now, value };
    return value;
  } catch (error) {
    const value = { status: "unavailable", message: error.code === "ENOENT" ? "smartctl is not installed in the container." : "SMART check is unavailable (device access may be restricted).", device, temperatureCelsius: null };
    diskHealthCache = { checkedAt: now, value };
    return value;
  }
}

async function getSystemMetrics() {
  const [disk, network, temperature, diskHealth, cpu, memory, diskIo] = await Promise.all([
    getStorageCapacity(),
    getNetworkMetrics(),
    getTemperatureMetrics(),
    getDiskHealthMetrics(),
    getCpuMetrics(),
    getMemoryMetrics(),
    getDiskIoMetrics(),
  ]);
  const effectiveTemperature = Number.isFinite(Number(diskHealth.temperatureCelsius))
    ? { status: "available", celsius: Number(diskHealth.temperatureCelsius), label: "SMART disk temperature" }
    : temperature;
  return {
    timestamp: new Date().toISOString(),
    cpu,
    memory,
    storage: { totalBytes: disk.totalBytes, freeBytes: disk.freeBytes, usedBytes: disk.usedBytes, configuredLimitBytes: disk.configuredLimitBytes, usagePercent: disk.totalBytes ? (disk.usedBytes * 100) / disk.totalBytes : 0, scope: "container storage limit" },
    diskIo,
    network,
    temperature: effectiveTemperature,
    diskHealth,
  };
}

async function ensureStorageCapacity(additionalBytes = 0) {
  const capacity = await getStorageCapacity();
  if (
    additionalBytes > capacity.physicalFreeBytes ||
    capacity.usedBytes + additionalBytes > capacity.totalBytes
  ) {
    const error = new Error(
      "Upload rejected: the global SkyNest storage limit would be exceeded.",
    );
    error.statusCode = 507;
    throw error;
  }
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

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      "SELECT id, username, is_admin FROM users WHERE id = $1",
      [payload.id],
    );
    if (!result.rowCount) {
      return res.status(401).json({ error: "This account no longer exists. Please sign in again." });
    }
    const user = result.rows[0];
    req.user = {
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin,
    };
    next();
  } catch (error) {
    if (
      error?.name === "JsonWebTokenError" ||
      error?.name === "TokenExpiredError"
    ) {
      return res.status(401).json({ error: "Please sign in again." });
    }
    next(error);
  }
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

async function renameFolderRecord(folder, requestedName) {
  const name = cleanName(requestedName, "Folder name");
  if (name === folder.folder_name) return folder;

  const currentPath = await getFolderDiskPath(folder);
  const parentSegments = path
    .relative(STORAGE_ROOT, path.dirname(currentPath))
    .split(path.sep)
    .filter(Boolean);
  const nextPath = storagePath(...parentSegments, name);
  try {
    await fs.access(nextPath);
    throw new Error("A storage folder with that name already exists.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await fs.rename(currentPath, nextPath);
  try {
    const result = await pool.query(
      "UPDATE shared_folders SET folder_name = $1 WHERE id = $2 RETURNING *",
      [name, folder.id],
    );
    return result.rows[0];
  } catch (error) {
    await fs.rename(nextPath, currentPath).catch(() => {});
    throw error;
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

async function getAccessibleFolderTrail(user, folder) {
  const trail = await getFolderTrail(folder);
  if (user.isAdmin) return trail;

  const result = await pool.query(
    `SELECT folder_id
       FROM folder_permissions
      WHERE user_id = $1
        AND can_read = TRUE
        AND folder_id = ANY($2::int[])`,
    [user.id, trail.map(item => item.id)],
  );
  const directlyReadable = new Set(
    result.rows.map(row => Number(row.folder_id)),
  );
  const accessRootIndex = trail.findIndex(item =>
    directlyReadable.has(Number(item.id)),
  );
  return accessRootIndex >= 0 ? trail.slice(accessRootIndex) : [];
}

function parseQuota(value) {
  const quota = Number(value);
  if (!Number.isSafeInteger(quota) || quota < 0) throw new Error("Quota must be a non-negative whole number of bytes.");
  if (STORAGE_LIMIT_BYTES !== null && quota > STORAGE_LIMIT_BYTES) {
    throw new Error("Folder quota cannot exceed the global SkyNest storage limit.");
  }
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

async function cleanupExpiredUploads() {
  const cutoff = Date.now() - 25 * 60 * 60 * 1000;
  const entries = await fs.readdir(UPLOAD_TEMP_ROOT, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(entry => entry.isFile())
      .map(async entry => {
        const entryPath = path.join(UPLOAD_TEMP_ROOT, entry.name);
        if ((await fs.stat(entryPath)).mtimeMs < cutoff) {
          await fs.unlink(entryPath).catch(() => {});
        }
      }),
  );
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
  if (!user.isAdmin && parentId === null) {
    const assignments = (
      await pool.query(
        `SELECT f.*, p.can_read, p.can_write, p.can_delete
           FROM folder_permissions p
           JOIN shared_folders f ON f.id = p.folder_id
          WHERE p.user_id = $1
            AND p.can_read = TRUE
          ORDER BY f.folder_name`,
        [user.id],
      )
    ).rows;
    const assignedIds = new Set(
      assignments.map(folder => Number(folder.id)),
    );
    const accessRoots = [];
    for (const folder of assignments) {
      const ancestors = (await getFolderTrail(folder)).slice(0, -1);
      if (!ancestors.some(parent => assignedIds.has(Number(parent.id)))) {
        accessRoots.push(folder);
      }
    }
    return accessRoots;
  }

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
  try {
    res.json({
      folder: req.folder,
      trail: await getAccessibleFolderTrail(req.user, req.folder),
    });
  }
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

app.post("/api/folders/:folderId/uploads", requireAuth, requireFolderPermission, requireCapability("can_write"), async (req, res, next) => {
  try {
    const fileSize = Number(req.body.fileSize);
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new Error("Invalid upload size.");
    await ensureStorageCapacity(fileSize);
    const relativePath = cleanRelativePath(req.body.relativePath);
    const requestedFilename = relativePath.pop();
    let targetFolder = req.folder;
    for (const segment of relativePath) targetFolder = await ensureSubfolder(targetFolder, segment);

    const rootFolder = (await getFolderTrail(req.folder))[0];
    const usedBytes = await getDirectorySize(await getFolderDiskPath(rootFolder));
    if (usedBytes + fileSize > Number(rootFolder.quota_limit_bytes)) {
      return res.status(413).json({ error: "Upload rejected: this folder quota would be exceeded." });
    }

    const uploadId = randomUUID();
    const token = jwt.sign(
      {
        type: "chunk-upload",
        uploadId,
        userId: req.user.id,
        folderId: req.folder.id,
        targetFolderId: targetFolder.id,
        filename: requestedFilename,
        fileSize,
      },
      JWT_SECRET,
      { expiresIn: "24h" },
    );
    res.status(201).json({ token, chunkSize: 8 * 1024 * 1024 });
  } catch (error) { next(error); }
});

app.post("/api/folders/:folderId/upload-chunks", requireAuth, requireFolderPermission, requireCapability("can_write"), upload.single("file"), async (req, res, next) => {
  let partPath;
  try {
    if (!req.file) throw new Error("Upload chunk is missing.");
    const ticket = jwt.verify(String(req.body.token || ""), JWT_SECRET);
    if (
      ticket.type !== "chunk-upload" ||
      Number(ticket.userId) !== Number(req.user.id) ||
      Number(ticket.folderId) !== Number(req.folder.id) ||
      !/^[0-9a-f-]{36}$/i.test(String(ticket.uploadId))
    ) {
      return res.status(403).json({ error: "Invalid upload session." });
    }

    const offset = Number(req.body.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid chunk offset.");
    partPath = path.join(UPLOAD_TEMP_ROOT, `${ticket.uploadId}.part`);
    const donePath = path.join(UPLOAD_TEMP_ROOT, `${ticket.uploadId}.done.json`);
    const completed = await fs.readFile(donePath, "utf8")
      .then(value => JSON.parse(value))
      .catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (completed) {
      await fs.unlink(req.file.path);
      return res.status(201).json(completed);
    }
    const currentSize = await fs.stat(partPath).then(stat => stat.size).catch(error => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
    if (currentSize !== offset) {
      await fs.unlink(req.file.path);
      return res.status(409).json({
        error: "Upload offset is out of sync.",
        expectedOffset: currentSize,
      });
    }

    const chunk = await fs.readFile(req.file.path);
    await fs.appendFile(partPath, chunk);
    recordBackendIo({ readBytes: chunk.length, writeBytes: chunk.length });
    await fs.unlink(req.file.path);
    const receivedBytes = currentSize + chunk.length;
    if (receivedBytes > Number(ticket.fileSize)) {
      await fs.unlink(partPath).catch(() => {});
      throw new Error("Upload is larger than declared.");
    }
    if (receivedBytes < Number(ticket.fileSize)) {
      return res.json({ done: false, receivedBytes });
    }

    const rootFolder = (await getFolderTrail(req.folder))[0];
    await ensureStorageCapacity(receivedBytes);
    const usedBytes = await getDirectorySize(await getFolderDiskPath(rootFolder));
    if (usedBytes + receivedBytes > Number(rootFolder.quota_limit_bytes)) {
      await fs.unlink(partPath).catch(() => {});
      return res.status(413).json({ error: "Upload rejected: this folder quota would be exceeded." });
    }
    const targetFolder = await getFolder(ticket.targetFolderId);
    const filename = await moveUploadedFileUniquely(
      await getFolderDiskPath(targetFolder),
      ticket.filename,
      partPath,
    );
    adjustApplicationUsedBytes(receivedBytes);
    const result = { done: true, receivedBytes, name: filename };
    await fs.writeFile(donePath, JSON.stringify(result));
    res.status(201).json(result);
  } catch (error) {
    await fs.unlink(req.file?.path).catch(() => {});
    next(error);
  }
});

app.delete("/api/folders/:folderId/uploads", requireAuth, requireFolderPermission, requireCapability("can_write"), async (req, res, next) => {
  try {
    const ticket = jwt.verify(String(req.body.token || ""), JWT_SECRET);
    if (
      ticket.type !== "chunk-upload" ||
      Number(ticket.userId) !== Number(req.user.id) ||
      Number(ticket.folderId) !== Number(req.folder.id) ||
      !/^[0-9a-f-]{36}$/i.test(String(ticket.uploadId))
    ) {
      return res.status(403).json({ error: "Invalid upload session." });
    }
    await Promise.all(
      [".part", ".done.json"].map(suffix =>
        fs.unlink(path.join(UPLOAD_TEMP_ROOT, `${ticket.uploadId}${suffix}`))
          .catch(error => {
            if (error.code !== "ENOENT") throw error;
          }),
      ),
    );
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post("/api/folders/:folderId/upload", requireAuth, requireFolderPermission, requireCapability("can_write"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new Error("Choose a file to upload.");
    await ensureStorageCapacity(req.file.size);
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
    recordBackendIo({ readBytes: req.file.size, writeBytes: req.file.size });
    adjustApplicationUsedBytes(req.file.size);
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
  try {
    const filePath = path.join(
      await getFolderDiskPath(req.folder),
      cleanName(req.params.filename, "File name"),
    );
    const fileSize = (await fs.stat(filePath)).size;
    await fs.unlink(filePath);
    adjustApplicationUsedBytes(-fileSize);
    res.status(204).end();
  }
  catch (error) { next(error); }
});

app.get("/api/admin/disk", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getStorageCapacity());
  } catch (error) { next(error); }
});
app.get("/api/admin/metrics", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    res.json(await getSystemMetrics());
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
app.patch("/api/admin/users/:userId", requireAuth, requireAdmin, async (req, res, next) => {
  let client;
  try {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      const error = new Error("Invalid user.");
      error.statusCode = 400;
      throw error;
    }

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
    const currentResult = await client.query(
      "SELECT id, username, password_hash, is_admin FROM users WHERE id = $1",
      [userId],
    );
    if (!currentResult.rowCount) {
      const error = new Error("User not found.");
      error.statusCode = 404;
      throw error;
    }

    const current = currentResult.rows[0];
    const username =
      req.body.username === undefined
        ? current.username
        : cleanName(req.body.username, "Username");
    const isAdmin =
      req.body.isAdmin === undefined
        ? current.is_admin
        : Boolean(req.body.isAdmin);
    const password = String(req.body.password || "");

    if (userId === req.user.id && !isAdmin) {
      const error = new Error("You cannot remove your own administrator role.");
      error.statusCode = 400;
      throw error;
    }
    if (current.is_admin && !isAdmin) {
      const adminCount = Number(
        (await client.query("SELECT COUNT(*) AS count FROM users WHERE is_admin = TRUE"))
          .rows[0].count,
      );
      if (adminCount <= 1) {
        const error = new Error("SkyNest must always have at least one administrator.");
        error.statusCode = 409;
        throw error;
      }
    }
    if (password && password.length < 8) {
      const error = new Error("Password must contain at least 8 characters.");
      error.statusCode = 400;
      throw error;
    }

    const passwordHash = password
      ? await bcrypt.hash(password, 12)
      : current.password_hash;
    const result = await client.query(
      `UPDATE users
       SET username = $1, password_hash = $2, is_admin = $3
       WHERE id = $4
       RETURNING id, username, is_admin`,
      [username, passwordHash, isAdmin, userId],
    );
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client?.release();
  }
});
app.delete("/api/admin/users/:userId", requireAuth, requireAdmin, async (req, res, next) => {
  let client;
  try {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      const error = new Error("Invalid user.");
      error.statusCode = 400;
      throw error;
    }
    if (userId === req.user.id) {
      const error = new Error("You cannot delete the account you are currently using.");
      error.statusCode = 400;
      throw error;
    }

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
    const currentResult = await client.query(
      "SELECT id, is_admin FROM users WHERE id = $1",
      [userId],
    );
    if (!currentResult.rowCount) {
      const error = new Error("User not found.");
      error.statusCode = 404;
      throw error;
    }
    if (currentResult.rows[0].is_admin) {
      const adminCount = Number(
        (await client.query("SELECT COUNT(*) AS count FROM users WHERE is_admin = TRUE"))
          .rows[0].count,
      );
      if (adminCount <= 1) {
        const error = new Error("SkyNest must always have at least one administrator.");
        error.statusCode = 409;
        throw error;
      }
    }

    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client?.release();
  }
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
app.patch("/api/folders/:folderId", requireAuth, requireFolderPermission, requireCapability("can_write"), async (req, res, next) => {
  try {
    res.json(await renameFolderRecord(req.folder, req.body.folderName));
  } catch (error) { next(error); }
});
app.delete("/api/folders/:folderId", requireAuth, requireFolderPermission, requireCapability("can_delete"), async (req, res, next) => {
  try {
    if (!req.folder.parent_id) return res.status(403).json({ error: "Only an administrator can delete a root folder." });
    const folderPath = await getFolderDiskPath(req.folder);
    const folderSize = await getDirectorySize(folderPath);
    await fs.rm(folderPath, { recursive: true, force: false });
    adjustApplicationUsedBytes(-folderSize);
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
    const folderPath = await getFolderDiskPath(folder);
    const folderSize = await getDirectorySize(folderPath);
    await fs.rm(folderPath, { recursive: true, force: false });
    adjustApplicationUsedBytes(-folderSize);
    await pool.query("DELETE FROM shared_folders WHERE id = $1", [folder.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});
app.get("/api/admin/folders/:folderId/permissions", requireAuth, requireAdmin, async (req, res, next) => { try { res.json((await pool.query("SELECT user_id, can_read, can_write, can_delete FROM folder_permissions WHERE folder_id = $1", [req.params.folderId])).rows); } catch (e) { next(e); } });
app.put("/api/admin/folders/:folderId/permissions", requireAuth, requireAdmin, async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await getFolder(req.params.folderId);
    const updates = Array.isArray(req.body.permissions)
      ? req.body.permissions
      : [];
    for (const update of updates) {
      if (!Number.isSafeInteger(Number(update.userId))) {
        throw new Error("Invalid permission user.");
      }
      if ((update.canWrite || update.canDelete) && !update.canRead) {
        throw new Error("Write or delete requires read permission.");
      }
    }

    await client.query("BEGIN");
    for (const update of updates) {
      if (!update.canRead && !update.canWrite && !update.canDelete) {
        await client.query(
          "DELETE FROM folder_permissions WHERE folder_id = $1 AND user_id = $2",
          [req.params.folderId, update.userId],
        );
      } else {
        await client.query(
          `INSERT INTO folder_permissions
             (folder_id, user_id, can_read, can_write, can_delete)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, folder_id)
           DO UPDATE SET
             can_read = EXCLUDED.can_read,
             can_write = EXCLUDED.can_write,
             can_delete = EXCLUDED.can_delete`,
          [
            req.params.folderId,
            update.userId,
            Boolean(update.canRead),
            Boolean(update.canWrite),
            Boolean(update.canDelete),
          ],
        );
      }
    }
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client?.release();
  }
});
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
  res.status(error.statusCode || 500).json({ error: error.message || "Unexpected server error." });
});

await fs.mkdir(STORAGE_ROOT, { recursive: true });
await fs.mkdir(UPLOAD_TEMP_ROOT, { recursive: true });
await cleanupExpiredUploads();
await migrateDatabase();
for (const rootFolder of await listFolders({ isAdmin: true })) await reconcileStorageFolders(rootFolder);
await createInitialAdmin();
const server = app.listen(PORT, () =>
  console.log(`SkyNest API listening on ${PORT}`),
);
// Large uploads may legitimately take longer than Node's default request
// timeout. Authentication and Multer's size limit still constrain requests.
server.requestTimeout = 0;
