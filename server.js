const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 【關鍵修正】確保能夠正確讀取 public 資料夾底下的前端 HTML 與靜態檔案
app.use(express.static(path.join(__dirname, 'public')));

// 連接 Zeabur 提供的 PostgreSQL 資料庫 (環境變數會自動帶入)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 初始化 11 大核心資料表 (PostgreSQL 語法)
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        line_user_id VARCHAR(255) PRIMARY KEY,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255) NOT NULL,
        line_display_name VARCHAR(255),
        allow_search VARCHAR(10) DEFAULT 'Y',
        account_status VARCHAR(50) DEFAULT '待審核',
        guild_role VARCHAR(50) DEFAULT '現任',
        team_group VARCHAR(255) DEFAULT '',
        update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS member_audit_logs (
        id SERIAL PRIMARY KEY,
        line_user_id VARCHAR(255) NOT NULL,
        field VARCHAR(255) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS groups (
        group_name VARCHAR(255) PRIMARY KEY,
        group_status VARCHAR(50) DEFAULT '活躍',
        create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS leaves (
        leave_id VARCHAR(255) PRIMARY KEY,
        leave_date VARCHAR(50) NOT NULL,
        leave_event VARCHAR(255) NOT NULL,
        target_uid VARCHAR(255) NOT NULL,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255),
        leave_reason TEXT NOT NULL,
        is_urgent VARCHAR(10) DEFAULT 'N',
        operator_uid VARCHAR(255),
        operator_name VARCHAR(255),
        submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS leave_rules (
        event VARCHAR(255) PRIMARY KEY,
        latest_time VARCHAR(50) NOT NULL,
        cycle VARCHAR(100) DEFAULT '',
        enabled INT DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        date VARCHAR(50) NOT NULL,
        time VARCHAR(50) NOT NULL,
        signup_start VARCHAR(50),
        signup_end VARCHAR(50),
        max_limit INT DEFAULT 0,
        status VARCHAR(50) DEFAULT '報名中',
        is_archived INT DEFAULT 0,
        description TEXT,
        create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS event_signups (
        signup_id VARCHAR(255) PRIMARY KEY,
        event_id VARCHAR(255) NOT NULL,
        line_user_id VARCHAR(255) NOT NULL,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255),
        signup_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bulletins (
        post_id VARCHAR(255) PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        is_pinned INT DEFAULT 0,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        date VARCHAR(50) NOT NULL,
        image_url TEXT,
        content TEXT NOT NULL,
        link_text VARCHAR(255),
        link_url TEXT,
        create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bulletin_reads (
        id SERIAL PRIMARY KEY,
        post_id VARCHAR(255) NOT NULL,
        line_user_id VARCHAR(255) NOT NULL,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255),
        read_time VARCHAR(50) NOT NULL,
        UNIQUE(post_id, line_user_id)
      );

      CREATE TABLE IF NOT EXISTS broadcast_schedules (
        broadcast_id VARCHAR(255) PRIMARY KEY,
        item VARCHAR(255) NOT NULL,
        freq VARCHAR(50) NOT NULL,
        cycle VARCHAR(100),
        time VARCHAR(50),
        content TEXT NOT NULL,
        active INT DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS system_configs (
        config_key VARCHAR(255) PRIMARY KEY,
        config_value TEXT
      );
    `);
    console.log('[Database] PostgreSQL 11 大核心資料表建置完畢！');
  } catch (err) {
    console.error('[Database] 建表失敗:', err);
  } finally {
    client.release();
  }
}

initDatabase();

// ==========================================
// 頁面與 API 路由區段
// ==========================================

// 0. 根目錄自動載入您的前端首頁 (假設您的 HTML 放在 public 內或作為主頁)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. 健康檢查 API
app.get('/api/health', (req, res) => {
  res.json({ status: 'success', message: 'GuildMaster PostgreSQL 後台運行中！' });
});

// 2. 查詢會員身分 API (前台 LIFF 呼叫)
app.get('/api/members/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    const result = await pool.query(
      'SELECT * FROM members WHERE line_user_id = $1',
      [lineUserId]
    );

    if (result.rows.length > 0) {
      const member = result.rows[0];
      res.json({
        status: "found",
        gameNickname: member.game_nickname,
        gameClass: member.game_class,
        lineDisplayName: member.line_display_name,
        allowSearch: member.allow_search,
        accountStatus: member.account_status
      });
    } else {
      res.json({ status: "not_found" });
    }
  } catch (err) {
    console.error('[API] 查詢會員失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 3. 會員綁定 / 更新資料 API (前台 LIFF 送出)
app.post('/api/members/bind', async (req, res) => {
  const { lineUserId, lineDisplayName, gameNickname, gameClass, allowSearch } = req.body;
  
  if (!lineUserId || !gameNickname || !gameClass) {
    return res.status(400).json({ status: "error", message: "缺少必要欄位" });
  }

  try {
    await pool.query(`
      INSERT INTO members (line_user_id, game_nickname, game_class, line_display_name, allow_search, account_status, update_time)
      VALUES ($1, $2, $3, $4, $5, '待審核', CURRENT_TIMESTAMP)
      ON CONFLICT (line_user_id) 
      DO UPDATE SET 
        game_nickname = EXCLUDED.game_nickname,
        game_class = EXCLUDED.game_class,
        line_display_name = EXCLUDED.line_display_name,
        allow_search = EXCLUDED.allow_search,
        update_time = CURRENT_TIMESTAMP
    `, [lineUserId, gameNickname, gameClass, lineDisplayName, allowSearch]);

    console.log(`[API] 會員資料已成功儲存/更新: ${gameNickname} (${lineUserId})`);
    res.json({ status: "success", message: "會員資料已成功送出審核" });
  } catch (err) {
    console.error('[API] 儲存會員資料失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`[Server] 伺服器已在連接埠 ${PORT} 上運行`);
});
