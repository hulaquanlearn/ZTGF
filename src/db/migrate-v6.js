// Additive upgrade: keep existing rows and retired-language values for recovery.
// Widening track to VARCHAR permits current tracks without truncating historical data.
export async function migrateV6(pool) {
  const additions = [
    ['users','starter_initialized','TINYINT(1) NOT NULL DEFAULT 0'],
    ['question_banks','category_name',"VARCHAR(100) NOT NULL DEFAULT ''"],
    ['exams','draft_answers_json','JSON NULL'],
    ['vocabulary_entries','owner_id','CHAR(36) NULL']
  ];
  for(const [table,column,definition] of additions){
    const [rows]=await pool.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
    if(!rows.length)await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  for(const table of ['question_banks','exams','attempts','vocabulary_entries','word_collections','translation_history']){
    const [rows]=await pool.execute('SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,'track']);
    if(rows[0]?.DATA_TYPE==='enum')await pool.query(`ALTER TABLE ${table} MODIFY COLUMN track VARCHAR(30) NOT NULL DEFAULT 'general'`);
  }
  await pool.query("INSERT IGNORE INTO schema_migrations(version) VALUES ('6.0.0-unified')");
}
