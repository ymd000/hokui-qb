CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  subject     TEXT NOT NULL,
  cohort      INTEGER NOT NULL,
  question    TEXT NOT NULL,
  choices     TEXT NOT NULL,
  answer      TEXT NOT NULL,
  explanation TEXT
);
