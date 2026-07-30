import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { ChevronRight, Cloud, Download, File, FileArchive, FileAudio, FileCode2, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, FolderPlus, HardDrive, LogOut, MoreVertical, Pencil, Plus, Shield, Trash2, Upload, Users, X } from "lucide-react";

const api = axios.create({ baseURL: "/api" });
const bytes = (value = 0) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
};

function FileTypeIcon({ name, size = 18 }) {
  const extension = name.split(".").pop()?.toLowerCase();
  const props = { size, className: "shrink-0 text-slate-500" };
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension)) return <FileImage {...props} className="shrink-0 text-violet-500"/>;
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(extension)) return <FileVideo {...props} className="shrink-0 text-rose-500"/>;
  if (["mp3", "wav", "flac", "m4a", "ogg"].includes(extension)) return <FileAudio {...props} className="shrink-0 text-pink-500"/>;
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return <FileArchive {...props} className="shrink-0 text-amber-600"/>;
  if (["xls", "xlsx", "csv"].includes(extension)) return <FileSpreadsheet {...props} className="shrink-0 text-emerald-600"/>;
  if (["js", "jsx", "ts", "tsx", "json", "html", "css", "py", "java"].includes(extension)) return <FileCode2 {...props} className="shrink-0 text-sky-600"/>;
  if (["pdf", "doc", "docx", "txt", "md"].includes(extension)) return <FileText {...props} className="shrink-0 text-blue-600"/>;
  return <File {...props}/>;
}

function Panel({ title, children, className = "" }) {
  return <section className={`rounded-xl bg-white p-5 shadow-sm ${className}`}><h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}</section>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError("");
    try { const { data } = await api.post("/auth/login", { username, password }); onLogin(data); }
    catch (e) { setError(e.response?.data?.error || "Could not sign in."); }
  }
  return <main className="grid min-h-screen place-items-center p-5"><form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
    <div className="mb-7 flex items-center gap-3 text-sky-700"><Cloud size={36}/><span className="text-2xl font-bold">SkyNest</span></div>
    <p className="mb-5 text-sm text-slate-500">Your private shared storage.</p>
    <label className="block text-sm font-medium">Username<input className="mt-1 w-full rounded border p-2" value={username} onChange={e => setUsername(e.target.value)} required /></label>
    <label className="mt-4 block text-sm font-medium">Password<input type="password" className="mt-1 w-full rounded border p-2" value={password} onChange={e => setPassword(e.target.value)} required /></label>
    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    <button className="mt-6 w-full rounded bg-sky-600 py-2 font-medium text-white hover:bg-sky-700">Sign in</button>
  </form></main>;
}

function Drive({ token, user, openAdmin }) {
  const [folders, setFolders] = useState([]), [active, setActive] = useState(null), [fileData, setFileData] = useState(null);
  const [message, setMessage] = useState(""), [upload, setUpload] = useState(null), [menu, setMenu] = useState(null), [folderMenu, setFolderMenu] = useState(null), [trail, setTrail] = useState([]);
  const activeRef = useRef(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const refreshFolders = useCallback(async () => setFolders((await api.get("/folders", { headers })).data), [headers]);
  const refreshFiles = useCallback(async (folder = active) => {
    if (folder) setFileData((await api.get(`/folders/${folder.id}/files`, { headers })).data);
  }, [active, headers]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { refreshFolders().catch(showError); }, [refreshFolders]);
  useEffect(() => {
    const restoreFolder = folderId => {
      if (!folderId) { goHome(false); return; }
      api.get(`/folders/${folderId}`, { headers }).then(({ data }) => {
        setActive(data.folder); setTrail(data.trail); return refreshFiles(data.folder);
      }).catch(() => { localStorage.removeItem("skynest:lastFolderId"); goHome(false); });
    };
    const current = new URLSearchParams(window.location.search).get("folder") || localStorage.getItem("skynest:lastFolderId");
    restoreFolder(current);
    const onPopState = () => restoreFolder(new URLSearchParams(window.location.search).get("folder"));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [headers]);
  function showError(error) { setMessage(error.response?.data?.error || error.message || "Something went wrong."); }
  async function selectFolder(folder, nextTrail = [folder], pushHistory = true) { setActive(folder); setMenu(null); setFolderMenu(null); setTrail(nextTrail); localStorage.setItem("skynest:lastFolderId", String(folder.id)); if (pushHistory) window.history.pushState({ folderId: folder.id }, "", `${window.location.pathname}?folder=${folder.id}`); try { await refreshFiles(folder); } catch (e) { showError(e); } }
  function goHome(pushHistory = true) { setActive(null); setFileData(null); setTrail([]); setMenu(null); setFolderMenu(null); setMessage(""); localStorage.removeItem("skynest:lastFolderId"); if (pushHistory) window.history.pushState({}, "", window.location.pathname); }
  async function createSubfolder() {
    if (!active) return;
    const folderName = prompt("Folder name"); if (!folderName) return;
    try { await api.post(`/folders/${active.id}/subfolders`, { folderName }, { headers }); await refreshFiles(active); setMessage("Folder created."); }
    catch (e) { showError(e); }
  }
  async function renameFolder(folder) {
    const folderName = prompt("New folder name", folder.folder_name); if (!folderName || folderName === folder.folder_name) return;
    try {
      await api.patch(`/admin/folders/${folder.id}`, { folderName, quotaLimitBytes: Number(folder.quota_limit_bytes) }, { headers });
      setFolderMenu(null); await refreshFolders(); if (active) await refreshFiles(active);
    } catch (e) { showError(e); }
  }
  async function setFolderQuota(folder) {
    const value = prompt("New quota in GB", (Number(folder.quota_limit_bytes) / 1024 ** 3).toString()); if (value === null) return;
    const quotaLimitBytes = Math.round(Number(value) * 1024 ** 3);
    if (!Number.isSafeInteger(quotaLimitBytes) || quotaLimitBytes < 0) return setMessage("Quota must be a non-negative number of GB.");
    try {
      await api.patch(`/admin/folders/${folder.id}`, { folderName: folder.folder_name, quotaLimitBytes }, { headers });
      setFolderMenu(null); await refreshFolders(); if (active) await refreshFiles(active);
    } catch (e) { showError(e); }
  }
  async function deleteFolder(folder) {
    if (!confirm(`Delete empty folder ${folder.folder_name}?`)) return;
    try { await api.delete(`/admin/folders/${folder.id}`, { headers }); setFolderMenu(null); await refreshFolders(); if (active) await refreshFiles(active); }
    catch (e) { showError(e); }
  }
  async function uploadFile(event) {
    const files = Array.from(event.target.files || []); event.target.value = "";
    if (!files.length || !active) return;
    // CancelToken is retained here because this is the requested Axios cancellation API.
    // The source is stored in state so the visible cancel button can abort this exact upload.
    const targetFolder = active;
    let completed = true;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index], cancelSource = axios.CancelToken.source();
      setUpload({ name: file.webkitRelativePath || file.name, progress: null, cancelSource, index: index + 1, total: files.length }); setMessage("");
      try {
        const form = new FormData(); form.append("relativePath", file.webkitRelativePath || file.name); form.append("file", file);
        await api.post(`/folders/${targetFolder.id}/upload`, form, { headers, cancelToken: cancelSource.token, onUploadProgress: e => setUpload(current => current && ({ ...current, progress: e.total ? Math.min(100, Math.round(e.loaded * 100 / e.total)) : current.progress })) });
      } catch (e) { completed = false; if (!axios.isCancel(e)) showError(e); else setMessage("Upload cancelled."); break; }
    }
    if (activeRef.current?.id === targetFolder.id) await refreshFiles(targetFolder);
    setUpload(null); if (completed) setMessage("Upload complete.");
  }
  async function renameFile(file) {
    const name = prompt("New file name", file.name); if (!name || name === file.name) return;
    try { await api.patch(`/folders/${active.id}/files/${encodeURIComponent(file.name)}`, { name }, { headers }); await refreshFiles(); }
    catch (e) { showError(e); }
  }
  async function deleteFile(file) {
    if (!confirm(`Delete ${file.name}? This cannot be undone.`)) return;
    try { await api.delete(`/folders/${active.id}/files/${encodeURIComponent(file.name)}`, { headers }); await refreshFiles(); }
    catch (e) { showError(e); }
  }
  async function downloadFile(file) {
    try {
      const { data } = await api.post(`/folders/${active.id}/files/${encodeURIComponent(file.name)}/download-ticket`, {}, { headers });
      const link = Object.assign(document.createElement("a"), { href: data.url, download: file.name });
      document.body.appendChild(link); link.click(); link.remove();
    } catch (e) { showError(e); }
  }
  const percentage = fileData ? Math.min(100, fileData.usedBytes / fileData.quotaLimitBytes * 100 || 0) : 0;
  return <div className="min-h-screen">{(menu || folderMenu) && <button aria-label="Close menu" onClick={() => { setMenu(null); setFolderMenu(null); }} className="fixed inset-0 z-10 cursor-default"/>}
    <header className="flex items-center justify-between bg-white px-5 py-3 shadow-sm"><button onClick={goHome} className="flex items-center gap-2 font-bold text-sky-700" title="Back to main page"><Cloud/> SkyNest</button><div className="flex items-center gap-3 text-sm"><span>{user.username}</span>{user.isAdmin && <button onClick={openAdmin} className="rounded bg-slate-100 p-2 hover:bg-slate-200" title="Administration"><Shield size={18}/></button>}<button onClick={() => { localStorage.removeItem("skynest"); location.reload(); }} title="Sign out"><LogOut size={19}/></button></div></header>
    <main className="grid min-h-[calc(100vh-65px)] w-full gap-5 p-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="min-h-[calc(100vh-105px)] rounded-xl bg-white p-4 shadow-sm"><h2 className="mb-3 font-semibold">Shared folders</h2>{folders.map(folder => <button key={folder.id} onClick={() => selectFolder(folder, [folder])} className={`mb-1 flex w-full items-center gap-2 rounded p-2 text-left ${active?.id === folder.id ? "bg-sky-100 text-sky-800" : "hover:bg-slate-100"}`}><Folder size={18}/>{folder.folder_name}</button>)}{!folders.length && <p className="text-sm text-slate-500">No folders are assigned to you.</p>}
        {active && fileData && <div className="mt-6 border-t pt-4 text-sm"><p className="font-medium">Folder {active.folder_name}</p><p className="mt-1 text-slate-500">{bytes(fileData.usedBytes)} of {bytes(fileData.quotaLimitBytes)} used</p><div className="mt-2 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-sky-600" style={{ width: `${percentage}%` }}/></div></div>}
      </aside>
      <section className="min-w-0 min-h-[calc(100vh-105px)] rounded-xl bg-white p-5 shadow-sm">{!active ? <div className="grid min-h-80 place-items-center text-slate-500"><div className="text-center"><Folder className="mx-auto mb-3" size={42}/><p>Select a shared folder.</p></div></div> : <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><div className="mb-1 flex flex-wrap items-center gap-1 text-sm text-slate-500">{trail.map((folder, index) => <button key={folder.id} onClick={() => selectFolder(folder, trail.slice(0, index + 1))} className="flex items-center hover:text-sky-700">{index > 0 && <ChevronRight size={15}/>} {folder.folder_name}</button>)}</div><h1 className="text-xl font-bold">{active.folder_name}</h1><p className="text-sm text-slate-500">{fileData && `${fileData.files.length} file(s)`}</p></div>{fileData?.permissions.can_write && <div className="flex gap-2"><button onClick={createSubfolder} className="flex items-center gap-2 rounded bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200"><FolderPlus size={17}/>New folder</button><label className="flex cursor-pointer items-center gap-2 rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"><Upload size={17}/> Upload<input className="hidden" type="file" onChange={uploadFile}/></label></div>}</div>
        {message && <p className="mb-3 rounded bg-slate-100 p-3 text-sm">{message}</p>}
        {fileData?.permissions.can_write && <label className="mb-4 inline-flex cursor-pointer items-center gap-2 rounded bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200"><FolderPlus size={17}/>Upload folder<input className="hidden" type="file" webkitdirectory="" directory="" multiple onChange={uploadFile}/></label>}
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{fileData?.folders.map(folder => <div key={folder.id} className="relative flex items-center rounded-lg border hover:bg-sky-50"><button onClick={() => selectFolder(folder, [...trail, folder])} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"><Folder className="shrink-0 text-sky-600"/><span className="truncate font-medium">{folder.folder_name}</span></button><button onClick={() => setFolderMenu(folderMenu === folder.id ? null : folder.id)} className="mr-2 rounded p-2 hover:bg-slate-200" title="Folder actions"><MoreVertical size={18}/></button>{folderMenu === folder.id && <div className="absolute right-2 top-11 z-20 w-48 rounded border bg-white py-1 shadow-lg"><button onClick={() => selectFolder(folder, [...trail, folder])} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100"><Folder size={16}/>Open</button>{user.isAdmin && <><button onClick={() => renameFolder(folder)} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100"><Pencil size={16}/>Rename</button>{!folder.parent_id && <button onClick={() => setFolderQuota(folder)} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100"><HardDrive size={16}/>Set quota</button>}<button onClick={openAdmin} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-slate-100"><Users size={16}/>Manage access</button><button onClick={() => deleteFolder(folder)} className="flex w-full gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"><Trash2 size={16}/>Delete empty folder</button></>}</div>}</div>)}</div><div className="overflow-visible"><table className="w-full text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Size</th><th className="p-3">Modified</th><th/></tr></thead><tbody>{fileData?.files.map(file => <tr key={file.name} className="border-b hover:bg-slate-50"><td className="p-3 font-medium"><span className="flex items-center gap-2"><FileTypeIcon name={file.name}/>{file.name}</span></td><td className="p-3">{bytes(file.size)}</td><td className="p-3">{new Date(file.modifiedAt).toLocaleString()}</td><td className="relative p-3"><button onClick={() => setMenu(menu === file.name ? null : file.name)}><MoreVertical size={18}/></button>{menu === file.name && <div className="absolute right-3 z-30 mt-1 w-40 rounded border bg-white py-1 shadow-lg"><button className="flex w-full gap-2 px-3 py-2 hover:bg-slate-100" onClick={() => downloadFile(file)}><Download size={16}/>Download</button>{fileData.permissions.can_write && <button className="flex w-full gap-2 px-3 py-2 hover:bg-slate-100" onClick={() => renameFile(file)}><Pencil size={16}/>Rename</button>}{fileData.permissions.can_delete && <button className="flex w-full gap-2 px-3 py-2 text-red-600 hover:bg-red-50" onClick={() => deleteFile(file)}><Trash2 size={16}/>Delete</button>}</div>}</td></tr>)}</tbody></table>{fileData?.files.length === 0 && fileData?.folders.length === 0 && <p className="py-12 text-center text-slate-500">This folder is empty.</p>}</div>
      </>}</section>
    </main>{upload && <aside className="fixed bottom-5 right-5 z-20 w-80 rounded-lg bg-white p-4 shadow-xl ring-1 ring-slate-200"><div className="mb-2 flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="truncate">Uploading {upload.name}</p><p className="mt-1 text-slate-500">{upload.progress === null ? "Preparing upload…" : `${upload.progress}% complete`}</p></div><button onClick={() => upload.cancelSource.cancel("User cancelled upload")} className="shrink-0 text-red-600">Cancel</button></div><div className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-sky-600" style={{width: `${upload.progress ?? 0}%`}}/></div></aside>}
  </div>;
}

function Admin({ token, onClose }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [users, setUsers] = useState([]), [folders, setFolders] = useState([]), [children, setChildren] = useState([]), [disk, setDisk] = useState(null), [selected, setSelected] = useState(null), [permissions, setPermissions] = useState([]), [message, setMessage] = useState("");
  const load = useCallback(async () => { const [u, f, d] = await Promise.all([api.get("/admin/users", {headers}), api.get("/folders", {headers}), api.get("/admin/disk", {headers})]); setUsers(u.data); setFolders(f.data); setDisk(d.data); }, [headers]);
  useEffect(() => { load().catch(e => setMessage(e.response?.data?.error || e.message)); }, [load]);
  async function selectFolder(folder) {
    setSelected(folder);
    const [permissionResponse, childResponse] = await Promise.all([api.get(`/admin/folders/${folder.id}/permissions`, {headers}), api.get(`/folders?parentId=${folder.id}`, {headers})]);
    setPermissions(permissionResponse.data); setChildren(childResponse.data);
  }
  async function createUser(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.post("/admin/users", { username: form.get("username"), password: form.get("password"), isAdmin: form.get("isAdmin") === "on" }, {headers});
      formElement.reset();
      await load();
    } catch (e) { setMessage(e.response?.data?.error || e.message); }
  }
  async function createFolder(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api.post("/admin/folders", { folderName: form.get("name"), quotaLimitBytes: Number(form.get("quotaGb")) * 1024 ** 3 }, {headers});
      formElement.reset();
      await load();
    } catch (e) { setMessage(e.response?.data?.error || e.message); }
  }
  async function renameFolder() {
    if (!selected) return;
    const folderName = prompt("New folder name", selected.folder_name);
    if (!folderName || folderName === selected.folder_name) return;
    try {
      const { data } = await api.patch(`/admin/folders/${selected.id}`, { folderName, quotaLimitBytes: Number(selected.quota_limit_bytes) }, { headers });
      setSelected(data); await load(); setMessage("Folder renamed.");
    } catch (e) { setMessage(e.response?.data?.error || e.message); }
  }
  async function changeQuota() {
    if (!selected) return;
    const value = prompt("New quota in GB", (Number(selected.quota_limit_bytes) / 1024 ** 3).toString());
    if (value === null) return;
    const quotaLimitBytes = Math.round(Number(value) * 1024 ** 3);
    if (!Number.isSafeInteger(quotaLimitBytes) || quotaLimitBytes < 0) return setMessage("Quota must be a non-negative number of GB.");
    try {
      const { data } = await api.patch(`/admin/folders/${selected.id}`, { folderName: selected.folder_name, quotaLimitBytes }, { headers });
      setSelected(data); await load(); setMessage("Folder quota updated.");
    } catch (e) { setMessage(e.response?.data?.error || e.message); }
  }
  async function deleteFolder() {
    if (!selected || !confirm(`Delete folder ${selected.folder_name}? It must be empty and this cannot be undone.`)) return;
    try {
      await api.delete(`/admin/folders/${selected.id}`, { headers });
      setSelected(null); setPermissions([]); setChildren([]); await load(); setMessage("Folder deleted.");
    } catch (e) { setMessage(e.response?.data?.error || e.message); }
  }
  const permissionFor = user => permissions.find(p => p.user_id === user.id) || { can_read: false, can_write: false, can_delete: false };
  async function savePermission(user, field, checked) {
    const current = permissionFor(user); const next = { canRead: current.can_read, canWrite: current.can_write, canDelete: current.can_delete };
    next[field] = checked;
    // A write/delete choice necessarily needs read; keeping this client-side prevents an invalid request.
    if ((field === "canWrite" || field === "canDelete") && checked) next.canRead = true;
    try { await api.put(`/admin/folders/${selected.id}/permissions/${user.id}`, next, {headers}); await selectFolder(selected); } catch(e) { setMessage(e.response?.data?.error || e.message); }
  }
  const diskPercent = disk ? (disk.usedBytes / disk.totalBytes * 100) : 0;
  return <main className="w-full p-5"><div className="mb-6 flex items-center justify-between"><h1 className="flex items-center gap-2 text-2xl font-bold"><Shield/> Administration</h1><button onClick={onClose} className="rounded p-2 hover:bg-slate-200"><X/></button></div>{message && <p className="mb-4 rounded bg-red-50 p-3 text-red-700">{message}</p>}
    <div className="grid gap-5 lg:grid-cols-3"><Panel title="Server disk status"><HardDrive className="mb-2 text-sky-600"/>{disk && <><p className="text-2xl font-bold">{bytes(disk.usedBytes)} <span className="text-sm font-normal text-slate-500">of {bytes(disk.totalBytes)}</span></p><div className="mt-3 h-3 overflow-hidden rounded bg-slate-200"><div className="h-full bg-sky-600" style={{width: `${diskPercent}%`}}/></div><p className="mt-2 text-sm text-slate-500">{bytes(disk.freeBytes)} free on the physical storage mount.</p></>}</Panel><Panel title="Create shared folder"><form onSubmit={createFolder} className="space-y-3"><input required name="name" placeholder="Folder name (e.g. vod)" className="w-full rounded border p-2"/><input required name="quotaGb" type="number" min="0" step="0.1" placeholder="Quota in GB" className="w-full rounded border p-2"/><button className="flex items-center gap-2 rounded bg-sky-600 px-3 py-2 text-white"><Plus size={16}/>Create folder</button></form></Panel><Panel title="Create user"><form onSubmit={createUser} className="space-y-3"><input required name="username" placeholder="Username" className="w-full rounded border p-2"/><input required name="password" type="password" minLength="8" placeholder="Password (8+ characters)" className="w-full rounded border p-2"/><label className="flex gap-2 text-sm"><input name="isAdmin" type="checkbox"/>Administrator</label><button className="flex items-center gap-2 rounded bg-sky-600 px-3 py-2 text-white"><Users size={16}/>Create user</button></form></Panel></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]"><Panel title="Shared folders">{folders.map(folder => <button key={folder.id} onClick={() => selectFolder(folder)} className={`mb-1 w-full rounded p-2 text-left ${selected?.id === folder.id ? "bg-sky-100" : "hover:bg-slate-100"}`}><Folder className="mr-2 inline" size={16}/>{folder.folder_name}<span className="float-right text-xs text-slate-500">{bytes(folder.quota_limit_bytes)}</span></button>)}</Panel><Panel title={selected ? `Folder settings: ${selected.folder_name}` : "Select a shared folder"}>{selected && <><div className="mb-5 flex flex-wrap gap-2"><button onClick={renameFolder} className="rounded bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">Rename</button>{!selected.parent_id && <button onClick={changeQuota} className="rounded bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200">Set quota</button>}<button onClick={deleteFolder} className="rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">Delete empty folder</button></div>{children.length > 0 && <><h3 className="mb-2 font-semibold">Subfolders</h3><div className="mb-5 flex flex-wrap gap-2">{children.map(folder => <button key={folder.id} onClick={() => selectFolder(folder)} className="flex items-center gap-2 rounded border px-3 py-2 text-sm hover:bg-sky-50"><Folder size={16}/>{folder.folder_name}</button>)}</div></>}<h3 className="mb-2 font-semibold">Permissions</h3><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">User</th><th>Read</th><th>Write</th><th>Delete</th></tr></thead><tbody>{users.filter(u => !u.is_admin).map(user => { const p = permissionFor(user); return <tr key={user.id} className="border-b"><td className="p-2">{user.username}</td>{[["canRead", p.can_read], ["canWrite", p.can_write], ["canDelete", p.can_delete]].map(([field, checked]) => <td key={field}><input type="checkbox" checked={checked} onChange={e => savePermission(user, field, e.target.checked)}/></td>)}</tr>; })}</tbody></table></>}</Panel></div>
  </main>;
}

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("skynest") || "null"));
  const [admin, setAdmin] = useState(false);
  function login(data) { localStorage.setItem("skynest", JSON.stringify(data)); setSession(data); }
  if (!session) return <Login onLogin={login}/>;
  return admin ? <Admin token={session.token} onClose={() => setAdmin(false)}/> : <Drive token={session.token} user={session.user} openAdmin={() => setAdmin(true)}/>;
}
