# Personal Web Backend

Backend API for the collaborative drawing wall on Lokesh's portfolio site.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Run locally:**
   ```bash
   npm start
   ```

## Deployment to Railway

### Method 1: Railway CLI (if installed)
```bash
railway link
railway up
```

### Method 2: GitHub Integration
1. Push this code to a GitHub repository
2. In Railway dashboard, create a new service
3. Connect to your GitHub repo
4. Railway will auto-deploy on push

### Method 3: Manual Upload
1. Go to Railway dashboard
2. Click "New Service" > "Empty Service"
3. Drag and drop this `backend` folder
4. Railway will build and deploy automatically

## Environment Variables (Railway)

Railway should automatically provide:
- `DATABASE_URL` - Connection string from your Postgres database
- `PORT` - Server port (Railway sets this)

You need to add:
- `NODE_ENV=production`
- `ADMIN_KEY=<your-secret-key>` - For admin endpoints

## API Endpoints

- `GET /health` - Health check
- `GET /marks?since=<timestamp>&limit=<number>` - Get marks (max 2000)
- `POST /marks` - Create a new mark
- `POST /report/:id` - Report a mark
- `DELETE /admin/marks/:id` - Hide a mark (requires admin key)
- `DELETE /admin/marks` - Clear all marks (requires admin key)

## Database Schema

The API automatically creates a `marks` table with:
- `id` - UUID primary key
- `type` - 'pen' or 'text'
- `pts` - Array of [x,y] points for pen strokes
- `x`, `y` - Position for text marks
- `text` - Text content (max 48 chars)
- `color` - Hex color code
- `session` - Anonymous session identifier
- `created` - Timestamp
- `hidden` - Soft delete flag

## Rate Limiting

- 30 marks per minute per IP address
- Max payload size: 10KB
- Max pen stroke points: 400
- Max text length: 48 characters

## Moderation

- Automatic profanity filtering on text
- Report endpoint for user flagging
- Admin endpoints for hiding/clearing marks