# 🚂 Deploy to Railway Dashboard Guide

Since Railway CLI has PATH issues, follow these steps to deploy through the Railway dashboard:

## 📱 Step 1: Open Railway Dashboard

1. Go to: https://railway.app/dashboard
2. Make sure you're in your **Personal** workspace (not Tandem)

## 🎯 Step 2: Navigate to Your Project

1. Click on **"amiable-vision"** project (your existing project)
2. You should see your existing services including the Postgres database

## ➕ Step 3: Create New Service

### Option A: Deploy from GitHub (If you pushed to GitHub)
1. Click **"+ New"** button
2. Select **"GitHub Repo"**
3. If not connected, click **"Connect GitHub"** and authorize Railway
4. Search for **"portfolio-backend"** repository
5. Select it and Railway will start deploying automatically

### Option B: Deploy from Local Folder
1. Click **"+ New"** button
2. Select **"Empty Service"**
3. Name it: **"portfolio-backend"**
4. Click on the new service
5. Go to **Settings** tab
6. In the **Source** section, click **"GitHub"** or drag and drop your backend folder

## 🔧 Step 4: Configure Environment Variables (CRITICAL!)

Once your service is created:

1. Click on your **portfolio-backend** service
2. Go to **"Variables"** tab
3. Add these variables:

### Connect Database (REQUIRED)
- Click **"Add Variable Reference"**
- Select **"respendit-illumination"** (your Postgres)
- Choose **DATABASE_URL**
- Click **"Add"**

### Add Custom Variables
Click **"+ New Variable"** for each:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `ADMIN_KEY` | `choose-your-secret-admin-key` |

Railway automatically provides:
- `PORT` - Don't set this manually
- `RAILWAY_ENVIRONMENT` - Automatically set

## 🌐 Step 5: Generate Public URL

1. Stay in your **portfolio-backend** service
2. Go to **"Settings"** tab
3. Scroll to **"Networking"** section
4. Click **"Generate Domain"**
5. Railway creates something like: `portfolio-backend-production-xyz.up.railway.app`
6. **Copy this URL!** You need it for the frontend

## ✏️ Step 6: Update Your Frontend

1. Open your portfolio HTML file
2. Find line ~629 with `getAPIUrl()` function
3. Replace the URL:

```javascript
getAPIUrl() {
  return window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://portfolio-backend-production-xyz.up.railway.app'; // YOUR ACTUAL RAILWAY URL
}
```

## ✅ Step 7: Verify Deployment

### Check Health Endpoint
Visit in browser:
```
https://YOUR-RAILWAY-URL.up.railway.app/health
```

Should show:
```json
{"status":"ok","timestamp":"2024-..."}
```

### Check Marks Endpoint
```
https://YOUR-RAILWAY-URL.up.railway.app/marks
```

Should show:
```json
[]
```
(Empty array is good - means it's working!)

## 📊 Step 8: Monitor Your Service

In Railway Dashboard:
- **Logs** tab - See real-time logs
- **Metrics** tab - Monitor performance
- **Deployments** tab - See deployment history

## 🔍 Troubleshooting

### "Build Failed"
- Check Logs tab for errors
- Make sure package.json is present
- Verify node version compatibility

### "Cannot connect to database"
- Verify DATABASE_URL is added in Variables
- Check if Postgres service is running
- Look for connection errors in Logs

### "Application Error"
- Check if all environment variables are set
- Look at Logs for specific errors
- Verify PORT is NOT manually set

### "No Response"
- Make sure you generated a public domain
- Check if service is running (green dot)
- Verify health endpoint works

## 🎉 Success Indicators

Your deployment is successful when:
- ✅ Service shows green "Active" status
- ✅ Logs show "Backend server running on port..."
- ✅ Health endpoint returns {"status":"ok"}
- ✅ Database tables created (check Postgres Data tab)
- ✅ Marks can be created and retrieved

## 💰 Usage & Billing

Railway Free Tier:
- $5 free credit per month
- ~500 hours of runtime
- Perfect for personal projects
- Auto-sleeps when not in use

## 🚀 Your Backend is Ready!

Once deployed:
1. Update your frontend with the Railway URL
2. Test creating marks on your portfolio
3. Share with others to see collaborative drawing!

---

## Quick Checklist

- [ ] Service created in Railway
- [ ] DATABASE_URL connected
- [ ] NODE_ENV set to "production"
- [ ] ADMIN_KEY configured
- [ ] Public domain generated
- [ ] Frontend updated with Railway URL
- [ ] Health check passing
- [ ] Marks API working

Need help? Check the Logs tab in Railway for detailed error messages!