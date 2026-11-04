// Synthetic documentation fixtures. No accounts, credentials, or live services.
const fs = require('node:fs');
const path = require('node:path');
const image = relative => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../..', relative)).toString('base64');
module.exports = {
  "bridge": "sweep",
  "width": 440,
  "maxHeight": 720,
  "state": {
    "repos": [
      {
        "name": "atlas/api",
        "path": "/Users/demo/projects/atlas/api",
        "branch": "main",
        "primary": "main",
        "behind": 4,
        "gone": false,
        "cleanupBranches": [
          "feat/request-tracing"
        ],
        "remoteBranches": [
          {
            "name": "feat/request-tracing",
            "merged": false,
            "mine": true,
            "hasOpenMR": true
          },
          {
            "name": "fix/cache-ttl",
            "merged": true,
            "mine": true,
            "hasOpenMR": false
          }
        ],
        "dirtyCount": 0
      },
      {
        "name": "atlas/web",
        "path": "/Users/demo/projects/atlas/web",
        "branch": "main",
        "primary": "main",
        "behind": 2,
        "gone": false,
        "cleanupBranches": [
          "fix/navigation"
        ],
        "remoteBranches": [
          {
            "name": "fix/navigation",
            "merged": true,
            "mine": true,
            "hasOpenMR": false
          }
        ],
        "dirtyCount": 0
      },
      {
        "name": "atlas/worker",
        "path": "/Users/demo/projects/atlas/worker",
        "branch": "feat/old-task",
        "primary": "main",
        "behind": 0,
        "gone": true,
        "cleanupBranches": [],
        "remoteBranches": [],
        "dirtyCount": 0
      }
    ],
    "prefs": {
      "greenForPassing": true,
      "showRemoteBranches": true,
      "showOnlyMyRemoteBranches": true,
      "rememberExpanded": true,
      "expandedSections": [
        "Out of date",
        "Cleanup",
        "Remote branches"
      ],
      "scanMinutes": 15,
      "openAtLogin": true
    },
    "scanning": false,
    "updated": "2026-11-04T15:49:28.428689+00:00",
    "activity": null,
    "result": null,
    "root": "/Users/demo/projects",
    "platform": "darwin",
    "version": "0.2.2",
    "mark": image('assets/mark/RepoesSweepMark.png')
  },
  "shots": [
    {
      "name": "overview",
      "caption": "Out-of-date clones, cleanup candidates, and remote branches.",
      "action": "",
      "expect": "Pull all"
    },
    {
      "name": "remote-branches",
      "caption": "Remote branch states, MR badges, and per-branch or bulk actions.",
      "action": "document.querySelector('#content').scrollTop=1000;",
      "expect": "Delete all merged"
    },
    {
      "name": "pull-fix-confirmation",
      "caption": "Pull & Fix explains the recovery steps before applying them.",
      "action": "document.querySelector('#content').scrollTop=0;document.querySelector(\"[data-act=\\\"pullFixAll\\\"]\").click();",
      "expect": "Pull & Fix 3 repos?"
    },
    {
      "name": "cleanup-confirmation",
      "caption": "Local cleanup confirmation names the branches and describes its effect.",
      "action": "document.querySelector(\"#confirm-cancel\").click();document.querySelector(\"[data-act=\\\"clean\\\"]\").click();",
      "expect": "Clean atlas/api?"
    },
    {
      "name": "remote-delete-confirmation",
      "caption": "Remote deletion has a separate confirmation.",
      "action": "document.querySelector(\"#confirm-cancel\").click();document.querySelector(\"[data-act=\\\"deleteMerged\\\"]\").click();",
      "expect": "merged remote branches"
    },
    {
      "name": "settings",
      "caption": "All preferences and scan interval choices.",
      "action": "document.querySelector(\"#confirm-cancel\").click();document.querySelector(\"#gear\").click();",
      "expect": "Scan every"
    }
  ]
};
