import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Cloud, Download, Folder, HardDrive, LogOut, MoreVertical, Pencil, Plus, Shield, Trash2, Upload, Users, X } from "lucide-react";

const api = axios.create({ baseURL: "/api" });
const bytes = (value = 0) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
};

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
  const [message, setMessage] = useState(""), [upload, setUpload] = useState(null), [menu, setMenu] = useState(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const refreshFolders = useCallback(async () => setFolders((await api.get("/folders", { headers })).data), [headers]);
  const refreshFiles = useCallback(async (folder = active) => {
    if (folder) setFileData((await api.get(`/folders/${folder.id}/files`, { headers })).data);
  }, [active, headers]);
  useEffect(() => { refreshFolders().catch(showError); }, [refreshFolders]);
  function showError(error) { setMessage(error.response?.data?.error || error.message || "Something went wrong."); }
  async function selectFolder(folder) { setActive(folder); setMenu(null); try { await refreshFiles(folder); } catch (e) { showError(e); } }
  async function uploadFile(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !active) return;
    // CancelToken is retained here because this is the requested Axios cancellation API.
    // The source is stored in state so the visible cancel button can abort this exact upload.
    const cancelSource = axios.CancelToken.source();
    setUpload({ name: file.name, progress: 0, cancelSource }); setMessage("");
    try {
      const form = new FormData(); form.append("file", file);
      await api.post(`/folders/${active.id}/upload`, form, { headers, cancelToken: cancelSource.token, onUploadProgress: e => setUpload(current => current && ({ ...current, progress: Math.round(e.loaded * 100 / e.total) })) });
      await refreshFiles(); setMessage("Upload complete.");
    } catch (e) { if (!axios.isCancel(e)) showError(e); else setMessage("Upload cancelled."); }
    finally { setUpload(null); }
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
    // A download link cannot attach our in-memory Authorization header. Fetching a blob keeps
    // the ACL check intact, then the browser is given a short-lived local download URL.
    try {
      const response = await api.get(`/folders/${active.id}/files/${encodeURIComponent(file.name)}/download`, { headers, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = Object.assign(document.createElement("a"), { href: url, download: file.name });
      link.click(); URL.revokeObjectURL(url);
    } catch (e) { showError(e); }
  }
  const percentage = fileData ? Math.min(100, fileData.usedBytes / fileData.quotaLimitBytes * 100 || 0) : 0;
  return <div className="min-h-screen">
    <header className="flex items-center justify-between bg-white px-5 py-3 shadow-sm"><div className="flex items-center gap-2 font-bold text-sky-700"><Cloud/> SkyNest</div><div className="flex items-center gap-3 text-sm"><span>{user.username}</span>{user.isAdmin && <button onClick={openAdmin} className="rounded bg-slate-100 p-2 hover:bg-slate-200" title="Administration"><Shield size={18}/></button>}<button onClick={() => { localStorage.removeItem("skynest"); location.reload(); }} title="Sign out"><LogOut size={19}/></button></div></header>
    <main className="mx-auto grid max-w-7xl gap-5 p-5 lg:grid-cols-[240px_1fr]">
      <aside className="rounded-xl bg-white p-4 shadow-sm"><h2 className="mb-3 font-semibold">Shared folders</h2>{folders.map(folder => <button key={folder.id} onClick={() => selectFolder(folder)} className={`mb-1 flex w-full items-center gap-2 rounded p-2 text-left ${active?.id === folder.id ? "bg-sky-100 text-sky-800" : "hover:bg-slate-100"}`}><Folder size={18}/>{folder.folder_name}</button>)}{!folders.length && <p className="text-sm text-slate-500">No folders are assigned to you.</p>}
        {active && fileData && <div className="mt-6 border-t pt-4 text-sm"><p className="font-medium">Folder {active.folder_name}</p><p className="mt-1 text-slate-500">{bytes(fileData.usedBytes)} of {bytes(fileData.quotaLimitBytes)} used</p><div className="mt-2 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-sky-600" style={{ width: `${percentage}%` }}/></div></div>}
      </aside>
      <section className="min-w-0 rounded-xl bg-white p-5 shadow-sm">{!active ? <div className="grid min-h-80 place-items-center text-slate-500"><div className="text-center"><Folder className="mx-auto mb-3" size={42}/><p>Select a shared folder.</p></div></div> : <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold">{active.folder_name}</h1><p className="text-sm text-slate-500">{fileData && `${fileData.files.length} file(s)`}</p></div>{fileData?.permissions.can_write && <label className="flex cursor-pointer items-center gap-2 rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"><Upload size={17}/> Upload<input className="hidden" type="file" onChange={uploadFile}/></label>}</div>
        {upload && <div className="mb-4 rounded bg-sky-50 p-3 text-sm"><div className="mb-2 flex justify-between"><span>Uploading {upload.name}: {upload.progress}%</span><button onClick={() => upload.cancelSource.cancel("User cancelled upload") } className="text-red-600">Cancel upload</button></div><div className="h-2 overflow-hidden rounded bg-sky-200"><div className="h-full bg-sky-600" style={{width: `${upload.progress}%`}}/></div></div>}
        {message && <p className="mb-3 rounded bg-slate-100 p-3 text-sm">{message}</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Size</th><th className="p-3">Modified</th><th/></tr></thead><tbody>{fileData?.files.map(file => <tr key={file.name} className="border-b hover:bg-slate-50"><td className="p-3 font-medium"><Folder className="mr-2 inline text-sky-500" size={16}/>{file.name}</td><td className="p-3">{bytes(file.size)}</td><td className="p-3">{new Date(file.modifiedAt).toLocaleString()}</td><td className="relative p-3"><button onClick={() => setMenu(menu === file.name ? null : file.name)}><MoreVertical size={18}/></button>{menu === file.name && <div className="absolute right-3 z-10 mt-1 w-32 rounded border bg-white py-1 shadow"><button className="flex w-full gap-2 px-3 py-2 hover:bg-slate-100" onClick={() => downloadFile(file)}><Download size={16}/>Download</button>{fileData.permissions.can_write && <button className="flex w-full gap-2 px-3 py-2 hover:bg-slate-100" onClick={() => renameFile(file)}><Pencil size={16}/>Rename</button>}{fileData.permissions.can_delete && <button className="flex w-full gap-2 px-3 py-2 text-red-600 hover:bg-slate-100" onClick={() => deleteFile(file)}><Trash2 size={16}/>Delete</button>}</div>}</td></tr>)}</tbody></table>{fileData?.files.length === 0 && <p className="py-12 text-center text-slate-500">This folder is empty.</p>}</div>
      </>}</section>
    </main>
  </div>;
}

function Admin({ token, onClose }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [users, setUsers] = useState([]), [folders, setFolders] = useState([]), [disk, setDisk] = useState(null), [selected, setSelected] = useState(null), [permissions, setPermissions] = useState([]), [message, setMessage] = useState("");
  const load = useCallback(async () => { const [u, f, d] = await Promise.all([api.get("/admin/users", {headers}), api.get("/folders", {headers}), api.get("/admin/disk", {headers})]); setUsers(u.data); setFolders(f.data); setDisk(d.data); }, [headers]);
  useEffect(() => { load().catch(e => setMessage(e.response?.data?.error || e.message)); }, [load]);
  async function selectFolder(folder) { setSelected(folder); setPermissions((await api.get(`/admin/folders/${folder.id}/permissions`, {headers})).data); }
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
  const permissionFor = user => permissions.find(p => p.user_id === user.id) || { can_read: false, can_write: false, can_delete: false };
  async function savePermission(user, field, checked) {
    const current = permissionFor(user); const next = { canRead: current.can_read, canWrite: current.can_write, canDelete: current.can_delete };
    next[field] = checked;
    // A write/delete choice necessarily needs read; keeping this client-side prevents an invalid request.
    if ((field === "canWrite" || field === "canDelete") && checked) next.canRead = true;
    try { await api.put(`/admin/folders/${selected.id}/permissions/${user.id}`, next, {headers}); await selectFolder(selected); } catch(e) { setMessage(e.response?.data?.error || e.message); }
  }
  const diskPercent = disk ? (disk.usedBytes / disk.totalBytes * 100) : 0;
  return <main className="mx-auto max-w-7xl p-5"><div className="mb-6 flex items-center justify-between"><h1 className="flex items-center gap-2 text-2xl font-bold"><Shield/> Administration</h1><button onClick={onClose} className="rounded p-2 hover:bg-slate-200"><X/></button></div>{message && <p className="mb-4 rounded bg-red-50 p-3 text-red-700">{message}</p>}
    <div className="grid gap-5 lg:grid-cols-3"><Panel title="Server disk status"><HardDrive className="mb-2 text-sky-600"/>{disk && <><p className="text-2xl font-bold">{bytes(disk.usedBytes)} <span className="text-sm font-normal text-slate-500">of {bytes(disk.totalBytes)}</span></p><div className="mt-3 h-3 overflow-hidden rounded bg-slate-200"><div className="h-full bg-sky-600" style={{width: `${diskPercent}%`}}/></div><p className="mt-2 text-sm text-slate-500">{bytes(disk.freeBytes)} free on the physical storage mount.</p></>}</Panel><Panel title="Create shared folder"><form onSubmit={createFolder} className="space-y-3"><input required name="name" placeholder="Folder name (e.g. vod)" className="w-full rounded border p-2"/><input required name="quotaGb" type="number" min="0" step="0.1" placeholder="Quota in GB" className="w-full rounded border p-2"/><button className="flex items-center gap-2 rounded bg-sky-600 px-3 py-2 text-white"><Plus size={16}/>Create folder</button></form></Panel><Panel title="Create user"><form onSubmit={createUser} className="space-y-3"><input required name="username" placeholder="Username" className="w-full rounded border p-2"/><input required name="password" type="password" minLength="8" placeholder="Password (8+ characters)" className="w-full rounded border p-2"/><label className="flex gap-2 text-sm"><input name="isAdmin" type="checkbox"/>Administrator</label><button className="flex items-center gap-2 rounded bg-sky-600 px-3 py-2 text-white"><Users size={16}/>Create user</button></form></Panel></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]"><Panel title="Shared folders">{folders.map(folder => <button key={folder.id} onClick={() => selectFolder(folder)} className={`mb-1 w-full rounded p-2 text-left ${selected?.id === folder.id ? "bg-sky-100" : "hover:bg-slate-100"}`}><Folder className="mr-2 inline" size={16}/>{folder.folder_name}<span className="float-right text-xs text-slate-500">{bytes(folder.quota_limit_bytes)}</span></button>)}</Panel><Panel title={selected ? `Permissions: ${selected.folder_name}` : "Select a shared folder"}>{selected && <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">User</th><th>Read</th><th>Write</th><th>Delete</th></tr></thead><tbody>{users.filter(u => !u.is_admin).map(user => { const p = permissionFor(user); return <tr key={user.id} className="border-b"><td className="p-2">{user.username}</td>{[["canRead", p.can_read], ["canWrite", p.can_write], ["canDelete", p.can_delete]].map(([field, checked]) => <td key={field}><input type="checkbox" checked={checked} onChange={e => savePermission(user, field, e.target.checked)}/></td>)}</tr>; })}</tbody></table>}</Panel></div>
  </main>;
}

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("skynest") || "null"));
  const [admin, setAdmin] = useState(false);
  function login(data) { localStorage.setItem("skynest", JSON.stringify(data)); setSession(data); }
  if (!session) return <Login onLogin={login}/>;
  return admin ? <Admin token={session.token} onClose={() => setAdmin(false)}/> : <Drive token={session.token} user={session.user} openAdmin={() => setAdmin(true)}/>;
}
