const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname, 'public')));

// 連接 SQLite 資料庫 (自動在根目錄建立 guild.db)
const dbFile = path.join(__dirname, 'guild.db');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('[Database] 連接失敗:', err.message);
  } else {
    console.log('[Database] 成功連接至 SQLite 資料庫');
    initDatabase();
  }
});

// 初始化 11 大核心資料表
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      lineUserId TEXT PRIMARY KEY,
      gameNickname TEXT NOT NULL,
      gameClass TEXT NOT NULL,
      lineDisplayName TEXT,
      allowSearch TEXT DEFAULT 'Y',
      accountStatus TEXT DEFAULT '待審核',
      guildRole TEXT DEFAULT '現任',
      teamGroup TEXT DEFAULT '',
      updateTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS member_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lineUserId TEXT NOT NULL,
      field TEXT NOT NULL,
      oldValue TEXT,
      newValue TEXT,
      updateTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS groups (
      groupName TEXT PRIMARY KEY,
      groupStatus TEXT DEFAULT '活躍',
      createTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leaves (
      leaveId TEXT PRIMARY KEY,
      leaveDate TEXT NOT NULL,
      leaveEvent TEXT NOT NULL,
      targetUid TEXT NOT NULL,
      gameNickname TEXT NOT NULL,
      gameClass TEXT,
      leaveReason TEXT NOT NULL,
      isUrgent TEXT DEFAULT 'N',
      operatorUid TEXT,
      operatorName TEXT,
      submitTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leave_rules (
      event TEXT PRIMARY KEY,
      latestTime TEXT NOT NULL,
      cycle TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS events (
      eventId TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      signupStart TEXT,
      signupEnd TEXT,
      maxLimit INTEGER DEFAULT 0,
      status TEXT DEFAULT '報名中',
      isArchived INTEGER DEFAULT 0,
      desc TEXT,
      createTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_signups (
      signupId TEXT PRIMARY KEY,
      eventId TEXT NOT NULL,
      lineUserId TEXT NOT NULL,
      gameNickname TEXT NOT NULL,
      gameClass TEXT,
      signupTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bulletins (
      postId TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      isPinned INTEGER DEFAULT 0,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      date TEXT NOT NULL,
      imageUrl TEXT,
      content TEXT NOT NULL,
      linkText TEXT,
      linkUrl TEXT,
      createTime DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bulletin_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      postId TEXT NOT NULL,
      lineUserId TEXT NOT NULL,
      gameNickname TEXT NOT NULL,
      gameClass TEXT,
      readTime TEXT NOT NULL,
      UNIQUE(postId, lineUserId)
    );

    CREATE TABLE IF NOT EXISTS broadcast_schedules (
      broadcastId TEXT PRIMARY KEY,
      item TEXT NOT NULL,
      freq TEXT NOT NULL,
      cycle TEXT,
      time TEXT,
      content TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS system_configs (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  console.log('[Database] 11 大核心資料表建置完畢');
}

// 測試用 API
app.get('/api/health', (req, res) => {
  res.json({ status: 'success', message: 'GuildMaster 後台運行中！' });
});

app.listen(PORT, () => {
  console.log(`[Server] 伺服器已在連接埠 ${PORT} 上運行`);
});
