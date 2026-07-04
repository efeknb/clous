const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// All fitness routes require authentication
router.use(authenticateToken);

// GET /api/fitness/workouts — get all workouts for user
router.get('/workouts', (req, res) => {
  try {
    const workouts = db.prepare(
      'SELECT * FROM workouts WHERE user_id = ? ORDER BY date DESC, created_at DESC'
    ).all(req.user.id);
    res.json({ workouts });
  } catch (err) {
    console.error('Get workouts error:', err);
    res.status(500).json({ error: 'Antrenmanlar alınamadı.' });
  }
});

// POST /api/fitness/workouts — add new workout
router.post('/workouts', (req, res) => {
  try {
    const { type, duration, calories, notes, date } = req.body;

    if (!type || !duration) {
      return res.status(400).json({ error: 'Antrenman tipi ve süre zorunludur.' });
    }

    const workoutDate = date || new Date().toISOString().split('T')[0];

    const result = db.prepare(
      'INSERT INTO workouts (user_id, type, duration, calories, notes, date) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, type, duration, calories || null, notes || null, workoutDate);

    const workout = db.prepare('SELECT * FROM workouts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Antrenman eklendi!', workout });
  } catch (err) {
    console.error('Add workout error:', err);
    res.status(500).json({ error: 'Antrenman eklenemedi.' });
  }
});

// DELETE /api/fitness/workouts/:id
router.delete('/workouts/:id', (req, res) => {
  try {
    const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!workout) {
      return res.status(404).json({ error: 'Antrenman bulunamadı.' });
    }
    db.prepare('DELETE FROM workouts WHERE id = ?').run(req.params.id);
    res.json({ message: 'Antrenman silindi.' });
  } catch (err) {
    console.error('Delete workout error:', err);
    res.status(500).json({ error: 'Antrenman silinemedi.' });
  }
});

// GET /api/fitness/stats — summary statistics
router.get('/stats', (req, res) => {
  try {
    const userId = req.user.id;

    const totalWorkouts = db.prepare(
      'SELECT COUNT(*) as count FROM workouts WHERE user_id = ?'
    ).get(userId);

    const totalDuration = db.prepare(
      'SELECT SUM(duration) as total FROM workouts WHERE user_id = ?'
    ).get(userId);

    const totalCalories = db.prepare(
      'SELECT SUM(calories) as total FROM workouts WHERE user_id = ?'
    ).get(userId);

    const thisWeek = db.prepare(`
      SELECT COUNT(*) as count FROM workouts 
      WHERE user_id = ? AND date >= date('now', '-7 days')
    `).get(userId);

    const byType = db.prepare(`
      SELECT type, COUNT(*) as count, SUM(duration) as total_duration
      FROM workouts WHERE user_id = ?
      GROUP BY type ORDER BY count DESC
    `).all(userId);

    const recentWorkouts = db.prepare(`
      SELECT * FROM workouts WHERE user_id = ? 
      ORDER BY date DESC, created_at DESC LIMIT 5
    `).all(userId);

    res.json({
      stats: {
        total_workouts: totalWorkouts.count,
        total_duration: totalDuration.total || 0,
        total_calories: totalCalories.total || 0,
        workouts_this_week: thisWeek.count,
        by_type: byType,
        recent_workouts: recentWorkouts
      }
    });
  } catch (err) {
    console.error('Get stats error:', err);
    res.status(500).json({ error: 'İstatistikler alınamadı.' });
  }
});

// GET/POST /api/fitness/profile — user body stats
router.get('/profile', (req, res) => {
  try {
    const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(req.user.id);
    const user = db.prepare('SELECT id, username, email, full_name, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ profile: { ...user, stats: stats || {} } });
  } catch (err) {
    res.status(500).json({ error: 'Profil alınamadı.' });
  }
});

router.post('/profile', (req, res) => {
  try {
    const { weight, height, goal } = req.body;
    const existing = db.prepare('SELECT id FROM user_stats WHERE user_id = ?').get(req.user.id);
    if (existing) {
      db.prepare('UPDATE user_stats SET weight=?, height=?, goal=?, updated_at=datetime("now") WHERE user_id=?')
        .run(weight, height, goal, req.user.id);
    } else {
      db.prepare('INSERT INTO user_stats (user_id, weight, height, goal) VALUES (?,?,?,?)')
        .run(req.user.id, weight, height, goal);
    }
    res.json({ message: 'Profil güncellendi.' });
  } catch (err) {
    res.status(500).json({ error: 'Profil güncellenemedi.' });
  }
});

module.exports = router;
