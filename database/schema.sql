SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS corpus_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_corpus_owner (owner_id, updated_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(40) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(60) NOT NULL,
  display_name VARCHAR(60) NULL,
  username_key VARCHAR(60) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  password_salt CHAR(32) NOT NULL,
  password_hash CHAR(64) NOT NULL,
  starter_initialized TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_users_username_key (username_key),
  KEY idx_users_status_role (status, role)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NULL,
  role ENUM('admin','user') NOT NULL,
  display_name VARCHAR(60) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user_expires (user_id, expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_documents (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NULL,
  mime_type VARCHAR(120) NULL,
  byte_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sha256 CHAR(64) NULL,
  source_type ENUM('upload','official','open-data','authored','generated') NOT NULL DEFAULT 'upload',
  source_url VARCHAR(1000) NULL,
  license_code VARCHAR(120) NULL,
  attribution TEXT NULL,
  status ENUM('uploaded','processing','review','published','failed','deleted') NOT NULL DEFAULT 'uploaded',
  extracted_text MEDIUMTEXT NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_documents_owner_status (owner_id, status),
  KEY idx_documents_sha256 (sha256),
  CONSTRAINT fk_documents_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS processing_jobs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NULL,
  document_id CHAR(36) NULL,
  job_type ENUM('extract','generate','translate','export','vocabulary-import') NOT NULL,
  status ENUM('queued','running','review','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  input_json JSON NULL,
  result_json JSON NULL,
  error_text TEXT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL,
  locked_at DATETIME(3) NULL,
  locked_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_jobs_claim (status, available_at, locked_at),
  KEY idx_jobs_owner_created (owner_id, created_at),
  CONSTRAINT fk_jobs_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_jobs_document FOREIGN KEY (document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS question_banks (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NULL,
  title VARCHAR(200) NOT NULL,
  category_name VARCHAR(100) NOT NULL DEFAULT '',
  track VARCHAR(30) NOT NULL DEFAULT 'general',
  module_code VARCHAR(60) NOT NULL DEFAULT 'general',
  course_name VARCHAR(120) NULL,
  unit_name VARCHAR(120) NULL,
  exam_year VARCHAR(20) NULL,
  difficulty VARCHAR(30) NOT NULL DEFAULT 'mixed',
  visibility ENUM('public','private') NOT NULL DEFAULT 'public',
  status ENUM('draft','review','published','archived') NOT NULL DEFAULT 'published',
  source_document_id CHAR(36) NULL,
  source_name VARCHAR(255) NULL,
  source_text MEDIUMTEXT NULL,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_banks_track_module_status (track, module_code, status),
  KEY idx_banks_owner_visibility (owner_id, visibility),
  CONSTRAINT fk_banks_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_banks_document FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE SET NULL
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS questions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  bank_id CHAR(36) NOT NULL,
  position_no INT UNSIGNED NOT NULL,
  type ENUM('boolean','choice','multiple','fill','short') NOT NULL,
  prompt TEXT NOT NULL,
  options_json JSON NULL,
  answer_json JSON NOT NULL,
  blanks_json JSON NULL,
  rubric TEXT NULL,
  explanation TEXT NULL,
  points DECIMAL(8,3) NOT NULL DEFAULT 1,
  group_id VARCHAR(80) NULL,
  material_title VARCHAR(255) NULL,
  material_text MEDIUMTEXT NULL,
  review_status ENUM('draft','needs-review','approved','rejected') NOT NULL DEFAULT 'approved',
  generated_by VARCHAR(120) NULL,
  source_locator VARCHAR(255) NULL,
  extra_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_questions_bank_position (bank_id, position_no),
  KEY idx_questions_bank_type_review (bank_id, type, review_status),
  CONSTRAINT fk_questions_bank FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exams (
  id CHAR(36) NOT NULL PRIMARY KEY,
  bank_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  candidate_name VARCHAR(60) NOT NULL,
  title VARCHAR(255) NOT NULL,
  track VARCHAR(30) NOT NULL DEFAULT 'general',
  module_code VARCHAR(60) NOT NULL DEFAULT 'general',
  blueprint_json JSON NULL,
  draft_answers_json JSON NULL,
  started_at DATETIME(3) NOT NULL,
  submitted_at DATETIME(3) NULL,
  KEY idx_exams_user_active (user_id, submitted_at),
  KEY idx_exams_bank_user (bank_id, user_id),
  CONSTRAINT fk_exams_bank FOREIGN KEY (bank_id) REFERENCES question_banks(id) ON DELETE SET NULL,
  CONSTRAINT fk_exams_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exam_items (
  id CHAR(36) NOT NULL PRIMARY KEY,
  exam_id CHAR(36) NOT NULL,
  position_no INT UNSIGNED NOT NULL,
  source_question_id CHAR(36) NULL,
  question_snapshot_json JSON NOT NULL,
  UNIQUE KEY uq_exam_items_position (exam_id, position_no),
  CONSTRAINT fk_exam_items_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attempts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  exam_id CHAR(36) NOT NULL,
  bank_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  candidate_name VARCHAR(60) NOT NULL,
  track VARCHAR(30) NOT NULL DEFAULT 'general',
  score DECIMAL(10,3) NOT NULL,
  max_score DECIMAL(10,3) NOT NULL,
  answers_json JSON NOT NULL,
  results_json JSON NOT NULL,
  questions_json JSON NOT NULL,
  submitted_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_attempts_exam (exam_id),
  KEY idx_attempts_user_submitted (user_id, submitted_at),
  KEY idx_attempts_bank_submitted (bank_id, submitted_at),
  CONSTRAINT fk_attempts_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vocabulary_entries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NULL,
  zh VARCHAR(500) NOT NULL,
  en VARCHAR(500) NULL,
  normalized_zh VARCHAR(500) NOT NULL,
  normalized_en VARCHAR(500) NULL,
  track VARCHAR(30) NOT NULL DEFAULT 'general',
  part_of_speech VARCHAR(80) NULL,
  pronunciation VARCHAR(255) NULL,
  meanings_json JSON NULL,
  accepted_json JSON NULL,
  examples_json JSON NULL,
  chapter_name VARCHAR(120) NULL,
  difficulty TINYINT UNSIGNED NOT NULL DEFAULT 1,
  frequency_rank INT UNSIGNED NULL,
  tags_json JSON NULL,
  source_name VARCHAR(255) NULL,
  source_url VARCHAR(1000) NULL,
  license_code VARCHAR(120) NULL,
  attribution TEXT NULL,
  review_status ENUM('draft','needs-review','approved','rejected') NOT NULL DEFAULT 'needs-review',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_vocab_track_rank (track, frequency_rank),
  KEY idx_vocab_zh (normalized_zh(120)),
  KEY idx_vocab_en (normalized_en(120))
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS word_collections (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  track VARCHAR(30) NOT NULL DEFAULT 'general',
  created_at DATETIME(3) NOT NULL,
  KEY idx_collections_user_track (user_id, track),
  CONSTRAINT fk_collections_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS word_collection_items (
  collection_id CHAR(36) NOT NULL,
  vocabulary_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (collection_id, vocabulary_id),
  CONSTRAINT fk_collection_items_collection FOREIGN KEY (collection_id) REFERENCES word_collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_collection_items_vocab FOREIGN KEY (vocabulary_id) REFERENCES vocabulary_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS word_reviews (
  user_id CHAR(36) NOT NULL,
  vocabulary_id CHAR(36) NOT NULL,
  correct_count INT UNSIGNED NOT NULL DEFAULT 0,
  wrong_count INT UNSIGNED NOT NULL DEFAULT 0,
  streak INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('new','learning','review','mastered') NOT NULL DEFAULT 'new',
  ease_factor DECIMAL(5,2) NOT NULL DEFAULT 2.50,
  interval_days INT UNSIGNED NOT NULL DEFAULT 0,
  due_at DATETIME(3) NULL,
  last_reviewed_at DATETIME(3) NULL,
  PRIMARY KEY (user_id, vocabulary_id),
  KEY idx_word_reviews_due (user_id, due_at, status),
  CONSTRAINT fk_word_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_word_reviews_vocab FOREIGN KEY (vocabulary_id) REFERENCES vocabulary_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS translation_history (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  candidate_name VARCHAR(60) NOT NULL,
  source_text TEXT NOT NULL,
  source_requested VARCHAR(20) NOT NULL,
  detected_source VARCHAR(20) NULL,
  targets_json JSON NOT NULL,
  translations_json JSON NOT NULL,
  provider VARCHAR(60) NOT NULL,
  track VARCHAR(30) NOT NULL DEFAULT 'general',
  review_status ENUM('machine','approved','rejected') NOT NULL DEFAULT 'machine',
  cached_from CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_translations_user_created (user_id, created_at),
  KEY idx_translations_status_created (review_status, created_at),
  CONSTRAINT fk_translations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id CHAR(36) NULL,
  actor_role VARCHAR(20) NOT NULL,
  action_code VARCHAR(100) NOT NULL,
  target_type VARCHAR(80) NULL,
  target_id VARCHAR(80) NULL,
  detail_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_audit_created (created_at),
  KEY idx_audit_actor (actor_user_id, created_at)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 仅用于从 QuizForge 4.x 一次性迁移。迁移确认完成后可以保留为空，也可以归档。
CREATE TABLE IF NOT EXISTS app_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  payload LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations(version) VALUES ('5.0.0-core');

CREATE TABLE IF NOT EXISTS study_journal (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  track VARCHAR(30) NOT NULL,
  module_code VARCHAR(60) NOT NULL,
  prompt_text TEXT NOT NULL,
  response_text MEDIUMTEXT NOT NULL,
  notes_text TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_journal_user_created (user_id, created_at),
  CONSTRAINT fk_journal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
