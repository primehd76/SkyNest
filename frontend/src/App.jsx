import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import axios from "axios";
import {
  Activity,
  ChevronRight,
  Cloud,
  Cpu,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  FolderUp,
  HardDrive,
  HeartPulse,
  LockKeyhole,
  LogOut,
  MoreVertical,
  Moon,
  Network,
  Package,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  Sun,
  Thermometer,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

const api = axios.create({ baseURL: "/api" });
const UPLOAD_DB_NAME = "skynest-uploads";
const UPLOAD_STORE_NAME = "queue";

function BrandLockup({ compact = false }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
      <img src="/skynest-logo.png" alt="SkyNest" className={compact ? "h-8 w-auto max-w-[118px] object-contain" : "h-28 w-auto max-w-[400px] object-contain"} />
      <span className="inline-flex items-center gap-1.5 border-l border-slate-200 pl-2 text-[10px] font-medium text-slate-400 dark:border-slate-700 dark:text-slate-500">
        Powered by <img src="/itbro7-logo.png" alt="ITBRO7" className={compact ? "h-6 w-auto max-w-[58px] object-contain" : "h-14 w-auto max-w-[140px] object-contain"} />
      </span>
    </span>
  );
}

function openUploadDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(UPLOAD_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(UPLOAD_STORE_NAME)) {
        request.result.createObjectStore(UPLOAD_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withUploadStore(mode, action) {
  const database = await openUploadDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(UPLOAD_STORE_NAME, mode);
    const store = transaction.objectStore(UPLOAD_STORE_NAME);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

const savePersistedUpload = (task) =>
  withUploadStore("readwrite", (store) =>
    store.put({
      ...task,
      cancelSource: undefined,
      status: "queued",
    }),
  );
const deletePersistedUpload = (taskId) =>
  withUploadStore("readwrite", (store) => store.delete(taskId));
const loadPersistedUploads = () =>
  withUploadStore("readonly", (store) => store.getAll());

const bytes = (value = 0) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
};

const throughput = (value = 0) => {
  if (!value) return "0 B/s";
  return `${bytes(value)}/s`;
};

function FileTypeIcon({ name, size = 18 }) {
  const extension = name.split(".").pop()?.toLowerCase();
  const props = { size, className: "shrink-0 text-slate-500" };
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension))
    return <FileImage {...props} className="shrink-0 text-violet-500" />;
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(extension))
    return <FileVideo {...props} className="shrink-0 text-rose-500" />;
  if (["mp3", "wav", "flac", "m4a", "ogg"].includes(extension))
    return <FileAudio {...props} className="shrink-0 text-pink-500" />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension))
    return <FileArchive {...props} className="shrink-0 text-amber-600" />;
  if (["exe", "msi", "apk", "dmg", "deb", "rpm"].includes(extension))
    return <Package {...props} className="shrink-0 text-indigo-600" />;
  if (["xls", "xlsx", "csv"].includes(extension))
    return <FileSpreadsheet {...props} className="shrink-0 text-emerald-600" />;
  if (
    ["js", "jsx", "ts", "tsx", "json", "html", "css", "py", "java"].includes(
      extension,
    )
  )
    return <FileCode2 {...props} className="shrink-0 text-sky-600" />;
  if (["pdf", "doc", "docx", "txt", "md"].includes(extension))
    return <FileText {...props} className="shrink-0 text-blue-600" />;
  return <File {...props} />;
}

function Panel({ title, children, className = "" }) {
  return (
    <section
      className={`rounded-xl bg-white p-5 shadow-sm dark:bg-slate-900 ${className}`}
    >
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ThemeButton({ darkMode, toggleTheme, className = "" }) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={darkMode ? "Use light mode" : "Use dark mode"}
      aria-label={darkMode ? "Use light mode" : "Use dark mode"}
      className={`grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-sky-300 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-700 dark:hover:text-sky-300 ${className}`}
    >
      {darkMode ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function Login({ onLogin, darkMode, toggleTheme }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const { data } = await api.post("/auth/login", { username, password });
      onLogin(data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not sign in.");
    }
  }
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-slate-50 p-5 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.10),transparent_34%)]" />
      <ThemeButton
        darkMode={darkMode}
        toggleTheme={toggleTheme}
        className="absolute right-5 top-5 z-10"
      />
      <div className="absolute left-1/2 top-8 -translate-x-1/2">
        <BrandLockup />
      </div>
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white/95 p-8 shadow-xl shadow-slate-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:shadow-black/20"
      >
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
          Welcome back
        </h1>
        <p className="mb-6 mt-1 text-sm text-slate-500 dark:text-slate-400">
          Sign in to access your shared storage.
        </p>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Username
          <input
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 outline-none ring-sky-500 transition focus:border-sky-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="Enter your username"
            required
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Password
          <input
            type="password"
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 outline-none ring-sky-500 transition focus:border-sky-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Enter your password"
            required
          />
        </label>
        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}
        <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 py-2.5 font-medium text-white shadow-sm shadow-sky-200 hover:bg-sky-700 dark:shadow-none">
          <LockKeyhole size={17} />
          Sign in
        </button>
      </form>
    </main>
  );
}

function Drive({ token, user, openAdmin, darkMode, toggleTheme }) {
  const [folders, setFolders] = useState([]),
    [active, setActive] = useState(null),
    [fileData, setFileData] = useState(null);
  const [message, setMessage] = useState(null),
    [uploads, setUploads] = useState([]),
    [menu, setMenu] = useState(null),
    [folderMenu, setFolderMenu] = useState(null),
    [trail, setTrail] = useState([]);
  const [homeMetrics, setHomeMetrics] = useState(null);
  const [homeMetricsError, setHomeMetricsError] = useState("");
  const activeRef = useRef(null);
  const uploadQueueRef = useRef([]);
  const activeUploadRef = useRef(null);
  const uploadProcessingRef = useRef(false);
  const restoredUploadsRef = useRef(false);
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );
  useEffect(() => {
    if (!user.isAdmin) return undefined;
    let stopped = false;
    const refresh = async () => {
      try {
        const { data } = await api.get("/admin/metrics", { headers });
        if (!stopped) {
          setHomeMetrics(data);
          setHomeMetricsError("");
        }
      } catch (error) {
        if (!stopped) setHomeMetricsError(error.response?.data?.error || "Live metrics unavailable.");
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [headers, user.isAdmin]);
  const refreshFolders = useCallback(
    async () => setFolders((await api.get("/folders", { headers })).data),
    [headers],
  );
  const refreshFiles = useCallback(
    async (folder = active) => {
      if (folder)
        setFileData(
          (await api.get(`/folders/${folder.id}/files`, { headers })).data,
        );
    },
    [active, headers],
  );
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    if (restoredUploadsRef.current) return;
    restoredUploadsRef.current = true;
    navigator.storage?.persist?.().catch(() => {});
    loadPersistedUploads()
      .then((savedTasks) => {
        if (!savedTasks.length) return;
        const restoredTasks = savedTasks.map((task) => ({
          ...task,
          status: "queued",
          progress: task.file?.size
            ? Math.round(((task.offset || 0) * 100) / task.file.size)
            : 0,
        }));
        uploadQueueRef.current.push(...restoredTasks);
        setUploads((current) => [...current, ...restoredTasks]);
        void processUploadQueue();
      })
      .catch((error) => showError(error));
  }, []);
  useEffect(() => {
    const hasActiveUploads = uploads.some((item) =>
      ["queued", "uploading", "retrying"].includes(item.status),
    );
    if (!hasActiveUploads) return undefined;
    const warnBeforeReload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeReload);
    return () => window.removeEventListener("beforeunload", warnBeforeReload);
  }, [uploads]);
  useEffect(() => {
    refreshFolders().catch(showError);
  }, [refreshFolders]);
  useEffect(() => {
    const restoreFolder = (folderId) => {
      if (!folderId) {
        goHome(false);
        return;
      }
      api
        .get(`/folders/${folderId}`, { headers })
        .then(({ data }) => {
          setActive(data.folder);
          setTrail(data.trail);
          return refreshFiles(data.folder);
        })
        .catch(() => {
          localStorage.removeItem("skynest:lastFolderId");
          goHome(false);
        });
    };
    const current =
      new URLSearchParams(window.location.search).get("folder") ||
      localStorage.getItem("skynest:lastFolderId");
    restoreFolder(current);
    const onPopState = () =>
      restoreFolder(new URLSearchParams(window.location.search).get("folder"));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [headers]);
  function showError(error) {
    setMessage({
      type: "error",
      text:
        error.response?.data?.error ||
        error.message ||
        "Something went wrong.",
    });
  }
  const showSuccess = (text) => setMessage({ type: "success", text });
  async function selectFolder(
    folder,
    nextTrail = [folder],
    pushHistory = true,
  ) {
    setActive(folder);
    setMenu(null);
    setFolderMenu(null);
    setTrail(nextTrail);
    localStorage.setItem("skynest:lastFolderId", String(folder.id));
    if (pushHistory)
      window.history.pushState(
        { folderId: folder.id },
        "",
        `${window.location.pathname}?folder=${folder.id}`,
      );
    try {
      await refreshFiles(folder);
    } catch (e) {
      showError(e);
    }
  }
  function goHome(pushHistory = true) {
    setActive(null);
    setFileData(null);
    setTrail([]);
    setMenu(null);
    setFolderMenu(null);
    setMessage(null);
    localStorage.removeItem("skynest:lastFolderId");
    if (pushHistory) window.history.pushState({}, "", window.location.pathname);
  }
  async function createSubfolder() {
    if (!active) return;
    const folderName = prompt("Folder name");
    if (!folderName) return;
    try {
      await api.post(
        `/folders/${active.id}/subfolders`,
        { folderName },
        { headers },
      );
      await refreshFiles(active);
      showSuccess("Folder created successfully.");
    } catch (e) {
      showError(e);
    }
  }
  async function renameFolder(folder) {
    const folderName = prompt("New folder name", folder.folder_name);
    if (!folderName || folderName === folder.folder_name) return;
    try {
      await api.patch(
        user.isAdmin
          ? `/admin/folders/${folder.id}`
          : `/folders/${folder.id}`,
        user.isAdmin
          ? { folderName, quotaLimitBytes: Number(folder.quota_limit_bytes) }
          : { folderName },
        { headers },
      );
      setFolderMenu(null);
      await refreshFolders();
      if (active) await refreshFiles(active);
      showSuccess("Folder renamed successfully.");
    } catch (e) {
      showError(e);
    }
  }
  async function setFolderQuota(folder) {
    const value = prompt(
      "New quota in GB",
      (Number(folder.quota_limit_bytes) / 1024 ** 3).toString(),
    );
    if (value === null) return;
    const quotaLimitBytes = Math.round(Number(value) * 1024 ** 3);
    if (!Number.isSafeInteger(quotaLimitBytes) || quotaLimitBytes < 0)
      return showError(new Error("Quota must be a non-negative number of GB."));
    try {
      await api.patch(
        `/admin/folders/${folder.id}`,
        { folderName: folder.folder_name, quotaLimitBytes },
        { headers },
      );
      setFolderMenu(null);
      await refreshFolders();
      if (active) await refreshFiles(active);
      showSuccess("Folder quota updated successfully.");
    } catch (e) {
      showError(e);
    }
  }
  async function deleteFolder(folder) {
    if (
      !confirm(
        `Delete folder ${folder.folder_name} and ALL of its contents? This cannot be undone.`,
      )
    )
      return;
    try {
      await api.delete(
        user.isAdmin ? `/admin/folders/${folder.id}` : `/folders/${folder.id}`,
        { headers },
      );
      setFolderMenu(null);
      await refreshFolders();
      if (active) await refreshFiles(active);
      showSuccess("Folder deleted successfully.");
    } catch (e) {
      showError(e);
    }
  }
  async function uploadFileInChunks(task, cancelSource) {
    const { file, relativePath, targetFolder } = task;
    let session = task.session;
    if (!session) {
      const response = await api.post(
        `/folders/${targetFolder.id}/uploads`,
        { relativePath, fileSize: file.size },
        { headers, cancelToken: cancelSource.token },
      );
      session = response.data;
      task.session = session;
      task.offset = 0;
      updateUploadTask(task.id, { session, offset: 0 });
      if (task.persisted) await savePersistedUpload(task);
    }
    let offset = Number(task.offset || 0);
    let firstChunk = true;

    try {
      while (firstChunk || offset < file.size) {
        firstChunk = false;
        const chunkEnd = Math.min(offset + session.chunkSize, file.size);
        const chunk = file.slice(offset, chunkEnd);
        const form = new FormData();
        form.append("token", session.token);
        form.append("offset", String(offset));
        form.append(
          "file",
          chunk,
          file.name || task.name.split(/[\\/]/).pop(),
        );

        let response;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            response = await api.post(
              `/folders/${targetFolder.id}/upload-chunks`,
              form,
              {
                headers,
                cancelToken: cancelSource.token,
                timeout: 3 * 60 * 1000,
                onUploadProgress: (event) => {
                  const sentInChunk = Math.min(event.loaded, chunk.size);
                  const sentBytes = offset + sentInChunk;
                  updateUploadTask(task.id, {
                    progress: file.size
                      ? Math.min(
                          100,
                          Math.round((sentBytes * 100) / file.size),
                        )
                      : 100,
                    status: "uploading",
                  });
                },
              },
            );
            break;
          } catch (error) {
            if (axios.isCancel(error)) throw error;
            const expectedOffset = Number(
              error.response?.data?.expectedOffset,
            );
            if (
              error.response?.status === 409 &&
              Number.isSafeInteger(expectedOffset) &&
              expectedOffset >= 0 &&
              expectedOffset <= file.size
            ) {
              offset = expectedOffset;
              task.offset = offset;
              updateUploadTask(task.id, { offset });
              if (task.persisted) await savePersistedUpload(task);
              response = null;
              break;
            }
            if (attempt === 3) throw error;
            updateUploadTask(task.id, { status: "retrying" });
            await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          }
        }

        if (!response) continue;
        offset = Number(response.data.receivedBytes);
        task.offset = offset;
        updateUploadTask(task.id, { offset });
        if (task.persisted) await savePersistedUpload(task);
        if (response.data.done) return response.data;
      }
    } catch (error) {
      await api
        .delete(`/folders/${targetFolder.id}/uploads`, {
          headers,
          data: { token: session.token },
        })
        .catch(() => {});
      throw error;
    }
  }
  function updateUploadTask(taskId, patch) {
    setUploads((current) =>
      current.map((item) =>
        item.id === taskId ? { ...item, ...patch } : item,
      ),
    );
  }
  function cancelUpload(taskId) {
    const task = uploads.find((item) => item.id === taskId);
    uploadQueueRef.current = uploadQueueRef.current.filter(
      (task) => task.id !== taskId,
    );
    if (activeUploadRef.current?.id === taskId) {
      activeUploadRef.current.cancelSource.cancel("User cancelled upload");
    }
    updateUploadTask(taskId, {
      status: "cancelled",
      error: "Cancelled by user",
    });
    if (task?.persisted) void deletePersistedUpload(taskId);
  }
  function dismissUpload(task) {
    setUploads((current) =>
      current.filter((upload) => upload.id !== task.id),
    );
    if (task.persisted) void deletePersistedUpload(task.id);
  }
  async function retryUpload(task) {
    const retryTask = {
      ...task,
      status: "queued",
      error: null,
      progress: task.file?.size
        ? Math.round(((task.offset || 0) * 100) / task.file.size)
        : 0,
    };
    if (retryTask.persisted) await savePersistedUpload(retryTask);
    setUploads((current) =>
      current.map((item) => (item.id === task.id ? retryTask : item)),
    );
    uploadQueueRef.current.push(retryTask);
    void processUploadQueue();
  }
  function clearFinishedUploads() {
    const finished = uploads.filter(
      (item) =>
        !["queued", "uploading", "retrying"].includes(item.status),
    );
    setUploads((current) =>
      current.filter((item) =>
        ["queued", "uploading", "retrying"].includes(item.status),
      ),
    );
    for (const task of finished) {
      if (task.persisted) void deletePersistedUpload(task.id);
    }
  }
  async function processUploadQueue() {
    if (uploadProcessingRef.current) return;
    uploadProcessingRef.current = true;
    let hadFailure = false;
    let hadCancellation = false;
    while (uploadQueueRef.current.length) {
      const task = uploadQueueRef.current.shift();
      const cancelSource = axios.CancelToken.source();
      activeUploadRef.current = { id: task.id, cancelSource };
      updateUploadTask(task.id, {
        status: "uploading",
        cancelSource,
      });
      try {
        await uploadFileInChunks(task, cancelSource);
        updateUploadTask(task.id, {
          status: "completed",
          progress: 100,
          cancelSource: null,
        });
        if (task.persisted) await deletePersistedUpload(task.id);
        if (activeRef.current?.id === task.uploadParent.id) {
          await refreshFiles(task.uploadParent);
        }
      } catch (error) {
        if (!axios.isCancel(error)) hadFailure = true;
        else hadCancellation = true;
        updateUploadTask(task.id, {
          status: axios.isCancel(error) ? "cancelled" : "failed",
          error: axios.isCancel(error)
            ? "Cancelled by user"
            : error.response?.data?.error || error.message,
          cancelSource: null,
        });
        if (axios.isCancel(error) && task.persisted) {
          await deletePersistedUpload(task.id).catch(() => {});
        }
      } finally {
        activeUploadRef.current = null;
      }
    }
    uploadProcessingRef.current = false;
    if (hadFailure) {
      showError(new Error("One or more uploads failed. Check the upload queue."));
    } else if (hadCancellation) {
      setMessage({ type: "info", text: "One or more uploads were cancelled." });
    } else {
      showSuccess("Upload queue completed.");
    }
  }
  async function enqueueUploadTasks(tasks) {
    setUploads((current) => [...current, ...tasks]);
    let persistenceFailed = false;
    for (const task of tasks) {
      try {
        task.persisted = true;
        await savePersistedUpload(task);
      } catch {
        task.persisted = false;
        persistenceFailed = true;
      }
    }
    if (persistenceFailed) {
      setMessage({
        type: "info",
        text: "Some large files could not be cached for refresh recovery. Keep this tab open until they finish.",
      });
    }
    uploadQueueRef.current.push(...tasks);
    void processUploadQueue();
  }
  async function uploadFile(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !active) return;
    // CancelToken is retained here because this is the requested Axios cancellation API.
    // The source is stored in state so the visible cancel button can abort this exact upload.
    const uploadParent = active;
    let targetFolder = uploadParent;
    const isFolderUpload = files.some((file) => file.webkitRelativePath);
    const uploadedRootName = isFolderUpload
      ? files[0].webkitRelativePath.split(/[\\/]/)[0]
      : null;
    if (uploadedRootName) {
      setMessage({
        type: "info",
        text: `Preparing folder ${uploadedRootName}...`,
      });
      try {
        const { data } = await api.post(
          `/folders/${uploadParent.id}/subfolders`,
          { folderName: uploadedRootName, makeUnique: true },
          { headers },
        );
        targetFolder = data;
      } catch (e) {
        showError(e);
        return;
      }
    }
    const tasks = files.map((file, index) => {
      const browserPath = file.webkitRelativePath || file.name;
      const relativePath = uploadedRootName
        ? browserPath.split(/[\\/]/).slice(1).join("/")
        : browserPath;
      return {
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
        file,
        name: browserPath,
        relativePath,
        targetFolder,
        uploadParent,
        progress: null,
        status: "queued",
        session: null,
        offset: 0,
        index: index + 1,
        total: files.length,
      };
    });
    setMessage(null);
    await enqueueUploadTasks(tasks);
  }
  async function renameFile(file) {
    setMenu(null);
    const name = prompt("New file name", file.name);
    if (!name || name === file.name) return;
    try {
      await api.patch(
        `/folders/${active.id}/files/${encodeURIComponent(file.name)}`,
        { name },
        { headers },
      );
      await refreshFiles();
      showSuccess("File renamed successfully.");
    } catch (e) {
      showError(e);
    }
  }
  async function deleteFile(file) {
    setMenu(null);
    if (!confirm(`Delete ${file.name}? This cannot be undone.`)) return;
    try {
      await api.delete(
        `/folders/${active.id}/files/${encodeURIComponent(file.name)}`,
        { headers },
      );
      await refreshFiles();
      showSuccess("File deleted successfully.");
    } catch (e) {
      showError(e);
    }
  }
  async function downloadFile(file) {
    setMenu(null);
    try {
      const { data } = await api.post(
        `/folders/${active.id}/files/${encodeURIComponent(file.name)}/download-ticket`,
        {},
        { headers },
      );
      const link = Object.assign(document.createElement("a"), {
        href: data.url,
        download: file.name,
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      showError(e);
    }
  }
  async function downloadFolder() {
    if (!active) return;
    try {
      const { data } = await api.post(
        `/folders/${active.id}/download-ticket`,
        {},
        { headers },
      );
      const link = Object.assign(document.createElement("a"), {
        href: data.url,
        download: `${active.folder_name}.zip`,
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      showError(e);
    }
  }
  const percentage = fileData
    ? Math.min(100, (fileData.usedBytes / fileData.quotaLimitBytes) * 100 || 0)
    : 0;
  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      {(menu || folderMenu) && (
        <button
          aria-label="Close menu"
          onClick={() => {
            setMenu(null);
            setFolderMenu(null);
          }}
          className="fixed inset-0 z-10 cursor-default"
        />
      )}
      <header className="sticky top-0 z-30 flex h-[65px] items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <button
          onClick={goHome}
          className="flex items-center gap-2"
          title="Back to main page"
        >
          <BrandLockup compact />
        </button>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-600 dark:text-slate-300 sm:inline">
            {user.username}
          </span>
          <ThemeButton darkMode={darkMode} toggleTheme={toggleTheme} />
          {user.isAdmin && (
            <button
              onClick={openAdmin}
              className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-sky-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-sky-300"
              title="Administration"
            >
              <Shield size={18} />
            </button>
          )}
          <button
            onClick={() => {
              localStorage.removeItem("skynest");
              localStorage.removeItem("skynest:admin");
              location.reload();
            }}
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950 dark:hover:text-red-300"
            title="Sign out"
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>
      {user.isAdmin && (
        <div className="px-3 sm:px-5">
          <SystemMonitor metrics={homeMetrics} metricsError={homeMetricsError} />
        </div>
      )}
      <main className="grid min-h-[calc(100vh-65px)] w-full gap-4 p-3 sm:gap-5 sm:p-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-h-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:min-h-[calc(100vh-105px)]">
          <h2 className="mb-1 font-semibold">Shared folders</h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Storage available to your account
          </p>
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => selectFolder(folder, [folder])}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg p-2.5 text-left ${
                active?.id === folder.id
                  ? "bg-sky-50 text-sky-800 ring-1 ring-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <Folder size={18} />
              <span className="truncate">{folder.folder_name}</span>
            </button>
          ))}
          {!folders.length && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No folders are assigned to you.
            </p>
          )}
          {active && fileData && (
            <div className="mt-6 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
              <p className="font-medium">
                Root quota: {fileData.quotaFolderName || trail[0]?.folder_name}
              </p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                {bytes(fileData.usedBytes)} of {bytes(fileData.quotaLimitBytes)}{" "}
                used
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <ShieldCheck size={13} />
                Protected storage
              </p>
            </div>
          )}
        </aside>
        <section className="min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5 lg:min-h-[calc(100vh-105px)]">
          {!active ? (
            <div className="grid min-h-80 place-items-center text-slate-500 dark:text-slate-400">
              <div className="text-center">
                <span className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400">
                  <Folder size={34} />
                </span>
                <p className="font-medium text-slate-700 dark:text-slate-200">
                  Select a shared folder
                </p>
                <p className="mt-1 text-sm">
                  Choose a folder from the sidebar to view its contents.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                    {trail.map((folder, index) => (
                      <button
                        key={folder.id}
                        onClick={() =>
                          selectFolder(folder, trail.slice(0, index + 1))
                        }
                        className="flex items-center hover:text-sky-700 dark:hover:text-sky-300"
                      >
                        {index > 0 && <ChevronRight size={15} />}{" "}
                        {folder.folder_name}
                      </button>
                    ))}
                  </div>
                  <h1 className="text-xl font-bold tracking-tight">
                    {active.folder_name}
                  </h1>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                    {fileData &&
                      `${fileData.folders.length} ${
                        fileData.folders.length === 1 ? "folder" : "folders"
                      } · ${fileData.files.length} ${
                        fileData.files.length === 1 ? "file" : "files"
                      }`}
                  </p>
                </div>
                {fileData?.permissions.can_write && (
                  <button
                    onClick={createSubfolder}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-700 dark:hover:bg-sky-950"
                  >
                    <FolderPlus size={17} className="text-sky-600" />
                    New folder
                  </button>
                )}
              </div>
              {message && (
                <p
                  className={`mb-3 rounded border p-3 text-sm ${
                    message.type === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : message.type === "error"
                        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
                        : "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
                  }`}
                >
                  {message.text}
                </p>
              )}
              <div className="mb-5 grid gap-3 md:grid-cols-3">
                <button
                  type="button"
                  onClick={downloadFolder}
                  className="group flex min-h-[78px] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left shadow-sm hover:border-slate-300 hover:bg-white hover:shadow-md dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    <Download size={19} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Download folder
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      Save everything as ZIP
                    </span>
                  </span>
                </button>
                {fileData?.permissions.can_write && (
                  <>
                    <label className="group flex min-h-[78px] cursor-pointer items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left shadow-sm hover:border-sky-300 hover:bg-white hover:shadow-md dark:border-sky-900 dark:bg-sky-950/50 dark:hover:border-sky-700 dark:hover:bg-sky-950">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-600 text-white shadow-sm shadow-sky-200 dark:shadow-none">
                        <Upload size={19} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-sky-900 dark:text-sky-100">
                          Upload files
                        </span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Select one or more files
                        </span>
                      </span>
                      <input
                        className="hidden"
                        type="file"
                        multiple
                        onChange={uploadFile}
                      />
                    </label>
                    <label className="group flex min-h-[78px] cursor-pointer items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left shadow-sm hover:border-emerald-300 hover:bg-white hover:shadow-md dark:border-emerald-900 dark:bg-emerald-950/50 dark:hover:border-emerald-700 dark:hover:bg-emerald-950">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-200 dark:shadow-none">
                        <FolderUp size={19} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                          Upload folder
                        </span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          Keep its folder structure
                        </span>
                      </span>
                      <input
                        className="hidden"
                        type="file"
                        webkitdirectory=""
                        directory=""
                        multiple
                        onChange={uploadFile}
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fileData?.folders.map((folder) => (
                  <div
                    key={folder.id}
                    className="relative flex items-center rounded-lg border border-slate-200 hover:border-sky-200 hover:bg-sky-50 dark:border-slate-700 dark:hover:border-sky-800 dark:hover:bg-sky-950"
                  >
                    <button
                      onClick={() => selectFolder(folder, [...trail, folder])}
                      className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                    >
                      <Folder className="shrink-0 text-sky-600 dark:text-sky-400" />
                      <span className="truncate font-medium">
                        {folder.folder_name}
                      </span>
                    </button>
                    <button
                      onClick={() =>
                        setFolderMenu(
                          folderMenu === folder.id ? null : folder.id,
                        )
                      }
                      className="mr-2 rounded p-2 hover:bg-slate-200 dark:hover:bg-slate-700"
                      title="Folder actions"
                    >
                      <MoreVertical size={18} />
                    </button>
                    {folderMenu === folder.id && (
                      <div className="absolute right-2 top-11 z-20 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                        <button
                          onClick={() =>
                            selectFolder(folder, [...trail, folder])
                          }
                          className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Folder size={16} />
                          Open
                        </button>
                        {(user.isAdmin || folder.can_write) && (
                          <button
                            onClick={() => renameFolder(folder)}
                            className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            <Pencil size={16} />
                            Rename
                          </button>
                        )}
                        {user.isAdmin && (
                          <>
                            <button
                              onClick={openAdmin}
                              className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              <Users size={16} />
                              Manage access
                            </button>
                          </>
                        )}
                        {(user.isAdmin || folder.can_delete) && (
                          <button
                            onClick={() => deleteFolder(folder)}
                            className="flex w-full gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            <Trash2 size={16} />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto overflow-y-visible">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <tr>
                      <th className="p-3">Name</th>
                      <th className="p-3">Size</th>
                      <th className="p-3">Modified</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {fileData?.files.map((file) => (
                      <tr
                        key={file.name}
                        className="border-b border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                      >
                        <td className="p-3 font-medium">
                          <span className="flex items-center gap-2">
                            <FileTypeIcon name={file.name} />
                            {file.name}
                          </span>
                        </td>
                        <td className="p-3">{bytes(file.size)}</td>
                        <td className="p-3">
                          {new Date(file.modifiedAt).toLocaleString()}
                        </td>
                        <td className="relative p-3">
                          <button
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              const nextMenu = {
                                name: file.name,
                                right: Math.max(12, window.innerWidth - rect.right),
                                ...(rect.top > 170
                                  ? { bottom: Math.max(12, window.innerHeight - rect.top + 8) }
                                  : { top: Math.min(window.innerHeight - 12, rect.bottom + 8) }),
                              };
                              setMenu(menu?.name === file.name ? null : nextMenu);
                            }}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                            aria-label={`Actions for ${file.name}`}
                          >
                            <MoreVertical size={18} />
                          </button>
                          {menu?.name === file.name && (
                            <div
                              className="fixed z-[80] w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/30"
                              style={{ right: menu.right, ...(menu.bottom ? { bottom: menu.bottom } : { top: menu.top }) }}
                            >
                              <button
                                className="flex w-full gap-2 px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700"
                                onClick={() => downloadFile(file)}
                              >
                                <Download size={16} />
                                Download
                              </button>
                              {fileData.permissions.can_write && (
                                <button
                                  className="flex w-full gap-2 px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700"
                                  onClick={() => renameFile(file)}
                                >
                                  <Pencil size={16} />
                                  Rename
                                </button>
                              )}
                              {fileData.permissions.can_delete && (
                                <button
                                  className="flex w-full gap-2 px-3 py-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                                  onClick={() => deleteFile(file)}
                                >
                                  <Trash2 size={16} />
                                  Delete
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {fileData?.files.length === 0 &&
                  fileData?.folders.length === 0 && (
                    <p className="py-12 text-center text-slate-500 dark:text-slate-400">
                      This folder is empty.
                    </p>
                  )}
              </div>
            </>
          )}
        </section>
      </main>
      {uploads.length > 0 && (
        <aside className="fixed bottom-5 right-5 z-[60] w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <p className="font-semibold">Uploads</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {uploads.filter((item) =>
                  ["queued", "uploading", "retrying"].includes(item.status),
                ).length}{" "}
                item(s) remaining
              </p>
            </div>
            <button
              onClick={clearFinishedUploads}
              className="text-xs text-sky-700 hover:underline"
            >
              Clear finished
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {uploads.map((item) => (
              <div
                key={item.id}
                className="border-b border-slate-200 px-4 py-3 last:border-0 dark:border-slate-800"
              >
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.name}</p>
                    <p
                      className={`mt-1 text-xs ${
                        item.status === "failed"
                          ? "text-red-600"
                          : item.status === "completed"
                            ? "text-emerald-600"
                            : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {item.status === "queued" && "Waiting in queue"}
                      {item.status === "uploading" &&
                        `${item.progress ?? 0}% uploaded`}
                      {item.status === "retrying" &&
                        "Connection paused, retrying..."}
                      {item.status === "completed" && "Upload complete"}
                      {item.status === "cancelled" && "Upload cancelled"}
                      {item.status === "failed" &&
                        (item.error || "Upload failed")}
                    </p>
                  </div>
                  {["queued", "uploading", "retrying"].includes(
                    item.status,
                  ) ? (
                    <button
                      onClick={() => cancelUpload(item.id)}
                      className="shrink-0 text-xs text-red-600"
                    >
                      Cancel
                    </button>
                  ) : item.status === "failed" ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => retryUpload(item)}
                        className="text-xs font-medium text-sky-700"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => dismissUpload(item)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        aria-label="Dismiss upload"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => dismissUpload(item)}
                      className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      aria-label="Dismiss upload"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                  <div
                    className={`h-full transition-[width] ${
                      item.status === "failed"
                        ? "bg-red-500"
                        : item.status === "completed"
                          ? "bg-emerald-500"
                          : "bg-sky-600"
                    }`}
                    style={{ width: `${item.progress ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

function SystemMonitor({ metrics, metricsError }) {
  return (
    <Panel title="System monitor" className="mt-5 mb-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${metrics ? "animate-pulse bg-emerald-500" : "bg-slate-400"}`} />{metrics ? "Live / backend container every 3s / host health every 5m" : metricsError || "Connecting to metrics..."}</span>
        {metrics?.timestamp && <span>Updated {new Date(metrics.timestamp).toLocaleTimeString()}</span>}
      </div>
      {metrics && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/40"><div className="mb-3 flex items-center justify-between text-sky-700 dark:text-sky-300"><span className="text-sm font-medium">CPU</span><Cpu size={18} /></div><p className="text-2xl font-bold">{metrics.cpu.usagePercent.toFixed(1)}%</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{metrics.cpu.cores.toFixed(1)} cores limit · backend container</p></div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/40"><div className="mb-3 flex items-center justify-between text-violet-700 dark:text-violet-300"><span className="text-sm font-medium">Memory</span><Activity size={18} /></div><p className="text-2xl font-bold">{metrics.memory.usagePercent.toFixed(1)}%</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{bytes(metrics.memory.usedBytes)} of {bytes(metrics.memory.totalBytes)} · backend container</p></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40"><div className="mb-3 flex items-center justify-between text-emerald-700 dark:text-emerald-300"><span className="text-sm font-medium">Storage</span><HardDrive size={18} /></div><p className="text-2xl font-bold">{metrics.storage.usagePercent.toFixed(1)}%</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{bytes(metrics.storage.usedBytes)} used / {bytes(metrics.storage.totalBytes)} total</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{bytes(metrics.storage.freeBytes)} remaining</p></div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/40"><div className="mb-3 flex items-center justify-between text-orange-700 dark:text-orange-300"><span className="text-sm font-medium">Disk I/O</span><Activity size={18} /></div><p className="text-lg font-bold">Read {metrics.diskIo.available ? throughput(metrics.diskIo.readBytesPerSecond) : "N/A"}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Write {metrics.diskIo.available ? throughput(metrics.diskIo.writeBytesPerSecond) : "N/A"} · backend container</p></div>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-900 dark:bg-cyan-950/40"><div className="mb-3 flex items-center justify-between text-cyan-700 dark:text-cyan-300"><span className="text-sm font-medium">Network</span><Network size={18} /></div><p className="text-lg font-bold">Download {metrics.network.rxMbps.toFixed(2)} Mbps</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Upload {metrics.network.txMbps.toFixed(2)} Mbps</p></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40"><div className="mb-3 flex items-center justify-between text-amber-700 dark:text-amber-300"><span className="text-sm font-medium">Host health</span><HeartPulse size={18} /></div><p className="text-lg font-bold">{metrics.temperature.celsius === null ? "N/A" : `${metrics.temperature.celsius.toFixed(1)} °C`}</p><p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={metrics.diskHealth.message}>{metrics.diskHealth.status === "healthy" ? "Disk SMART healthy" : metrics.diskHealth.status === "warning" ? "Disk SMART warning" : "Disk health unavailable"}</p></div>
      </div>}
      {metrics && (metrics.temperature.status === "unavailable" || metrics.diskHealth.status === "unavailable") && <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"><Thermometer size={14} /> Temperature/SMART depends on sensors and host device access; unavailable values do not affect file storage.</p>}
    </Panel>
  );
}

function Admin({
  token,
  currentUser,
  onClose,
  darkMode,
  toggleTheme,
}) {
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );
  const [users, setUsers] = useState([]),
    [folders, setFolders] = useState([]),
    [children, setChildren] = useState([]),
    [metrics, setMetrics] = useState(null),
    [metricsError, setMetricsError] = useState(""),
    [selected, setSelected] = useState(null),
    [permissions, setPermissions] = useState([]),
    [permissionDrafts, setPermissionDrafts] = useState([]),
    [editingUser, setEditingUser] = useState(null),
    [message, setMessage] = useState(null);
  const showAdminError = (error) =>
    setMessage({
      type: "error",
      text: error.response?.data?.error || error.message || String(error),
    });
  const showAdminSuccess = (text) =>
    setMessage({ type: "success", text });
  const load = useCallback(async () => {
    const [u, f] = await Promise.all([
      api.get("/admin/users", { headers }),
      api.get("/folders", { headers }),
    ]);
    setUsers(u.data);
    setFolders(f.data);
  }, [headers]);
  useEffect(() => {
    load().catch(showAdminError);
  }, [load]);
  useEffect(() => {
    let stopped = false;
    const refreshMetrics = async () => {
      try {
        const { data } = await api.get("/admin/metrics", { headers });
        if (!stopped) {
          setMetrics(data);
          setMetricsError("");
        }
      } catch (error) {
        if (!stopped) setMetricsError(error.response?.data?.error || "Live metrics unavailable.");
      }
    };
    refreshMetrics();
    const timer = window.setInterval(refreshMetrics, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [headers]);
  async function selectFolder(folder) {
    if (
      selected &&
      selected.id !== folder.id &&
      hasPermissionChanges &&
      !confirm("Discard unsaved permission changes?")
    ) {
      return;
    }
    setSelected(folder);
    const [permissionResponse, childResponse] = await Promise.all([
      api.get(`/admin/folders/${folder.id}/permissions`, { headers }),
      api.get(`/folders?parentId=${folder.id}`, { headers }),
    ]);
    setPermissions(permissionResponse.data);
    setPermissionDrafts(permissionResponse.data.map(item => ({ ...item })));
    setChildren(childResponse.data);
  }
  async function createUser(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.post(
        "/admin/users",
        {
          username: form.get("username"),
          password: form.get("password"),
          isAdmin: form.get("isAdmin") === "on",
        },
        { headers },
      );
      formElement.reset();
      await load();
      showAdminSuccess("User created successfully.");
    } catch (e) {
      showAdminError(e);
    }
  }
  function editUser(user) {
    setEditingUser({
      id: user.id,
      username: user.username,
      isAdmin: user.is_admin,
      originalIsAdmin: user.is_admin,
      password: "",
    });
    setMessage(null);
  }
  async function saveUser(event) {
    event.preventDefault();
    if (!editingUser) return;
    try {
      await api.patch(
        `/admin/users/${editingUser.id}`,
        {
          username: editingUser.username,
          isAdmin: editingUser.isAdmin,
          ...(editingUser.password
            ? { password: editingUser.password }
            : {}),
        },
        { headers },
      );
      const editedCurrentAccount = editingUser.id === currentUser.id;
      setEditingUser(null);
      await load();
      showAdminSuccess(
        editedCurrentAccount
          ? "Your account was updated. Sign in again to refresh the account name in this session."
          : "User updated successfully.",
      );
    } catch (e) {
      showAdminError(e);
    }
  }
  async function deleteUser(user) {
    if (
      !confirm(
        `Delete user "${user.username}"? Their folder permissions will also be removed. This cannot be undone.`,
      )
    )
      return;
    try {
      await api.delete(`/admin/users/${user.id}`, { headers });
      if (editingUser?.id === user.id) setEditingUser(null);
      await load();
      if (selected) {
        const permissionResponse = await api.get(
          `/admin/folders/${selected.id}/permissions`,
          { headers },
        );
        setPermissions(permissionResponse.data);
        setPermissionDrafts(
          permissionResponse.data.map((item) => ({ ...item })),
        );
      }
      showAdminSuccess(`User "${user.username}" deleted successfully.`);
    } catch (e) {
      showAdminError(e);
    }
  }
  async function createFolder(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.post(
        "/admin/folders",
        {
          folderName: form.get("name"),
          quotaLimitBytes: Number(form.get("quotaGb")) * 1024 ** 3,
        },
        { headers },
      );
      formElement.reset();
      await load();
      showAdminSuccess("Shared folder created successfully.");
    } catch (e) {
      showAdminError(e);
    }
  }
  async function renameFolder() {
    if (!selected) return;
    const folderName = prompt("New folder name", selected.folder_name);
    if (!folderName || folderName === selected.folder_name) return;
    try {
      const { data } = await api.patch(
        `/admin/folders/${selected.id}`,
        { folderName, quotaLimitBytes: Number(selected.quota_limit_bytes) },
        { headers },
      );
      setSelected(data);
      await load();
      showAdminSuccess("Folder renamed successfully.");
    } catch (e) {
      showAdminError(e);
    }
  }
  async function changeQuota() {
    if (!selected) return;
    const value = prompt(
      "New quota in GB",
      (Number(selected.quota_limit_bytes) / 1024 ** 3).toString(),
    );
    if (value === null) return;
    const quotaLimitBytes = Math.round(Number(value) * 1024 ** 3);
    if (!Number.isSafeInteger(quotaLimitBytes) || quotaLimitBytes < 0)
      return showAdminError(
        new Error("Quota must be a non-negative number of GB."),
      );
    try {
      const { data } = await api.patch(
        `/admin/folders/${selected.id}`,
        { folderName: selected.folder_name, quotaLimitBytes },
        { headers },
      );
      setSelected(data);
      await load();
      showAdminSuccess("Folder quota updated successfully.");
    } catch (e) {
      showAdminError(e);
    }
  }
  async function deleteFolder() {
    if (
      !selected ||
      !confirm(
        `Delete ${selected.parent_id ? "folder" : "ROOT folder"} ${selected.folder_name} and ALL of its contents? This cannot be undone.`,
      )
    )
      return;
    try {
      await api.delete(`/admin/folders/${selected.id}`, { headers });
      setSelected(null);
      setPermissions([]);
      setPermissionDrafts([]);
      setChildren([]);
      await load();
      showAdminSuccess("Folder deleted successfully.");
    } catch (e) {
      showAdminError(e);
    }
  }
  const permissionFor = (user) =>
    permissions.find((p) => p.user_id === user.id) || {
      can_read: false,
      can_write: false,
      can_delete: false,
    };
  const draftPermissionFor = (user) =>
    permissionDrafts.find((p) => p.user_id === user.id) || {
      user_id: user.id,
      can_read: false,
      can_write: false,
      can_delete: false,
    };
  function updatePermissionDraft(user, field, checked) {
    const keyByField = {
      canRead: "can_read",
      canWrite: "can_write",
      canDelete: "can_delete",
    };
    setPermissionDrafts((currentDrafts) => {
      const current = draftPermissionFor(user);
      const next = { ...current, [keyByField[field]]: checked };
      if ((field === "canWrite" || field === "canDelete") && checked)
        next.can_read = true;
      if (field === "canRead" && !checked) {
        next.can_write = false;
        next.can_delete = false;
      }
      const exists = currentDrafts.some((item) => item.user_id === user.id);
      return exists
        ? currentDrafts.map((item) => (item.user_id === user.id ? next : item))
        : [...currentDrafts, next];
    });
  }
  const hasPermissionChanges = users
    .filter((user) => !user.is_admin)
    .some((user) => {
      const saved = permissionFor(user);
      const draft = draftPermissionFor(user);
      return (
        saved.can_read !== draft.can_read ||
        saved.can_write !== draft.can_write ||
        saved.can_delete !== draft.can_delete
      );
    });
  function cancelPermissionChanges() {
    setPermissionDrafts(permissions.map(item => ({ ...item })));
    setMessage(null);
  }
  async function savePermissions() {
    if (!selected || !hasPermissionChanges) return;
    try {
      await api.put(
        `/admin/folders/${selected.id}/permissions`,
        {
          permissions: users
            .filter((user) => !user.is_admin)
            .map((user) => {
              const draft = draftPermissionFor(user);
              return {
                userId: user.id,
                canRead: draft.can_read,
                canWrite: draft.can_write,
                canDelete: draft.can_delete,
              };
            }),
        },
        { headers },
      );
      await selectFolder(selected);
      showAdminSuccess("Folder permissions saved successfully.");
    } catch (e) {
      showAdminError(e);
    }
  }
  function closeAdmin() {
    if (
      hasPermissionChanges &&
      !confirm("Discard unsaved permission changes and close Administration?")
    ) {
      return;
    }
    onClose();
  }
  return (
    <main className="admin-surface min-h-screen w-full">
      <div className="sticky top-0 z-30 flex h-[65px] items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <h1 className="flex items-center gap-3 text-xl font-bold">
          <BrandLockup compact />
          <span className="border-l border-slate-200 pl-3 dark:border-slate-700"><span className="flex items-center gap-2"><Shield size={19} /> Administration</span></span>
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-600 dark:text-slate-300 sm:inline">{currentUser.username}</span>
          <ThemeButton darkMode={darkMode} toggleTheme={toggleTheme} />
          <button
            onClick={closeAdmin}
            className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className="p-5">
      {message && (
        <p
          className={`mb-4 rounded border p-3 ${
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}
      <SystemMonitor metrics={metrics} metricsError={metricsError} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Create shared folder">
          <form onSubmit={createFolder} className="space-y-3">
            <input
              required
              name="name"
              placeholder="Folder name (e.g. vod)"
              className="w-full rounded border p-2"
            />
            <input
              required
              name="quotaGb"
              type="number"
              min="0"
              step="0.1"
              placeholder="Quota in GB"
              className="w-full rounded border p-2"
            />
            <button className="flex items-center gap-2 rounded bg-sky-600 px-3 py-2 text-white">
              <Plus size={16} />
              Create folder
            </button>
          </form>
        </Panel>
        <Panel title="Create user">
          <form onSubmit={createUser} className="space-y-3">
            <input
              required
              name="username"
              placeholder="Username"
              className="w-full rounded border p-2"
            />
            <input
              required
              name="password"
              type="password"
              minLength="8"
              placeholder="Password (8+ characters)"
              className="w-full rounded border p-2"
            />
            <label className="flex gap-2 text-sm">
              <input name="isAdmin" type="checkbox" />
              Administrator
            </label>
            <button className="flex items-center gap-2 rounded bg-sky-600 px-3 py-2 text-white">
              <Users size={16} />
              Create user
            </button>
          </form>
        </Panel>
      </div>
      {false && <Panel title="System monitor" className="mt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${metrics ? "animate-pulse bg-emerald-500" : "bg-slate-400"}`} />
            {metrics ? "Live / container stats every 3s / host health every 5m" : metricsError || "Connecting to metrics..."}
          </span>
          {metrics?.timestamp && <span>Updated {new Date(metrics.timestamp).toLocaleTimeString()}</span>}
        </div>
        {metrics && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/40">
              <div className="mb-3 flex items-center justify-between text-sky-700 dark:text-sky-300"><span className="text-sm font-medium">CPU</span><Cpu size={18} /></div>
              <p className="text-2xl font-bold">{metrics.cpu.usagePercent.toFixed(1)}%</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{metrics.cpu.cores.toFixed(1)} cores limit · container scope</p>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/40">
              <div className="mb-3 flex items-center justify-between text-violet-700 dark:text-violet-300"><span className="text-sm font-medium">Memory</span><Activity size={18} /></div>
              <p className="text-2xl font-bold">{metrics.memory.usagePercent.toFixed(1)}%</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{bytes(metrics.memory.usedBytes)} of {bytes(metrics.memory.totalBytes)} · container scope</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
              <div className="mb-3 flex items-center justify-between text-emerald-700 dark:text-emerald-300"><span className="text-sm font-medium">Storage</span><HardDrive size={18} /></div>
              <p className="text-2xl font-bold">{metrics.storage.usagePercent.toFixed(1)}%</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{bytes(metrics.storage.usedBytes)} used / {bytes(metrics.storage.totalBytes)} total</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{bytes(metrics.storage.freeBytes)} remaining</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/40">
              <div className="mb-3 flex items-center justify-between text-orange-700 dark:text-orange-300"><span className="text-sm font-medium">Disk I/O</span><Activity size={18} /></div>
              <p className="text-lg font-bold">Read {metrics.diskIo.available ? throughput(metrics.diskIo.readBytesPerSecond) : "N/A"}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Write {metrics.diskIo.available ? throughput(metrics.diskIo.writeBytesPerSecond) : "N/A"} · container scope</p>
            </div>
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-900 dark:bg-cyan-950/40">
              <div className="mb-3 flex items-center justify-between text-cyan-700 dark:text-cyan-300"><span className="text-sm font-medium">Network</span><Network size={18} /></div>
              <p className="text-lg font-bold">Download {metrics.network.rxMbps.toFixed(2)} Mbps</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Upload {metrics.network.txMbps.toFixed(2)} Mbps</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <div className="mb-3 flex items-center justify-between text-amber-700 dark:text-amber-300"><span className="text-sm font-medium">Host health</span><HeartPulse size={18} /></div>
              <p className="text-lg font-bold">{metrics.temperature.celsius === null ? "N/A" : `${metrics.temperature.celsius.toFixed(1)} °C`}</p>
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={metrics.diskHealth.message}>{metrics.diskHealth.status === "healthy" ? "Disk SMART healthy" : metrics.diskHealth.status === "warning" ? "Disk SMART warning" : "Disk health unavailable"}</p>
            </div>
          </div>
        )}
        {metrics && (metrics.temperature.status === "unavailable" || metrics.diskHealth.status === "unavailable") && (
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Thermometer size={14} /> Temperature/SMART depends on sensors and host device access; unavailable values do not affect file storage.
          </p>
        )}
      </Panel>}
      <Panel title="User management" className="mt-5">
        {editingUser && (
          <form
            onSubmit={saveUser}
            className="mb-5 rounded-lg border border-sky-200 bg-sky-50 p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">
                  Edit user: {editingUser.username}
                </h3>
                <p className="text-xs text-slate-500">
                  Leave the password empty to keep the current password.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="rounded p-1 hover:bg-sky-100"
                aria-label="Cancel editing user"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
              <input
                required
                value={editingUser.username}
                onChange={(event) =>
                  setEditingUser((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                placeholder="Username"
                className="rounded border bg-white p-2"
              />
              <input
                value={editingUser.password}
                onChange={(event) =>
                  setEditingUser((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                type="password"
                minLength="8"
                placeholder="New password (optional, 8+ characters)"
                className="rounded border bg-white p-2"
              />
              <label className="flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={editingUser.isAdmin}
                  disabled={
                    editingUser.id === currentUser.id ||
                    (editingUser.originalIsAdmin &&
                      users.filter((user) => user.is_admin).length === 1)
                  }
                  onChange={(event) =>
                    setEditingUser((current) => ({
                      ...current,
                      isAdmin: event.target.checked,
                    }))
                  }
                />
                Administrator
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="submit"
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Save user
              </button>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="rounded border bg-white px-4 py-2 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="p-2">Username</th>
                <th className="p-2">Role</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isCurrentUser = user.id === currentUser.id;
                const isLastAdmin =
                  user.is_admin &&
                  users.filter((item) => item.is_admin).length === 1;
                const cannotDelete = isCurrentUser || isLastAdmin;
                return (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="p-2 font-medium">
                      {user.username}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          (you)
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          user.is_admin
                            ? "bg-violet-100 text-violet-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {user.is_admin ? "Administrator" : "User"}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => editUser(user)}
                          className="flex items-center gap-1 rounded border px-3 py-2 hover:bg-slate-50"
                        >
                          <Pencil size={15} />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteUser(user)}
                          disabled={cannotDelete}
                          title={
                            isCurrentUser
                              ? "You cannot delete the account currently in use."
                              : isLastAdmin
                                ? "SkyNest must retain at least one administrator."
                                : "Delete user"
                          }
                          className="flex items-center gap-1 rounded bg-red-600 px-3 py-2 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <Trash2 size={15} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
        <Panel title="Shared folders">
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => selectFolder(folder)}
              className={`mb-1 w-full rounded p-2 text-left ${selected?.id === folder.id ? "bg-sky-100" : "hover:bg-slate-100"}`}
            >
              <Folder className="mr-2 inline" size={16} />
              {folder.folder_name}
              <span className="float-right text-xs text-slate-500">
                {bytes(folder.quota_limit_bytes)}
              </span>
            </button>
          ))}
        </Panel>
        <Panel
          title={
            selected
              ? `Folder settings: ${selected.folder_name}`
              : "Select a shared folder"
          }
        >
          {selected && (
            <>
              <div className="mb-5 flex flex-wrap gap-2">
                <button
                  onClick={renameFolder}
                  className="rounded bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200"
                >
                  Rename
                </button>
                {!selected.parent_id && (
                  <button
                    onClick={changeQuota}
                    className="rounded bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200"
                  >
                    Set quota
                  </button>
                )}
                <button
                  onClick={deleteFolder}
                  className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
              {children.length > 0 && (
                <>
                  <h3 className="mb-2 font-semibold">Subfolders</h3>
                  <div className="mb-5 flex flex-wrap gap-2">
                    {children.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => selectFolder(folder)}
                        className="flex items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-sky-50"
                      >
                        <Folder size={16} />
                        {folder.folder_name}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Permissions</h3>
                  <p className="text-xs text-slate-500">
                    Changes are applied only after you press Save.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={cancelPermissionChanges}
                    disabled={!hasPermissionChanges}
                    className="rounded border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={savePermissions}
                    disabled={!hasPermissionChanges}
                    className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save changes
                  </button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">User</th>
                    <th>Read</th>
                    <th>Write</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {users
                    .filter((u) => !u.is_admin)
                    .map((user) => {
                      const p = draftPermissionFor(user);
                      return (
                        <tr key={user.id} className="border-b">
                          <td className="p-2">{user.username}</td>
                          {[
                            ["canRead", p.can_read],
                            ["canWrite", p.can_write],
                            ["canDelete", p.can_delete],
                          ].map(([field, checked]) => (
                            <td key={field}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  updatePermissionDraft(
                                    user,
                                    field,
                                    e.target.checked,
                                  )
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </>
          )}
        </Panel>
      </div>
      </div>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(() =>
    JSON.parse(localStorage.getItem("skynest") || "null"),
  );
  const [admin, setAdmin] = useState(() => {
    if (localStorage.getItem("skynest:admin") !== "1") return false;
    try {
      return Boolean(JSON.parse(localStorage.getItem("skynest") || "null")?.user?.isAdmin);
    } catch {
      return false;
    }
  });
  const [darkMode, setDarkMode] = useState(
    () =>
      localStorage.getItem("skynest:theme") === "dark" ||
      (!localStorage.getItem("skynest:theme") &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    localStorage.setItem("skynest:theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  const toggleTheme = () => setDarkMode((current) => !current);
  function login(data) {
    localStorage.setItem("skynest", JSON.stringify(data));
    localStorage.removeItem("skynest:admin");
    setSession(data);
  }
  if (!session)
    return (
      <Login
        onLogin={login}
        darkMode={darkMode}
        toggleTheme={toggleTheme}
      />
    );
  const closeAdmin = () => {
    localStorage.removeItem("skynest:admin");
    setAdmin(false);
  };
  if (admin)
    return (
      <Admin
        token={session.token}
        currentUser={session.user}
        onClose={closeAdmin}
        darkMode={darkMode}
        toggleTheme={toggleTheme}
      />
    );
  return (
    <Drive
      token={session.token}
      user={session.user}
      openAdmin={() => {
        localStorage.setItem("skynest:admin", "1");
        setAdmin(true);
      }}
      darkMode={darkMode}
      toggleTheme={toggleTheme}
    />
  );
}
