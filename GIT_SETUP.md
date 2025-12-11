# How to Push to Git

## Step 1: Install Git (if not installed)

Download and install Git from: https://git-scm.com/download/win

After installation, restart your terminal/PowerShell.

## Step 2: Initialize Git Repository

Open PowerShell in your project directory and run:

```powershell
# Initialize git repository
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: SecondBrain monorepo with React frontend"
```

## Step 3: Create a GitHub Repository

1. Go to https://github.com and sign in
2. Click the "+" icon in the top right → "New repository"
3. Name it (e.g., "secondbrain-monorepo")
4. **DO NOT** initialize with README, .gitignore, or license (we already have these)
5. Click "Create repository"

## Step 4: Connect and Push to GitHub

After creating the repository, GitHub will show you commands. Use these:

```powershell
# Add remote repository (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

## Step 5: Future Updates

For future changes:

```powershell
# Check what changed
git status

# Add specific files or all changes
git add .
# OR add specific files: git add frontend/src/App.jsx

# Commit with a message
git commit -m "Description of your changes"

# Push to GitHub
git push
```

## Important Notes

- The `.gitignore` file will prevent sensitive files (like `storage.json` and uploads) from being committed
- Never commit API keys or secrets
- Make sure to commit frequently with descriptive messages

