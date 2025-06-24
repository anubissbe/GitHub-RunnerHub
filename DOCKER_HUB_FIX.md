# Docker Hub Authentication Fix

## Issue
The GitHub Actions workflow is failing with a 401 Unauthorized error when trying to push to Docker Hub:
```
ERROR: failed to solve: failed to fetch oauth token: unexpected status from GET request to https://auth.docker.io/token?scope=repository%3A***%2Fgithub-runnerhub%3Apull%2Cpush&service=registry.docker.io: 401 Unauthorized
```

## Root Cause
The Docker Hub credentials (`DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`) are either:
1. Not configured in the GitHub repository secrets
2. Incorrectly configured
3. The token has expired or been revoked

## Solution

### Step 1: Generate Docker Hub Access Token
1. Log in to [Docker Hub](https://hub.docker.com)
2. Go to Account Settings → Security
3. Click "New Access Token"
4. Give it a descriptive name (e.g., "GitHub-RunnerHub-CI")
5. Select permissions: "Read, Write, Delete" 
6. Click "Generate"
7. Copy the token (you won't be able to see it again)

### Step 2: Add Secrets to GitHub Repository
1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add or update these secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username
   - `DOCKERHUB_TOKEN`: The access token you just generated

### Step 3: Verify the Workflow
The workflow already has proper error handling:
```yaml
- name: 🔑 Login to Docker Hub
  uses: docker/login-action@v3
  if: github.event_name != 'pull_request'
  continue-on-error: true
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}
```

The `continue-on-error: true` means the workflow will continue even if Docker Hub login fails, but images will only be pushed to GitHub Container Registry (ghcr.io).

## Alternative: Remove Docker Hub Publishing
If you don't need to publish to Docker Hub, you can modify the workflow to only use GitHub Container Registry:

1. Remove the Docker Hub login step (lines 215-221)
2. Update the metadata step to only include GHCR:
   ```yaml
   images: |
     ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
   ```
3. Remove the `DOCKERHUB_IMAGE` references

## Verification
After adding the secrets, re-run the workflow to verify the fix works.