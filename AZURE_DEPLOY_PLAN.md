# Azure App Service Deployment Plan

## Overview

Set up a GitHub Actions workflow to automatically build and deploy the app to Azure App Service whenever code is pushed to the `main` branch.

## Architecture

The app has two parts that deploy as a **single Node.js App Service**:
- **Client** (Vite) — built to `client/dist/` at deploy time
- **Server** (Express + Socket.io) — serves the built client in production (`NODE_ENV=production`)

Azure App Service runs `npm start` at the root, which does `cd server && npm install && npm start`.

## Prerequisites (One-Time Azure Setup)

### 1. Azure Resources

- **Resource Group**: `appsvc_linux_westus3_premium` (already exists)
- **App Service**: `RespectableLiterature` (already exists)
- **Directory ID**: `b86b876a-1f9d-4844-a095-a29f7d55fe39`
- Ensure the App Service is running **Node 24 LTS** on **Linux**

### 2. Enable WebSockets

- In the Azure Portal → Web App → **Configuration** → **General settings**:
  - Turn **Web sockets** ON (required for Socket.io)

### 3. Configure Environment Variables

- In Azure Portal → Web App → **Configuration** → **Application settings**, add:
  - `VITE_DISCORD_CLIENT_ID` — your Discord client ID
  - `DISCORD_CLIENT_SECRET` — your Discord client secret
  - `NODE_ENV` — `production`
  - `PORT` — leave unset (Azure injects this automatically)
  - `WEBSITE_WEBDEPLOY_USE_SCM` — `true`

### 4. Set Up Deployment Credentials

- In Azure Portal → Web App → **Deployment Center** → Download **Publish Profile**
- In GitHub → repo **Settings** → **Secrets and variables** → **Actions**:
  - Add secret `AZURE_WEBAPP_PUBLISH_PROFILE` — paste the full XML content of the publish profile

### 5. App Name

- The Azure Web App name is `RespectableLiterature`

## GitHub Actions Workflow

### 6. Create `.github/workflows/deploy.yml`

The workflow will:
1. Trigger on pushes to `main`
2. Check out the code
3. Set up Node.js 20
4. Install client dependencies and build the Vite client (`client/dist/`)
5. Install server dependencies
6. Deploy the entire repo to Azure App Service using the official `azure/webapps-deploy` action

```yaml
name: Deploy to Azure App Service

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install & build client
        working-directory: client
        run: |
          npm ci
          npm run build

      - name: Install server dependencies
        working-directory: server
        run: npm ci

      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v3
        with:
          app-name: RespectableLiterature
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: .
```

### 7. GitHub Secret

- In GitHub → repo **Settings** → **Secrets and variables** → **Actions**:
  - Add secret `AZURE_WEBAPP_PUBLISH_PROFILE` (from step 4)

## Startup Behavior

Azure will run the root `package.json` start script:
```
cd server && npm install && npm start
```
Which runs `NODE_ENV=production node server.js`, which:
- Serves `client/dist/` as static files
- Handles SPA fallback routing
- Runs the Socket.io server

## File Changes Summary

| File | Action |
|------|--------|
| `.github/workflows/deploy.yml` | **Create** — GitHub Actions workflow |
| Azure Portal | **Configure** — App settings, WebSockets, publish profile |
| GitHub repo settings | **Configure** — Secret `AZURE_WEBAPP_PUBLISH_PROFILE` |

## Implementation Order

1. Enable WebSockets on `RespectableLiterature` in Azure portal
2. Add environment variables (`VITE_DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`) in Azure portal
3. Download publish profile from `RespectableLiterature` and add as `AZURE_WEBAPP_PUBLISH_PROFILE` GitHub secret
4. Create the `.github/workflows/deploy.yml` file
5. Push to `main` and verify the deployment
