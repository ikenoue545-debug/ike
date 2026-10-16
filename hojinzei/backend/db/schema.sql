-- 法人税申告書AIアシスタント DB定義（PostgreSQL）
-- 生成：backend/db/dump_schema.py（app/models.py から）

CREATE TABLE users (
	id SERIAL NOT NULL, 
	email VARCHAR(255) NOT NULL, 
	display_name VARCHAR(100) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (email)
);

CREATE TABLE audit_logs (
	id SERIAL NOT NULL, 
	at TIMESTAMP WITH TIME ZONE NOT NULL, 
	user_id INTEGER, 
	action VARCHAR(60) NOT NULL, 
	entity VARCHAR(40), 
	entity_id INTEGER, 
	company_id INTEGER, 
	fiscal_year_id INTEGER, 
	detail JSON NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE auth_tokens (
	id SERIAL NOT NULL, 
	user_id INTEGER NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (token_hash)
);

CREATE TABLE companies (
	id SERIAL NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	name_kana VARCHAR(200), 
	corporate_number VARCHAR(13), 
	corp_kind VARCHAR(20) NOT NULL, 
	corp_category VARCHAR(20) NOT NULL, 
	head_office_address VARCHAR(300), 
	prefecture VARCHAR(10), 
	municipality VARCHAR(50), 
	phone VARCHAR(30), 
	representative VARCHAR(100), 
	tax_office VARCHAR(50), 
	local_tax_offices VARCHAR(300), 
	industry VARCHAR(100), 
	business_description TEXT, 
	established_on DATE, 
	fiscal_year_end_month INTEGER, 
	filing_extension_months INTEGER NOT NULL, 
	assigned_user_id INTEGER, 
	notes TEXT, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE rule_reviews (
	id SERIAL NOT NULL, 
	rule_id VARCHAR(60) NOT NULL, 
	version VARCHAR(40) NOT NULL, 
	reviewer_name VARCHAR(100) NOT NULL, 
	note TEXT, 
	created_by INTEGER, 
	reviewed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE company_members (
	company_id INTEGER NOT NULL, 
	user_id INTEGER NOT NULL, 
	PRIMARY KEY (company_id, user_id), 
	FOREIGN KEY(company_id) REFERENCES companies (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE company_offices (
	id SERIAL NOT NULL, 
	company_id INTEGER NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	address VARCHAR(300), 
	prefecture VARCHAR(10), 
	municipality VARCHAR(50), 
	employees INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(company_id) REFERENCES companies (id) ON DELETE CASCADE
);

CREATE TABLE fiscal_years (
	id SERIAL NOT NULL, 
	company_id INTEGER NOT NULL, 
	start_date DATE NOT NULL, 
	end_date DATE NOT NULL, 
	return_kind VARCHAR(20) NOT NULL, 
	blue_return BOOLEAN NOT NULL, 
	capital_end BIGINT, 
	large_corp_subsidiary BOOLEAN, 
	tekiyo_jogai BOOLEAN, 
	group_tsusan BOOLEAN NOT NULL, 
	dividends BIGINT, 
	unsupported_features JSON NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	reviewer_id INTEGER, 
	approved_by INTEGER, 
	approved_at TIMESTAMP WITH TIME ZONE, 
	previous_id INTEGER, 
	last_computed_at TIMESTAMP WITH TIME ZONE, 
	critical_count INTEGER, 
	warning_count INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_fy_company_start UNIQUE (company_id, start_date), 
	FOREIGN KEY(company_id) REFERENCES companies (id) ON DELETE CASCADE, 
	FOREIGN KEY(reviewer_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(approved_by) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(previous_id) REFERENCES fiscal_years (id) ON DELETE SET NULL
);

CREATE TABLE accounts (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	code VARCHAR(30), 
	name VARCHAR(100) NOT NULL, 
	statement VARCHAR(2), 
	section VARCHAR(20), 
	category VARCHAR(40), 
	classification VARCHAR(20) NOT NULL, 
	heading VARCHAR(100), 
	sort_order INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_account_fy_name UNIQUE (fiscal_year_id, name), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE
);

CREATE TABLE carryforward_items (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	key VARCHAR(80), 
	name VARCHAR(200) NOT NULL, 
	amount BIGINT, 
	loss_fy_start DATE, 
	loss_fy_end DATE, 
	source VARCHAR(20) NOT NULL, 
	confirmed BOOLEAN NOT NULL, 
	confirmed_by INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(confirmed_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE cell_overrides (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	cell_key VARCHAR(80) NOT NULL, 
	value BIGINT, 
	reason TEXT NOT NULL, 
	active BOOLEAN NOT NULL, 
	created_by INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	revoked_by INTEGER, 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(revoked_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE documents (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	filename VARCHAR(300) NOT NULL, 
	content_type VARCHAR(100), 
	size BIGINT NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	storage_path VARCHAR(500) NOT NULL, 
	uploaded_by INTEGER, 
	uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(uploaded_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE finding_acks (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	fingerprint VARCHAR(32) NOT NULL, 
	code VARCHAR(80) NOT NULL, 
	note TEXT, 
	created_by INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_ack_fy_fp UNIQUE (fiscal_year_id, fingerprint), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE input_sections (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	section VARCHAR(40) NOT NULL, 
	data JSON NOT NULL, 
	updated_by INTEGER, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_input_fy_section UNIQUE (fiscal_year_id, section), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE return_snapshots (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	engine_version VARCHAR(20) NOT NULL, 
	input_hash VARCHAR(64) NOT NULL, 
	rules_used JSON NOT NULL, 
	result JSON NOT NULL, 
	critical_count INTEGER NOT NULL, 
	warning_count INTEGER NOT NULL, 
	created_by INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE shareholders (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	address VARCHAR(300), 
	relation VARCHAR(30), 
	shares BIGINT, 
	voting_rights BIGINT, 
	sort_order INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE
);

CREATE TABLE status_history (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	from_status VARCHAR(20), 
	to_status VARCHAR(20) NOT NULL, 
	note TEXT, 
	changed_by INTEGER, 
	changed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(changed_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE tax_adjustments (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	kind VARCHAR(50) NOT NULL, 
	name VARCHAR(200) NOT NULL, 
	line VARCHAR(10) NOT NULL, 
	direction VARCHAR(10) NOT NULL, 
	disposition VARCHAR(10) NOT NULL, 
	amount BIGINT, 
	target_amount BIGINT, 
	status VARCHAR(20) NOT NULL, 
	decision VARCHAR(20) NOT NULL, 
	confirmed BOOLEAN NOT NULL, 
	confirmed_by INTEGER, 
	confirmed_at TIMESTAMP WITH TIME ZONE, 
	five1_key VARCHAR(80), 
	five1_name VARCHAR(200), 
	five1_column VARCHAR(10) NOT NULL, 
	account_names JSON NOT NULL, 
	reason TEXT, 
	basis JSON NOT NULL, 
	evidence JSON NOT NULL, 
	questions JSON NOT NULL, 
	dismiss_reason TEXT, 
	origin VARCHAR(20) NOT NULL, 
	suggestion_key VARCHAR(80), 
	created_by INTEGER, 
	updated_by INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(confirmed_by) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE import_batches (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	document_id INTEGER, 
	kind VARCHAR(30) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	detected JSON NOT NULL, 
	mapping JSON NOT NULL, 
	row_count INTEGER, 
	error TEXT, 
	created_by INTEGER, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	imported_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(document_id) REFERENCES documents (id) ON DELETE SET NULL, 
	FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE input_section_history (
	id SERIAL NOT NULL, 
	input_section_id INTEGER NOT NULL, 
	data JSON NOT NULL, 
	updated_by INTEGER, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(input_section_id) REFERENCES input_sections (id) ON DELETE CASCADE, 
	FOREIGN KEY(updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE journal_lines (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	import_batch_id INTEGER, 
	entry_date DATE, 
	entry_no VARCHAR(50), 
	side VARCHAR(6) NOT NULL, 
	account_name VARCHAR(100) NOT NULL, 
	counter_account VARCHAR(100), 
	amount BIGINT NOT NULL, 
	tax_category VARCHAR(50), 
	partner VARCHAR(200), 
	item VARCHAR(200), 
	department VARCHAR(100), 
	memo TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(import_batch_id) REFERENCES import_batches (id) ON DELETE CASCADE
);
CREATE INDEX ix_journal_fy_account ON journal_lines (fiscal_year_id, account_name);

CREATE TABLE trial_balance_lines (
	id SERIAL NOT NULL, 
	fiscal_year_id INTEGER NOT NULL, 
	account_id INTEGER NOT NULL, 
	opening BIGINT, 
	debit BIGINT, 
	credit BIGINT, 
	closing BIGINT, 
	import_batch_id INTEGER, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_tb_fy_account UNIQUE (fiscal_year_id, account_id), 
	FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years (id) ON DELETE CASCADE, 
	FOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE CASCADE, 
	FOREIGN KEY(import_batch_id) REFERENCES import_batches (id) ON DELETE SET NULL
);
