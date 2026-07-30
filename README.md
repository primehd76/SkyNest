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
   ```

2. Open `docker-compose.yml` and replace the example database password, JWT
   secret, and initial administrator password. Storage, CPU, and RAM limits
   are configured directly in this file. The default allocation is 1 TiB
   storage, 16 CPUs, and 32 GB RAM across the complete stack.

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
- Uploads enforce both the assigned root-folder quota and the global
  `STORAGE_LIMIT_BYTES` capacity.
- New upload names use `name (1).ext`, `name (2).ext`, and so on to avoid overwriting an existing file.
- The disk widget displays the configured SkyNest limit and also reports the
  physical capacity of the mounted filesystem.
- Uploads use resumable 8 MiB chunks and stage partial data under
  `/app/storage/.uploads`.

## Production considerations

Place the app behind HTTPS, use a unique long JWT secret, and configure
PostgreSQL backups. For a kernel-enforced hard filesystem limit, use a
dedicated 1 TiB partition/LVM logical volume or Linux project quotas; Docker
bind mounts do not provide their own filesystem quota.
