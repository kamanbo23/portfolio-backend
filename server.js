require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const Filter = require('bad-words');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3001;
const filter = new Filter();

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);

    // In production, you might want to restrict to specific domains
    const allowedOrigins = [
      'http://localhost:8000',
      'http://localhost:3000',
      'https://lokeshkamanboina.netlify.app',
      'https://lokesh.netlify.app',
      /\.netlify\.app$/,  // Allow any Netlify subdomain
      'file://',  // Allow local file access for testing
    ];

    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
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
        approved BOOLEAN DEFAULT FALSE,
        reviewed BOOLEAN DEFAULT FALSE,
        hidden BOOLEAN DEFAULT FALSE,
        ip_hash VARCHAR(64)
      )
    `);

    // Create index for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_marks_created ON marks(created DESC);
      CREATE INDEX IF NOT EXISTS idx_marks_hidden ON marks(hidden);
    `);

    // Create visitors table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id VARCHAR(100) UNIQUE NOT NULL,
        ip_hash VARCHAR(64),
        user_agent VARCHAR(500),
        referrer VARCHAR(500),
        country VARCHAR(100),
        city VARCHAR(100),
        first_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        page_views INT DEFAULT 1,
        time_spent INT DEFAULT 0,
        device_type VARCHAR(50),
        browser VARCHAR(50)
      )
    `);

    // Create page views table for detailed analytics
    await pool.query(`
      CREATE TABLE IF NOT EXISTS page_views (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        visitor_id UUID REFERENCES visitors(id),
        page VARCHAR(200),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        duration INT DEFAULT 0
      )
    `);

    // Create indexes for visitor analytics
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_visitors_first_visit ON visitors(first_visit DESC);
      CREATE INDEX IF NOT EXISTS idx_visitors_last_visit ON visitors(last_visit DESC);
      CREATE INDEX IF NOT EXISTS idx_page_views_timestamp ON page_views(timestamp DESC);
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

// Helper function to parse user agent
function parseUserAgent(userAgent) {
  const ua = userAgent?.toLowerCase() || '';
  let device = 'desktop';
  let browser = 'unknown';

  // Detect device type
  if (/mobile|android|iphone/i.test(ua)) device = 'mobile';
  else if (/ipad|tablet/i.test(ua)) device = 'tablet';

  // Detect browser
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) browser = 'chrome';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'safari';
  else if (/firefox/i.test(ua)) browser = 'firefox';
  else if (/edge/i.test(ua)) browser = 'edge';

  return { device, browser };
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Admin endpoint to get all marks (protected)
app.get('/admin/marks', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (process.env.NODE_ENV === 'production' && adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const since = req.query.since || '1970-01-01';
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);

    const result = await pool.query(
      `SELECT id, type, pts, x, y, text, color, session, created, ip_hash
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

// Create a new mark (saves privately for admin)
app.post('/marks', limiter, async (req, res) => {
  try {
    const mark = validateMark(req.body);

    // Generate session if not provided
    if (!mark.session) {
      mark.session = req.ip || 'anonymous';
    }

    // Hash IP for privacy
    const ipHash = crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex');

    const result = await pool.query(
      `INSERT INTO marks (type, pts, x, y, text, color, session, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created`,
      [
        mark.type,
        mark.type === 'pen' ? JSON.stringify(mark.pts) : null,
        mark.type === 'text' ? mark.x : null,
        mark.type === 'text' ? mark.y : null,
        mark.type === 'text' ? mark.text : null,
        mark.color || '#f4f4f2',
        mark.session,
        ipHash
      ]
    );

    res.status(201).json({
      id: result.rows[0].id,
      message: 'Thank you! Your message has been saved for Lokesh.',
      success: true
    });
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

// Admin endpoint to hide/delete a specific mark
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

// Track visitor
app.post('/track', async (req, res) => {
  try {
    const { sessionId, page = '/', duration = 0 } = req.body;
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';
    const { device, browser } = parseUserAgent(userAgent);

    // Hash IP for privacy (you could also just not store it)
    const ipHash = crypto.createHash('sha256').update(req.ip || 'unknown').digest('hex');

    // Check if visitor exists
    const existingVisitor = await pool.query(
      'SELECT id, page_views FROM visitors WHERE session_id = $1',
      [sessionId]
    );

    let visitorId;

    if (existingVisitor.rows.length > 0) {
      // Update existing visitor
      visitorId = existingVisitor.rows[0].id;
      await pool.query(
        `UPDATE visitors
         SET last_visit = CURRENT_TIMESTAMP,
             page_views = page_views + 1,
             time_spent = time_spent + $1
         WHERE id = $2`,
        [duration, visitorId]
      );
    } else {
      // Create new visitor
      const newVisitor = await pool.query(
        `INSERT INTO visitors (session_id, ip_hash, user_agent, referrer, device_type, browser)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [sessionId, ipHash, userAgent, referrer, device, browser]
      );
      visitorId = newVisitor.rows[0].id;
    }

    // Log the page view
    await pool.query(
      `INSERT INTO page_views (visitor_id, page, duration)
       VALUES ($1, $2, $3)`,
      [visitorId, page, duration]
    );

    res.json({ success: true, visitorId });
  } catch (err) {
    console.error('Error tracking visitor:', err);
    res.status(500).json({ error: 'Failed to track visitor' });
  }
});

// Get visitor statistics
app.get('/stats', async (req, res) => {
  try {
    // Total visitors
    const totalVisitors = await pool.query(
      'SELECT COUNT(*) as total FROM visitors'
    );

    // Visitors today
    const todayVisitors = await pool.query(
      `SELECT COUNT(*) as today FROM visitors
       WHERE DATE(first_visit) = CURRENT_DATE`
    );

    // Visitors this week
    const weekVisitors = await pool.query(
      `SELECT COUNT(*) as week FROM visitors
       WHERE first_visit >= CURRENT_DATE - INTERVAL '7 days'`
    );

    // Currently active (visited in last 5 minutes)
    const activeVisitors = await pool.query(
      `SELECT COUNT(*) as active FROM visitors
       WHERE last_visit >= CURRENT_TIMESTAMP - INTERVAL '5 minutes'`
    );

    // Total page views
    const totalPageViews = await pool.query(
      'SELECT SUM(page_views) as total FROM visitors'
    );

    // Device breakdown
    const devices = await pool.query(
      `SELECT device_type, COUNT(*) as count
       FROM visitors
       GROUP BY device_type`
    );

    // Browser breakdown
    const browsers = await pool.query(
      `SELECT browser, COUNT(*) as count
       FROM visitors
       GROUP BY browser`
    );

    // Recent visitors (last 10)
    const recentVisitors = await pool.query(
      `SELECT session_id, device_type, browser,
              first_visit, last_visit, page_views
       FROM visitors
       ORDER BY last_visit DESC
       LIMIT 10`
    );

    res.json({
      total: parseInt(totalVisitors.rows[0].total),
      today: parseInt(todayVisitors.rows[0].today),
      week: parseInt(weekVisitors.rows[0].week),
      active: parseInt(activeVisitors.rows[0].active),
      pageViews: parseInt(totalPageViews.rows[0].total) || 0,
      devices: devices.rows,
      browsers: browsers.rows,
      recent: recentVisitors.rows
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get detailed analytics (protected endpoint)
app.get('/admin/analytics', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (process.env.NODE_ENV === 'production' && adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Visitors by day (last 30 days)
    const dailyVisitors = await pool.query(`
      SELECT DATE(first_visit) as date, COUNT(*) as visitors
      FROM visitors
      WHERE first_visit >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(first_visit)
      ORDER BY date DESC
    `);

    // Top referrers
    const topReferrers = await pool.query(`
      SELECT referrer, COUNT(*) as count
      FROM visitors
      WHERE referrer != ''
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 10
    `);

    // Average time spent
    const avgTime = await pool.query(
      'SELECT AVG(time_spent) as avg_time FROM visitors'
    );

    // Page views distribution
    const pageDistribution = await pool.query(`
      SELECT page, COUNT(*) as views
      FROM page_views
      GROUP BY page
      ORDER BY views DESC
    `);

    res.json({
      daily: dailyVisitors.rows,
      referrers: topReferrers.rows,
      avgTimeSpent: Math.round(avgTime.rows[0].avg_time || 0),
      pages: pageDistribution.rows
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
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