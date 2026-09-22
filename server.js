const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        line_user_id VARCHAR(255) PRIMARY KEY,
        game_nickname VARCHAR(255) NOT NULL,
        game_class VARCHAR(255) NOT NULL,
        line_display_name VARCHAR(255),
        allow_search VARCHAR(10) DEFAULT 'N',
        joined_line_group VARCHAR(10) DEFAULT 'N',
        joined_dc VARCHAR(10) DEFAULT 'N',
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
    console.log('[Database] 資料庫與所有擴充表初始化完畢！');
  } catch (err) {
    console.error('[Database] 建表失敗:', err);
  } finally {
    client.release();
  }
}

initDatabase();

app.get('/', (req, res) => { res.json({ status: 'success', message: 'GuildMaster 後台服務運作中！' }); });
app.get('/api/health', (req, res) => { res.json({ status: 'success', message: 'GuildMaster PostgreSQL 後台運行中！' }); });

// 會員相關 API
app.get('/api/members/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    const result = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [lineUserId]);
    if (result.rows.length > 0) {
      const member = result.rows[0];
      res.json({
        status: "found",
        gameNickname: member.game_nickname,
        gameClass: member.game_class,
        lineDisplayName: member.line_display_name,
        allowSearch: member.allow_search || 'N',
        joinedLineGroup: member.joined_line_group || 'N',
        joinedDc: member.joined_dc || 'N',
        guildRole: member.guild_role,
        accountStatus: member.account_status
      });
    } else {
      res.json({ status: "not_found" });
    }
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post('/api/members/bind', async (req, res) => {
  const { lineUserId, lineDisplayName, gameNickname, gameClass, allowSearch } = req.body;
  if (!lineUserId || !gameNickname || !gameClass) return res.status(400).json({ status: "error", message: "缺少必要欄位" });
  try {
    const oldRes = await pool.query('SELECT * FROM members WHERE line_user_id = $1', [lineUserId]);
    const oldMember = oldRes.rows[0];
    const newAccountStatus = (oldMember && oldMember.account_status === '已審核') ? '已審核' : '待審核';

    await pool.query(`
      INSERT INTO members (line_user_id, game_nickname, game_class, line_display_name, allow_search, account_status, update_time)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (line_user_id) 
      DO UPDATE SET game_nickname = EXCLUDED.game_nickname, game_class = EXCLUDED.game_class, line_display_name = EXCLUDED.line_display_name, allow_search = EXCLUDED.allow_search, account_status = $6, update_time = CURRENT_TIMESTAMP
    `, [lineUserId, gameNickname, gameClass, lineDisplayName, allowSearch || 'N', newAccountStatus]);

    if (!oldMember) {
      await pool.query('INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', [lineUserId, '新會員註冊', '-', `${gameNickname} (${gameClass})`]);
    } else {
      if (oldMember.game_nickname !== gameNickname) await pool.query('INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', [lineUserId, '遊戲暱稱', oldMember.game_nickname, gameNickname]);
      if (oldMember.game_class !== gameClass) await pool.query('INSERT INTO member_audit_logs (line_user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)', [lineUserId, '遊戲職業', oldMember.game_class, gameClass]);
    }
    res.json({ status: "success", message: "會員資料已成功更新" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get('/api/admin/members', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM members ORDER BY update_time DESC');
    const members = result.rows.map(m => ({
      lineUserId: m.line_user_id,
      gameNickname: m.game_nickname,
      gameClass: m.game_class,
      lineDisplayName: m.line_display_name,
      allowSearch: m.allow_search || 'N',
      joinedLineGroup: m.joined_line_group || 'N',
      joinedDc: m.joined_dc || 'N',
      accountStatus: m.account_status,
      guildRole: m.guild_role,
      teamGroup: m.team_group,
      updateTime: m.update_time
    }));
    res.json({ status: "success", members });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post('/api/admin/members/status', async (req, res) => {
  const { lineUserId, accountStatus, guildRole } = req.body;
  try {
    await pool.query('UPDATE members SET account_status = $1, guild_role = $2, update_time = CURRENT_TIMESTAMP WHERE line_user_id = $3', [accountStatus, guildRole, lineUserId]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post('/api/admin/members/save', async (req, res) => {
  const { lineUserId, gameNickname, gameClass, lineDisplayName, guildRole, teamGroup, accountStatus, joinedLineGroup, joinedDc } = req.body;
  try {
    await pool.query(`
      INSERT INTO members (line_user_id, game_nickname, game_class, line_display_name, guild_role, team_group, account_status, joined_line_group, joined_dc, update_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (line_user_id) 
      DO UPDATE SET game_nickname = EXCLUDED.game_nickname, game_class = EXCLUDED.game_class, line_display_name = EXCLUDED.line_display_name, guild_role = EXCLUDED.guild_role, team_group = EXCLUDED.team_group, account_status = EXCLUDED.account_status, joined_line_group = EXCLUDED.joined_line_group, joined_dc = EXCLUDED.joined_dc, update_time = CURRENT_TIMESTAMP
    `, [lineUserId, gameNickname, gameClass, lineDisplayName, guildRole, teamGroup, accountStatus, joinedLineGroup || 'N', joinedDc || 'N']);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get('/api/admin/members/logs/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    const result = await pool.query("SELECT field, old_value, TO_CHAR(update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time, new_value FROM member_audit_logs WHERE line_user_id = $1 ORDER BY update_time DESC", [lineUserId]);
    const logs = result.rows.map(l => ({ field: l.field, oldValue: l.old_value, newValue: l.new_value, updateTime: l.update_time }));
    res.json({ status: "success", logs });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.delete('/api/admin/members/:uid', async (req, res) => {
  const lineUserId = req.params.uid;
  try {
    await pool.query('DELETE FROM members WHERE line_user_id = $1', [lineUserId]);
    await pool.query('DELETE FROM member_audit_logs WHERE line_user_id = $1', [lineUserId]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ==========================================
// 請假系統 API (新增 POST /api/leaves)
// ==========================================
app.post('/api/leaves', async (req, res) => {
  const { leaveDate, leaveEvent, targetUid, gameNickname, gameClass, leaveReason, note, operatorUid, operatorName } = req.body;
  
  if (!leaveDate || !leaveEvent || !targetUid || !gameNickname || !leaveReason) {
    return res.status(400).json({ status: "error", message: "缺少必要的請假欄位" });
  }

  try {
    // 產生唯一請假 ID (例如: LV_1711234567890_abc)
    const leaveId = 'LV_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    
    // 若有填寫備註 (note)，可將其附加在請假原因後方或保留
    const finalReason = note ? `${leaveReason} (備註: ${note})` : leaveReason;

    await pool.query(`
      INSERT INTO leaves (leave_id, leave_date, leave_event, target_uid, game_nickname, game_class, leave_reason, operator_uid, operator_name, submit_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
    `, [
      leaveId, 
      leaveDate, 
      leaveEvent, 
      targetUid, 
      gameNickname, 
      gameClass || '', 
      finalReason, 
      operatorUid || targetUid, 
      operatorName || '本人'
    ]);

    res.json({ status: "success", message: "請假申請已成功送出並記錄", leaveId });
  } catch (err) {
    console.error('[Database] 請假寫入失敗:', err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get('/api/admin/leaves', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leaves ORDER BY submit_time DESC');
    const leaves = result.rows.map(l => ({
      id: l.leave_id,
      date: l.leave_date,
      event: l.leave_event,
      gameNickname: l.game_nickname,
      gameClass: l.game_class,
      reason: l.leave_reason,
      isUrgent: l.is_urgent === 'Y',
      operator: l.operator_name || '本人',
      submitTime: l.submit_time
    }));
    res.json({ status: "success", leaves });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 儲存或更新請假項目規則 API
app.post('/api/admin/leave-rules/save', async (req, res) => {
  const { originalEvent, event, latestTime, cycle, enabled } = req.body;
  try {
    if (originalEvent && originalEvent !== event) {
      await pool.query('DELETE FROM leave_rules WHERE event = $1', [originalEvent]);
    }
    await pool.query(`
      INSERT INTO leave_rules (event, latest_time, cycle, enabled)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (event) 
      DO UPDATE SET latest_time = EXCLUDED.latest_time, cycle = EXCLUDED.cycle, enabled = EXCLUDED.enabled
    `, [event, latestTime, cycle, enabled]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 刪除請假項目規則 API
app.delete('/api/admin/leave-rules/:event', async (req, res) => {
  const eventName = req.params.event;
  try {
    await pool.query('DELETE FROM leave_rules WHERE event = $1', [eventName]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 活動列表 API
app.get('/api/admin/events', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM events ORDER BY date DESC');
    const events = result.rows.map(e => ({
      id: e.event_id,
      title: e.title,
      date: e.date,
      time: e.time,
      signupStart: e.signup_start,
      signupEnd: e.signup_end,
      maxLimit: e.max_limit,
      status: e.status,
      isArchived: e.is_archived === 1,
      desc: e.description,
      attendees: []
    }));
    res.json({ status: "success", events });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 其他設定：系統參數 (群組 ID、職業選單) API
app.get('/api/admin/configs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_configs');
    const configs = {};
    result.rows.forEach(r => { configs[r.config_key] = r.config_value; });
    res.json({ status: "success", configs });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post('/api/admin/configs', async (req, res) => {
  const { configKey, configValue } = req.body;
  try {
    await pool.query(`
      INSERT INTO system_configs (config_key, config_value) VALUES ($1, $2)
      ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value
    `, [configKey, configValue]);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 請假項目規則 API
app.get('/api/admin/leave-rules', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leave_rules');
    res.json({ status: "success", rules: result.rows });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 推播排程 API
app.get('/api/admin/broadcasts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM broadcast_schedules');
    res.json({ status: "success", broadcasts: result.rows });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] 伺服器已在連接埠 ${PORT} 上運行`);
});
