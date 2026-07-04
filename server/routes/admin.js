const express = require('express');
const db = require('../db');

const router = express.Router();

// Simple admin key check (from query param or header)
// In production, replace this with proper auth
const ADMIN_KEY = process.env.ADMIN_KEY || 'clous_admin_2024';

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Geçersiz admin anahtarı.' });
  }
  next();
}

// GET /api/admin/overview — summary stats
router.get('/overview', adminAuth, (req, res) => {
  try {
    const totalUsers     = db.prepare('SELECT COUNT(*) as c FROM users').get();
    const totalWorkouts  = db.prepare('SELECT COUNT(*) as c FROM workouts').get();
    const totalCalories  = db.prepare('SELECT SUM(calories) as s FROM workouts').get();
    const totalDuration  = db.prepare('SELECT SUM(duration) as s FROM workouts').get();
    const todayWorkouts  = db.prepare("SELECT COUNT(*) as c FROM workouts WHERE date = date('now')").get();
    const recentUsers    = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-7 days')").get();

    res.json({
      total_users: totalUsers.c,
      total_workouts: totalWorkouts.c,
      total_calories: totalCalories.s || 0,
      total_duration: totalDuration.s || 0,
      today_workouts: todayWorkouts.c,
      new_users_week: recentUsers.c
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users — all users
router.get('/users', adminAuth, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.username, u.email, u.full_name, u.created_at,
        (SELECT COUNT(*) FROM workouts WHERE user_id = u.id) as workout_count,
        (SELECT MAX(date) FROM workouts WHERE user_id = u.id) as last_workout
      FROM users u
      ORDER BY u.id DESC
    `).all();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', adminAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ message: `Kullanıcı "${user.username}" silindi.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/workouts — all workouts with user info
router.get('/workouts', adminAuth, (req, res) => {
  try {
    const workouts = db.prepare(`
      SELECT w.*, u.username, u.email
      FROM workouts w
      JOIN users u ON w.user_id = u.id
      ORDER BY w.id DESC
    `).all();
    res.json({ workouts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/workouts/:id
router.delete('/workouts/:id', adminAuth, (req, res) => {
  try {
    const w = db.prepare('SELECT * FROM workouts WHERE id = ?').get(req.params.id);
    if (!w) return res.status(404).json({ error: 'Antrenman bulunamadı.' });
    db.prepare('DELETE FROM workouts WHERE id = ?').run(req.params.id);
    res.json({ message: 'Antrenman silindi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/query — run raw SELECT query
router.post('/query', adminAuth, (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql || !sql.trim()) {
      return res.status(400).json({ error: 'SQL sorgusu boş olamaz.' });
    }

    const trimmed = sql.trim().toUpperCase();

    // Allow only SELECT and PRAGMA for safety
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('PRAGMA')) {
      return res.status(403).json({ error: 'Sadece SELECT ve PRAGMA sorguları çalıştırılabilir.' });
    }

    const rows = db.prepare(sql).all();
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ rows, columns, count: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/admin/tables — list tables and row counts
router.get('/tables', adminAuth, (req, res) => {
  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();

    const result = tables.map(t => {
      const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
      return { name: t.name, rows: count.c };
    });

    res.json({ tables: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.adminAuth = adminAuth;
