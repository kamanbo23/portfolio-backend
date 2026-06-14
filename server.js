require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const Filter = require('bad-words');

const app = express();
const port = process.env.PORT || 3001;
const filter = new Filter();

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10kb' })); // Limit payload size

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: 'Too many marks created, please slow down'
});

// Initialize database
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(10) CHECK (type IN ('pen', 'text')),
        pts JSONB,
        x FLOAT,
        y FLOAT,
        text VARCHAR(48),
        color VARCHAR(20) DEFAULT '#f4f4f2',
        session VARCHAR(100),
        created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        hidden BOOLEAN DEFAULT FALSE
      )
    `);

    // Create index for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_marks_created ON marks(created DESC);
      CREATE INDEX IF NOT EXISTS idx_marks_hidden ON marks(hidden);
    `);

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

// Validate and sanitize mark data
function validateMark(mark) {
  if (!mark.type || !['pen', 'text'].includes(mark.type)) {
    throw new Error('Invalid mark type');
  }

  if (mark.type === 'pen') {
    if (!Array.isArray(mark.pts) || mark.pts.length === 0) {
      throw new Error('Invalid pen points');
    }
    // Limit pen stroke to 400 points
    if (mark.pts.length > 400) {
      mark.pts = mark.pts.slice(0, 400);
    }
    // Ensure points are numbers
    mark.pts = mark.pts.map(pt => [
      Math.round(Number(pt[0]) || 0),
      Math.round(Number(pt[1]) || 0)
    ]);
  }

  if (mark.type === 'text') {
    if (!mark.text || typeof mark.text !== 'string') {
      throw new Error('Invalid text');
    }
    // Limit text length and filter profanity
    mark.text = mark.text.slice(0, 48);
    if (filter.isProfane(mark.text)) {
      mark.text = filter.clean(mark.text);
    }
    if (!mark.x || !mark.y) {
      throw new Error('Invalid text position');
    }
    mark.x = Number(mark.x) || 0;
    mark.y = Number(mark.y) || 0;
  }

  // Validate color
  if (mark.color && !/^#[0-9a-f]{6}$/i.test(mark.color)) {
    mark.color = '#f4f4f2';
  }

  return mark;
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get marks (with pagination)
app.get('/marks', async (req, res) => {
  try {
    const since = req.query.since || '1970-01-01';
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);

    const result = await pool.query(
      `SELECT id, type, pts, x, y, text, color, session, created
       FROM marks
       WHERE hidden = false AND created > $1
       ORDER BY created DESC
       LIMIT $2`,
      [since, limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching marks:', err);
    res.status(500).json({ error: 'Failed to fetch marks' });
  }
});

// Create a new mark
app.post('/marks', limiter, async (req, res) => {
  try {
    const mark = validateMark(req.body);

    // Generate session if not provided
    if (!mark.session) {
      mark.session = req.ip || 'anonymous';
    }

    const result = await pool.query(
      `INSERT INTO marks (type, pts, x, y, text, color, session)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, type, pts, x, y, text, color, session, created`,
      [
        mark.type,
        mark.type === 'pen' ? JSON.stringify(mark.pts) : null,
        mark.type === 'text' ? mark.x : null,
        mark.type === 'text' ? mark.y : null,
        mark.type === 'text' ? mark.text : null,
        mark.color || '#f4f4f2',
        mark.session
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating mark:', err);
    res.status(400).json({ error: err.message || 'Failed to create mark' });
  }
});

// Report a mark (for moderation)
app.post('/report/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Just log it for now - you could add a reports table later
    console.log(`Mark reported: ${id}`);

    res.json({ success: true, message: 'Mark reported for review' });
  } catch (err) {
    console.error('Error reporting mark:', err);
    res.status(500).json({ error: 'Failed to report mark' });
  }
});

// Admin endpoint to hide/delete marks (protect this in production!)
app.delete('/admin/marks/:id', async (req, res) => {
  try {
    // In production, add authentication here
    const adminKey = req.headers['x-admin-key'];
    if (process.env.NODE_ENV === 'production' && adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    await pool.query(
      'UPDATE marks SET hidden = true WHERE id = $1',
      [id]
    );

    res.json({ success: true, message: 'Mark hidden' });
  } catch (err) {
    console.error('Error hiding mark:', err);
    res.status(500).json({ error: 'Failed to hide mark' });
  }
});

// Admin endpoint to clear all marks (use with caution!)
app.delete('/admin/marks', async (req, res) => {
  try {
    // In production, add authentication here
    const adminKey = req.headers['x-admin-key'];
    if (process.env.NODE_ENV === 'production' && adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.query('UPDATE marks SET hidden = true');

    res.json({ success: true, message: 'All marks cleared' });
  } catch (err) {
    console.error('Error clearing marks:', err);
    res.status(500).json({ error: 'Failed to clear marks' });
  }
});

// Start server
async function start() {
  await initDB();

  app.listen(port, () => {
    console.log(`Backend server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start().catch(console.error);