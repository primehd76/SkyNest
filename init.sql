CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE shared_folders (
  id SERIAL PRIMARY KEY,
  folder_name VARCHAR(120) NOT NULL UNIQUE,
  quota_limit_bytes BIGINT NOT NULL CHECK (quota_limit_bytes >= 0)
);

CREATE TABLE folder_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
  can_read BOOLEAN NOT NULL DEFAULT TRUE,
  can_write BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, folder_id),
  CHECK (can_write = FALSE OR can_read = TRUE),
  CHECK (can_delete = FALSE OR can_read = TRUE)
);
