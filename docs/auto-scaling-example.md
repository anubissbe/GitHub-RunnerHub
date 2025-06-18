# RunnerHub Auto-Scaling in Action

## Example: ProjectHub-Mcp Gets Busy

### Initial State (Quiet)
```
ProjectHub-Mcp:     1 runner (idle) ✅
JarvisAI:           1 runner (idle) ✅
GitHub-RunnerHub:   1 runner (idle) ✅
```

### Step 1: Workflow Triggered
You push code to ProjectHub-Mcp, triggering CI/CD workflow
```
ProjectHub-Mcp:     1 runner (busy) 🔄
                    ↓
                    Auto-scaler detects: No free runners!
```

### Step 2: Auto-Scale UP (Automatic)
System automatically spawns a dynamic runner
```
ProjectHub-Mcp:     1 dedicated (busy) 🔄
                    1 dynamic (ready) ✅ ← AUTOMATICALLY ADDED
```

### Step 3: More Workflows
3 more PRs arrive, all runners get busy
```
ProjectHub-Mcp:     1 dedicated (busy) 🔄
                    1 dynamic (busy) 🔄
                    ↓
                    Auto-scaler: Still no free runners!
                    ↓
                    2 more dynamic (ready) ✅✅ ← AUTOMATICALLY ADDED
```

### Step 4: Workflows Complete
Jobs finish, runners become idle
```
ProjectHub-Mcp:     1 dedicated (idle) ✅
                    3 dynamic (idle) 💤💤💤
                    ↓
                    Timer starts: 5 minutes
```

### Step 5: Auto-Scale DOWN (Automatic)
After 5 minutes of being idle
```
ProjectHub-Mcp:     1 dedicated (idle) ✅
                    ↓
                    3 dynamic runners ← AUTOMATICALLY REMOVED 🗑️
```

## The Magic 🪄

**You don't need to do ANYTHING!**

The system automatically:
- ✅ Monitors all repos every 30 seconds
- ✅ Spawns runners when needed (up to 3 dynamic per repo)
- ✅ Removes idle dynamic runners after 5 minutes
- ✅ Keeps 1 dedicated runner always ready per repo

## Real Example Output

```bash
[14:23:15] Checking repositories...
  ProjectHub-Mcp:          Total: 1, Busy: 0, Free: 1, Dynamic: 0 ✅
  JarvisAI:                Total: 1, Busy: 0, Free: 1, Dynamic: 0 ✅
  GitHub-RunnerHub:        Total: 1, Busy: 0, Free: 1, Dynamic: 0 ✅

[14:23:45] Checking repositories...
  ProjectHub-Mcp:          Total: 1, Busy: 1, Free: 0, Dynamic: 0 📈 SCALING UP
    ✅ Spawned runnerhub-dyn-projecthub-a3f2b1
  JarvisAI:                Total: 1, Busy: 0, Free: 1, Dynamic: 0 ✅
  GitHub-RunnerHub:        Total: 1, Busy: 0, Free: 1, Dynamic: 0 ✅

[14:29:15] Checking repositories...
  ProjectHub-Mcp:          Total: 2, Busy: 0, Free: 2, Dynamic: 1 📉 Checking for scale down...
    🗑️  Removing idle runnerhub-dyn-projecthub-a3f2b1 (idle for 312s)
  JarvisAI:                Total: 1, Busy: 0, Free: 1, Dynamic: 0 ✅
  GitHub-RunnerHub:        Total: 1, Busy: 0, Free: 1, Dynamic: 0 ✅
```

## Configuration Limits

```yaml
Per Repository:
  Minimum: 1 dedicated runner (always)
  Maximum: 1 dedicated + 3 dynamic = 4 total
  
Global:
  Base: 10 runners (1 per repo)
  Peak: 40 runners (if all repos maxed out)
  Normal: 10-15 runners (typical usage)
```

## Cost Efficiency

- **No manual intervention** needed
- **No wasted resources** - dynamic runners removed when idle
- **No cold starts** - dedicated runner always ready
- **No over-provisioning** - scales to actual demand

This is TRUE auto-scaling! 🚀