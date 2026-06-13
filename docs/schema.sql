-- =============================================================================
-- Atom Support Vision — Canonical PostgreSQL schema (reference / DDL).
-- This mirrors prisma/schema.prisma. Prisma migrations are the source of truth
-- at runtime; this file documents the physical design with indexes & constraints.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- Enums --------------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('ADMIN','AGENT','CUSTOMER');
CREATE TYPE session_status     AS ENUM ('SCHEDULED','WAITING','ACTIVE','ENDED','CANCELLED');
CREATE TYPE participant_role   AS ENUM ('AGENT','CUSTOMER','OBSERVER');
CREATE TYPE participant_status AS ENUM ('INVITED','CONNECTED','RECONNECTING','DISCONNECTED','LEFT');
CREATE TYPE recording_status   AS ENUM ('IDLE','RECORDING','PROCESSING','READY','FAILED');
CREATE TYPE message_type       AS ENUM ('TEXT','FILE','SYSTEM');
CREATE TYPE sentiment          AS ENUM ('POSITIVE','NEUTRAL','NEGATIVE','FRUSTRATED');

-- ---- Users / RBAC -------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  role          user_role NOT NULL DEFAULT 'AGENT',
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role  ON users(role);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE user_permissions (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_expires ON refresh_tokens(expires_at);

-- ---- Sessions -----------------------------------------------------------------
CREATE TABLE sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  status           session_status NOT NULL DEFAULT 'WAITING',
  agent_id         UUID NOT NULL REFERENCES users(id),
  customer_name    TEXT,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  quality_score    DOUBLE PRECISION,
  scheduled_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_agent   ON sessions(agent_id);
CREATE INDEX idx_sessions_status  ON sessions(status);
CREATE INDEX idx_sessions_created ON sessions(created_at);

CREATE TABLE invites (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invites_session ON invites(session_id);
CREATE INDEX idx_invites_expires ON invites(expires_at);

CREATE TABLE participants (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id         UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id            UUID REFERENCES users(id),
  display_name       TEXT NOT NULL,
  role               participant_role NOT NULL,
  status             participant_status NOT NULL DEFAULT 'INVITED',
  socket_id          TEXT,
  audio_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  video_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  screen_sharing     BOOLEAN NOT NULL DEFAULT FALSE,
  connection_quality TEXT,
  joined_at          TIMESTAMPTZ,
  left_at            TIMESTAMPTZ,
  duration_seconds   INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_participants_session ON participants(session_id);
CREATE INDEX idx_participants_user    ON participants(user_id);
CREATE INDEX idx_participants_status  ON participants(status);

-- ---- Chat & files -------------------------------------------------------------
CREATE TABLE shared_files (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  uploader_id   UUID REFERENCES users(id),
  uploader_name TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  storage_key   TEXT NOT NULL,
  checksum      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_session ON shared_files(session_id);

CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_id   UUID,
  sender_name TEXT NOT NULL,
  sender_role participant_role NOT NULL,
  type        message_type NOT NULL DEFAULT 'TEXT',
  body        TEXT NOT NULL,
  file_id     UUID REFERENCES shared_files(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_session ON messages(session_id);
CREATE INDEX idx_messages_created ON messages(created_at);

-- ---- Recordings ---------------------------------------------------------------
CREATE TABLE recordings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id       UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status           recording_status NOT NULL DEFAULT 'RECORDING',
  storage_key      TEXT,
  size_bytes       BIGINT,
  duration_seconds INTEGER,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recordings_session ON recordings(session_id);
CREATE INDEX idx_recordings_status  ON recordings(status);

-- ---- Events / Audit / Notifications / Metrics ---------------------------------
CREATE TABLE session_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  actor_name TEXT,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_session ON session_events(session_id);
CREATE INDEX idx_events_type    ON session_events(type);
CREATE INDEX idx_events_created ON session_events(created_at);

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  ip          TEXT,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor   ON audit_logs(actor_id);
CREATE INDEX idx_audit_action  ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'info',
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  link       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read);

CREATE TABLE metrics (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  labels     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_metrics_name    ON metrics(name);
CREATE INDEX idx_metrics_created ON metrics(created_at);

CREATE TABLE ai_insights (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id     UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  summary        TEXT,
  sentiment      sentiment NOT NULL DEFAULT 'NEUTRAL',
  issue_category TEXT,
  action_items   TEXT[] NOT NULL DEFAULT '{}',
  support_notes  TEXT,
  kb_suggestions JSONB,
  transcript     TEXT,
  quality_score  DOUBLE PRECISION,
  generated_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
