# SkyNest

SkyNest is a self-hosted shared-folder storage service. It combines a Google Drive-style browser UI with NAS-style folder ACLs: each user sees only assigned folders, and read, upload, and delete rights are separate.

## Architecture

- `backend/` — Express REST API, PostgreSQL ACL records, JWT authentication, filesystem storage.
- `frontend/` — React/Vite single-page app styled with Tailwind CSS.
- PostgreSQL holds users, shared folders, and permissions. File bytes never enter the database.
- The host directory `/media/DATA2TB/SkyNest` is mounted into the backend as `/app/storage`.

## Start with Docker

1. Create the storage directory on the Linux host and ensure Docker can write to it:

   ```bash
   sudo mkdir -p /media/DATA2TB/SkyNest
   sudo chown -R 1000:1000 /media/DATA2TB/SkyNest
   ```

2. Open `docker-compose.yml` and change all three example secrets before deployment:
   - `POSTGRES_PASSWORD`
   - the matching password in `DATABASE_URL`
   - `JWT_SECRET` and `INITIAL_ADMIN_PASSWORD`

3. Start the application:

   ```bash
   docker compose up --build -d
   ```

4. Visit `http://your-server:8080` and sign in with `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD`. The configured initial administrator is created only once, when the database contains no users.

## Administrator workflow

1. Sign in as an administrator and click the shield icon.
2. Create users and shared folders. A quota is entered in GB and saved as bytes.
3. Select a shared folder and set read/write/delete checkboxes per non-admin user.
4. Users can now see only folders with read access. Administrators always have full access to all folders.

## Security and behavior notes

- Passwords use bcrypt; API sessions use eight-hour signed JWTs.
- Every folder operation resolves both the user ACL and physical folder safely on the backend. The UI is convenience only; it is not the security boundary.
- Uploads calculate recursive physical folder size immediately before writing. If the new size would exceed the folder quota, the API rejects it.
- New upload names use `name (1).ext`, `name (2).ext`, and so on to avoid overwriting an existing file.
- The disk widget uses `fs.promises.statfs('/app/storage')`, so it reports the actual mounted storage filesystem rather than the container filesystem.
- Upload cancellation uses Axios `CancelToken`. The browser stops sending the request; no file is written until the complete request passes quota checks.

## Production considerations

The included Multer memory storage makes the pre-write quota example clear and ensures no partial shared-storage files. For multi-gigabyte production uploads, implement a streamed temporary upload area and atomically move a verified file into the shared folder. Place the app behind HTTPS, use a unique long JWT secret, and configure PostgreSQL backups.
