CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  subject     TEXT NOT NULL,
  cohort      INTEGER NOT NULL,
  question    TEXT NOT NULL,
  explanation TEXT
);

CREATE TABLE IF NOT EXISTS choices (
  id          INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_correct  INTEGER NOT NULL CHECK(is_correct IN (0,1)),
  position    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  comment     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
