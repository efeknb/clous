require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const fitnessRoutes = require('./routes/fitness');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/fitness', fitnessRoutes);

// Catch-all: serve index.html for client-side routing
app.get('*', (req, res) => {
  // Only for non-API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint bulunamadı.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🏋️  Clous Fitness sunucusu çalışıyor!`);
  console.log(`🌐  http://localhost:${PORT}\n`);
});
