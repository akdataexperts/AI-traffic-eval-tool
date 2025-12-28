# Deploying to Render

This guide will help you deploy the AI Traffic Eval Tool to Render, which supports Playwright browser automation.

## Prerequisites

1. A Render account (sign up at https://render.com)
2. Your GitHub repository pushed and accessible
3. Your API keys ready (OpenAI, Perplexity, Gemini, MongoDB, etc.)

## Deployment Steps

### Option 1: Using render.yaml (Recommended)

1. **Push the render.yaml file to your repository**
   - The file is already created in the root directory
   - Commit and push it to your main branch

2. **Connect your repository to Render**
   - Go to https://dashboard.render.com
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect the `render.yaml` file

3. **Configure environment variables**
   - In the Render dashboard, go to your service
   - Navigate to "Environment" tab
   - Add all required environment variables:
     - `OPENAI_API_KEY` (if using GPT)
     - `PERPLEXITY_API_KEY` (if using Perplexity)
     - `GEMINI_API_KEY` (if using Gemini)
     - `MONGODB_URI` (if using MongoDB)
     - **`BROWSERLESS_TOKEN`** (RECOMMENDED for Browser Fanout - see below)
     - `CHATGPT_SESSION_TOKEN` (optional - for ChatGPT auto-login)

## Browser Fanout Configuration (Recommended)

The Browser Fanout feature works best with **Browserless.io** - a cloud browser service that avoids Cloudflare detection.

### Setting up Browserless.io

1. **Sign up at [browserless.io](https://browserless.io)**
   - Free tier: 1,000 browser sessions/month
   - Paid plans available for more usage

2. **Get your API token**
   - Go to your Browserless dashboard
   - Copy your API token

3. **Add to Render environment variables**
   - `BROWSERLESS_TOKEN` = your-browserless-api-token

### Benefits of Browserless.io
- ✅ **Stealth mode** - Avoids Cloudflare bot detection
- ✅ **No local browser needed** - Works in any cloud environment
- ✅ **Better IP reputation** - Less likely to be blocked
- ✅ **Persistent sessions** - Can maintain login state

### Optional: ChatGPT Auto-Login
To skip manual login every time:
1. Log in to ChatGPT in your browser
2. Open DevTools (F12) → Application → Cookies
3. Copy the value of `__Secure-next-auth.session-token`
4. Add to Render: `CHATGPT_SESSION_TOKEN` = (your token)

4. **Deploy**
   - Render will automatically start building and deploying
   - The build process will:
     - Install dependencies
     - Install Playwright Chromium browser (~300MB, takes 3-5 minutes)
       - Note: We use `playwright install chromium` (without `--with-deps`) because Render doesn't allow root access for system dependencies
     - Build your Next.js app
   - First deployment may take 10-15 minutes

### Option 2: Manual Setup (Without render.yaml)

1. **Create a new Web Service**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure the service:**
   - **Name**: `ai-traffic-eval-tool` (or your preferred name)
   - **Environment**: `Node`
   - **Region**: Choose closest to your users
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: Leave empty (root of repo)
   - **Build Command**: 
     ```
     npm install && npx playwright install chromium && npm run build
     ```
   - **Start Command**: 
     ```
     npm start
     ```

3. **Set Plan and Resources**
   - **Plan**: Starter ($7/month) or Standard ($25/month) for better performance
   - Starter plan includes:
     - 512 MB RAM
     - 0.5 CPU
     - Should work for basic usage
   - Standard plan recommended for:
     - Better performance
     - More reliable browser automation
     - 2 GB RAM, 1 CPU

4. **Add Environment Variables**
   - Go to "Environment" tab
   - Add all your API keys and configuration

5. **Deploy**
   - Click "Create Web Service"
   - Render will start building

## Important Notes

### Playwright on Render

- ✅ **Supported**: Render supports Playwright and long-running processes
- ⏱️ **Build Time**: First build takes 10-15 minutes (browser installation)
- 💾 **Disk Space**: Playwright browsers use ~300MB
- 🚀 **Runtime**: Browser automation works well on Render

### Environment Variables

Make sure to set these in Render dashboard (Environment tab):

```
OPENAI_API_KEY=your_key_here
PERPLEXITY_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
MONGODB_URI=your_connection_string
NODE_ENV=production
```

### Updating Your Deployment

- Render automatically deploys on every push to your main branch
- You can also manually trigger deployments from the dashboard
- Builds are cached, so subsequent deployments are faster

### Troubleshooting

1. **Build fails with Playwright installation error**
   - Check that you have enough disk space
   - Try upgrading to Standard plan
   - Check build logs for specific errors

2. **Browser automation not working**
   - Ensure you're using headless mode (code already handles this)
   - Check that Playwright browsers installed successfully
   - Review application logs in Render dashboard

3. **Out of memory errors**
   - Upgrade to Standard plan (more RAM)
   - Consider optimizing your application

### Cost Estimate

- **Starter Plan**: $7/month (good for testing)
- **Standard Plan**: $25/month (recommended for production)
- **Free Trial**: 90-day free trial available

## Next Steps

1. After deployment, test the Browser Fanout feature
2. Monitor logs in Render dashboard
3. Set up auto-deploy from your main branch
4. Consider setting up a custom domain

For more help, visit: https://render.com/docs

