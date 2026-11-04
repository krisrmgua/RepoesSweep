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
    "result": "Done: Pull atlas-web",
    "root": "/Users/demo/projects",
    "platform": "darwin",
    "version": "0.3.1",
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
      "action": "document.querySelector('[data-filter=remote]').click();document.querySelector('.remote-tools').open=true;",
      "expect": "Delete all merged"
    },
    {
      "name": "pull-fix-confirmation",
      "caption": "Pull & Fix explains the recovery steps before applying them.",
      "action": "document.querySelector('[data-filter=all]').click();document.querySelector('#content').scrollTop=0;document.querySelector(\"[data-act=\\\"pullFixAll\\\"]\").click();",
      "expect": "Pull & Fix 2 repos?"
    },
    {
      "name": "cleanup-confirmation",
      "caption": "Local cleanup confirmation names the branches and describes its effect.",
      "action": "document.querySelector(\"#confirm-cancel\").click();document.querySelector(\"[data-act=\\\"clean\\\"]\").click();",
      "expect": "Clean atlas-web?"
    },
    {
      "name": "remote-delete-confirmation",
      "caption": "Remote deletion has a separate confirmation.",
      "action": "document.querySelector(\"#confirm-cancel\").click();document.querySelector(\"[data-act=\\\"deleteMerged\\\"]\").click();",
      "expect": "merged remote branch"
    },
    {
      "name": "settings",
      "caption": "All preferences and scan interval choices.",
      "action": "document.querySelector(\"#confirm-cancel\").click();document.querySelector(\"#gear\").click();",
      "expect": "Scan every"
    }
  ]
};

module.exports.state.repos = [
 {name:'atlas-web',path:'/Users/demo/projects/atlas-web',branch:'main',primary:'main',behind:3,gone:false,dirtyCount:0,cleanupBranches:['feat/old-menu'],remoteBranches:[{name:'feat/navigation',merged:true,mine:true,hasOpenMR:false}]},
 {name:'service-api',path:'/Users/demo/projects/service-api',branch:'main',primary:'main',behind:1,gone:false,dirtyCount:0,cleanupBranches:[],remoteBranches:[{name:'feat/auth',merged:false,mine:true,hasOpenMR:true}]},
 {name:'docs-site',path:'/Users/demo/projects/docs-site',branch:'main',primary:'main',behind:0,gone:false,dirtyCount:0,cleanupBranches:['fix/old-links'],remoteBranches:[]}
];
module.exports.shots.push(
 {name:'updates-filter',caption:'Updates filter shows only out-of-date repositories.',action:'document.querySelector("#back").click();document.querySelector("[data-filter=updates]").click();',check:'document.querySelectorAll(".repo-work-card").length===2 && document.querySelectorAll("[data-act=clean]").length===0 && document.querySelectorAll("[data-act=deleteBranch]").length===0'},
 {name:'cleanup-filter',caption:'Cleanup filter shows local branches and repository-scoped Clean actions.',action:'document.querySelector("[data-filter=cleanup]").click();',check:'document.querySelectorAll(".repo-work-card").length===2 && document.querySelectorAll("[data-act=clean]").length===2 && !document.querySelector("[data-act=pull]")'},
 {name:'remote-filter',caption:'Remote filter shows merge state, MR badges, and deletion actions.',action:'document.querySelector("[data-filter=remote]").click();',check:'document.querySelectorAll(".remote-task").length===2 && document.querySelectorAll(".mr").length===1 && !document.querySelector("[data-act=clean]")'},
 {name:'delete-branch-confirmation',caption:'Remote deletion confirms the exact repo and branch.',action:'document.querySelector("[data-act=deleteBranch]").click();',expect:'Delete origin/feat/navigation?'},
 {name:'delete-cancel',caption:'Cancelling deletion does not invoke the backend.',action:'document.querySelector("#confirm-cancel").click();',check:'window.screenshotTest.calls().length===0'},
 {name:'delete-submitted',caption:'Confirmed deletion sends only the chosen branch.',action:'document.querySelector("[data-act=deleteBranch]").click();document.querySelector("#confirm-ok").click();',check:'window.screenshotTest.calls().length===1 && window.screenshotTest.calls()[0].request.items[0].branches.join(",")==="feat/navigation" && window.screenshotTest.calls()[0].request.items[0].path==="/Users/demo/projects/atlas-web"'},
 {name:'repo-collapsed',caption:'Repository cards collapse without changing other cards.',action:'document.querySelector("[data-filter=all]").click();document.querySelector("[data-act=toggleRepo]").click();',check:'document.querySelector("[data-act=toggleRepo]").getAttribute("aria-expanded")==="false" && document.querySelectorAll(".repo-work-body").length===2'},
 {name:'repo-expanded',caption:'Expanding restores the repository tasks.',action:'document.querySelector("[data-act=toggleRepo]").click();',check:'document.querySelectorAll(".repo-work-body").length===3'},
 {name:'pull-submitted',caption:'Pull targets only the selected repository.',action:'document.querySelector("[data-act=pull]").click();',check:'window.screenshotTest.calls()[1].action==="pull" && window.screenshotTest.calls()[1].paths.join(",")==="/Users/demo/projects/atlas-web"'},
 {name:'failure-banner',caption:'Failed operations use an error banner.',patch:{result:'Failed: Pull atlas-web · Network unavailable'},check:'Boolean(document.querySelector(".result-banner.failure")) && !document.querySelector(".result-banner.success")'},
 {name:'working-banner',caption:'Active operations use a working banner.',patch:{activity:'Pull service-api · 1 of 2',result:null},check:'Boolean(document.querySelector(".result-banner.working"))'},
 {name:'empty-overview',caption:'A completed scan without tasks has a clear empty state.',patch:{activity:null,result:null,repos:[]},expect:'All repos are up to date.'}
);
module.exports.shots.push(
 {name:'remote-hidden',caption:'Remote visibility preference also removes remote filters and actions.',patch:{repos:structuredClone(module.exports.state.repos),prefs:{...module.exports.state.prefs,showRemoteBranches:false}},check:'!document.querySelector("[data-filter=remote]") && !document.querySelector("[data-act=deleteBranch]")'},
 {name:'gone-branch',caption:'Missing upstream branches offer Pull & Fix without a plain Pull.',patch:{repos:[{...module.exports.state.repos[0],name:'atlas-web/long-repository-name-for-navigation-and-layout-verification',gone:true,behind:0,cleanupBranches:[],remoteBranches:[]}]},check:'!document.querySelector("[data-act=pull]") && Boolean(document.querySelector("[data-act=pullFix]")) && document.documentElement.scrollWidth<=innerWidth'}
);

module.exports.shots.push({name:'short-panel',caption:'Long workbench lists scroll while the footer stays visible.',height:440,patch:{repos:structuredClone(module.exports.state.repos),prefs:structuredClone(module.exports.state.prefs)},check:'document.querySelector("main").scrollHeight>document.querySelector("main").clientHeight && document.querySelector(".foot").getBoundingClientRect().bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth'});

module.exports.shots.push({name:'worktree-protection',caption:'Branches in use by linked worktrees are retained and excluded from cleanup.',height:720,patch:{repos:[{...module.exports.state.repos[0],behind:0,cleanupBranches:[],remoteBranches:[],protectedCleanupBranches:['feature/in-use'],cleanupPrimaryElsewhere:true}],prefs:structuredClone(module.exports.state.prefs),result:null},expect:'Kept for worktrees: feature/in-use',check:'!document.querySelector("[data-act=clean]") && !document.querySelector("[data-act=cleanAll]")'});
