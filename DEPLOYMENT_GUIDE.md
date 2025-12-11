# Deployment Guide - Hosting SecondBrain Online

This guide covers various options for hosting your SecondBrain application online.

---

## 🚀 Quick Hosting Options

### Option 1: Railway (Easiest - Recommended for Quick Start)

**Pros:**
- ✅ Free tier available ($5 credit/month)
- ✅ Automatic deployments from GitHub
- ✅ Built-in Docker support
- ✅ Simple setup
- ✅ Environment variable management

**Steps:**

1. **Sign up**: Go to https://railway.app
2. **Create New Project**: Click "New Project"
3. **Deploy from GitHub**: Connect your GitHub repository
4. **Add Services**: Railway will detect `docker-compose.yml`
5. **Set Environment Variables**:
   - `OPENAI_API_KEY` (in backend service)
   - `HF_API_TOKEN` (in backend service)
6. **Deploy**: Railway will automatically build and deploy

**Cost**: Free tier with $5 credit/month, then pay-as-you-go

---

### Option 2: Render (Good Free Option)

**Pros:**
- ✅ Free tier for web services
- ✅ Docker support
- ✅ Automatic SSL certificates
- ✅ GitHub integration

**Steps:**

1. **Sign up**: Go to https://render.com
2. **Create New Web Service**: Select your GitHub repo
3. **Configure**:
   - **Build Command**: `docker compose build`
   - **Start Command**: `docker compose up`
   - **Environment**: Add your API keys
4. **Deploy**: Render handles the rest

**Note**: For multiple services, you may need to deploy each service separately or use Render's Docker Compose support.

**Cost**: Free tier available, then $7/month per service

---

### Option 3: DigitalOcean App Platform

**Pros:**
- ✅ Docker Compose support
- ✅ Managed databases available
- ✅ Good performance
- ✅ Easy scaling

**Steps:**

1. **Sign up**: Go to https://www.digitalocean.com
2. **Create App**: Select "App Platform"
3. **Connect GitHub**: Link your repository
4. **Configure**: 
   - Select Docker Compose
   - Add environment variables
5. **Deploy**: DigitalOcean handles deployment

**Cost**: Starts at $5/month, scales with usage

---

### Option 4: AWS/GCP/Azure (Production)

**For Production Deployment:**

#### AWS (Amazon Web Services)

**Services Needed:**
- **EC2** or **ECS** for containers
- **RDS** for PostgreSQL (if migrating from JSON)
- **ElastiCache** for Redis
- **S3** for file storage
- **CloudFront** for CDN

**Steps:**

1. **Create EC2 Instance** or use **ECS Fargate**
2. **Install Docker**: On EC2 or use ECS
3. **Set up RDS**: PostgreSQL instance
4. **Configure Security Groups**: Open ports 5173, 4000, 8000
5. **Deploy**: Use Docker Compose or ECS task definitions

**Cost**: Pay-as-you-go, ~$20-50/month for small deployment

#### Google Cloud Platform (GCP)

**Services:**
- **Cloud Run** (serverless containers)
- **Cloud SQL** (PostgreSQL)
- **Cloud Memorystore** (Redis)
- **Cloud Storage** (file storage)

**Steps:**

1. **Create Cloud Run services** for each component
2. **Set up Cloud SQL** for database
3. **Configure environment variables**
4. **Deploy**: Use `gcloud` CLI or Cloud Console

**Cost**: Free tier available, then pay-as-you-go

#### Microsoft Azure

**Services:**
- **Container Instances** or **App Service**
- **Azure Database for PostgreSQL**
- **Azure Cache for Redis**
- **Blob Storage**

**Cost**: Free tier available, then pay-as-you-go

---

### Option 5: Fly.io (Great for Docker)

**Pros:**
- ✅ Excellent Docker support
- ✅ Global edge deployment
- ✅ Free tier available
- ✅ Simple CLI

**Steps:**

1. **Install Fly CLI**: `curl -L https://fly.io/install.sh | sh`
2. **Sign up**: `fly auth signup`
3. **Initialize**: `fly launch` in your project directory
4. **Configure**: Edit `fly.toml` for your services
5. **Deploy**: `fly deploy`

**Cost**: Free tier with 3 shared VMs, then pay-as-you-go

---

### Option 6: VPS (Virtual Private Server)

**Providers:**
- **DigitalOcean Droplets** ($6/month)
- **Linode** ($5/month)
- **Vultr** ($6/month)
- **Hetzner** (€4/month - Europe)

**Steps:**

1. **Create VPS**: Choose Ubuntu 22.04
2. **SSH into server**: `ssh root@your-server-ip`
3. **Install Docker**:
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   ```
4. **Install Docker Compose**:
   ```bash
   apt-get update
   apt-get install docker-compose-plugin
   ```
5. **Clone repository**:
   ```bash
   git clone https://github.com/MayaMatrix9936/SecondBrain-Monorepo.git
   cd SecondBrain-Monorepo
   ```
6. **Create `.env` file**:
   ```bash
   cd backend
   nano .env
   # Add your API keys
   ```
7. **Start services**:
   ```bash
   cd ..
   docker compose up -d
   ```
8. **Set up Nginx** (reverse proxy):
   ```bash
   apt-get install nginx
   # Configure nginx to proxy to your services
   ```
9. **Set up SSL** (Let's Encrypt):
   ```bash
   apt-get install certbot python3-certbot-nginx
   certbot --nginx -d yourdomain.com
   ```

**Cost**: $5-10/month

---

## 🔧 Pre-Deployment Checklist

Before deploying, make sure to:

- [ ] **Update CORS settings** in `backend/server.js` to allow your domain
- [ ] **Set environment variables** securely (never commit to Git)
- [ ] **Update frontend API URL** if needed (currently hardcoded to localhost)
- [ ] **Configure domain/DNS** if using custom domain
- [ ] **Set up SSL/HTTPS** for security
- [ ] **Backup strategy** for data
- [ ] **Monitoring** setup (optional but recommended)

---

## 📝 Environment Variables Needed

Create these in your hosting platform:

**Backend & Worker:**
```env
OPENAI_API_KEY=sk-your-key-here
HF_API_TOKEN=your-huggingface-token
REDIS_URL=redis://redis:6379
CHROMA_URL=http://chroma:8000
```

**Frontend:**
- May need to set API URL if backend is on different domain

---

## 🔒 Security Considerations

1. **Never commit API keys** - Use environment variables
2. **Use HTTPS** - Always enable SSL certificates
3. **Update CORS** - Restrict to your domain only
4. **Firewall rules** - Only expose necessary ports
5. **Rate limiting** - Consider adding rate limits to API
6. **Authentication** - Add proper auth before production use

---

## 🛠️ Code Changes Needed for Production

### 1. Update CORS in Backend

Edit `backend/server.js`:

```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "x-user-id"]
}));
```

### 2. Update Frontend API URL

Edit `frontend/src/components/Chat.jsx` and other components:

```javascript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
```

Add to `frontend/.env`:
```env
VITE_API_URL=https://your-backend-domain.com
```

### 3. Use Environment Variables

Update `docker-compose.yml` to use environment variables for URLs.

---

## 📊 Recommended Setup for Production

### Small Scale (Personal Use)
- **Railway** or **Render** - Easiest setup
- **Cost**: Free tier or $5-10/month

### Medium Scale (Team Use)
- **DigitalOcean App Platform** or **Fly.io**
- **Cost**: $20-50/month

### Large Scale (Enterprise)
- **AWS/GCP/Azure** with proper infrastructure
- **Managed databases** (RDS, Cloud SQL)
- **Load balancers**
- **CDN** for frontend
- **Cost**: $100+/month

---

## 🚀 Quick Start: Railway Deployment

**Fastest way to get online:**

1. **Sign up**: https://railway.app
2. **New Project** → **Deploy from GitHub**
3. **Select Repository**: `MayaMatrix9936/SecondBrain-Monorepo`
4. **Add Environment Variables**:
   - `OPENAI_API_KEY`
   - `HF_API_TOKEN`
5. **Deploy**: Railway auto-detects Docker Compose
6. **Get URL**: Railway provides public URL

**That's it!** Your app will be live in minutes.

---

## 📚 Additional Resources

- **Railway Docs**: https://docs.railway.app
- **Render Docs**: https://render.com/docs
- **Docker Deployment**: https://docs.docker.com/get-started/
- **Nginx Configuration**: https://nginx.org/en/docs/

---

## 💡 Tips

1. **Start with Railway/Render** - Easiest for beginners
2. **Use environment variables** - Never hardcode secrets
3. **Test locally first** - Make sure everything works before deploying
4. **Monitor costs** - Set up billing alerts
5. **Backup data** - Regular backups of `storage.json` and Chroma data
6. **Use custom domain** - More professional than platform URLs

---

Good luck with your deployment! 🎉

