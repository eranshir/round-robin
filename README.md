# Round Robin

A tiny Chrome extension that closes old tabs so I don't have to.

## Why this exists

This week Chrome froze on me again. Memory maxed out, spinning beachball, the whole machine gasping. And the cause was the same as every other time: a hundred tabs I opened with full intention of reading, and never closed.

Here's the problem with tabs. Opening one is free. Closing one is a decision. Every tab is a small open loop, a "maybe I'll need this", and closing it means judging, one by one, whether I still care. So once a week I'd sit down for the ceremony: scan ninety tabs, close seventy of them without reading, feel vaguely guilty, and start accumulating again. The ceremony doesn't fix anything. It just resets the clock on the next freeze.

I got tired of the ceremony. So I built a bouncer.

Think of your browser as a bar with a fixed number of seats. When someone new walks in and the bar is full, the bouncer doesn't panic and he doesn't ask me to run the room. He walks over to whoever has been sitting idle the longest, the tab I haven't touched in days, and shows it the door. Regulars with reserved seats, the pinned and protected tabs, never get bothered. The bar stays full, never overflowing, and I never think about it.

The name is literal: Round Robin is a rotation. New tabs come in, the least recently used tab goes out, and the browser keeps cycling through a fixed budget instead of growing without bound.

## How I use it

I set my budget to 25 tabs. That's it, mostly. I browse exactly like before, open whatever I want, and Chrome simply never gets past 25 tabs. The tab that leaves is always the one I've ignored the longest, which in practice is a tab I'd forgotten existed.

Maybe there's a tab I actually want to keep around, a doc I'm working from all day. I click the extension icon and hit "Protect this tab", and it's off the table (it gets a green check on the icon). Chrome's native pinned tabs are respected the same way.

And then there are the repeat offenders. I somehow always end up with six x.com tabs, all showing roughly the same feed. So I tag the domain with a limit of 1. From then on, opening a new x.com tab closes the old x.com tab, even when I'm well under the overall budget. One feed, always fresh, never six.

## The rules

- The budget counts tabs across all your windows by default (a popup setting switches it to per-window).
- When a new tab pushes you over the budget, the least recently used tab is closed. "Least recently used" means the tab you haven't activated for the longest time.
- Never auto-closed:
  - Chrome-pinned tabs
  - Tabs you protected via the popup
  - The tab you're currently looking at, in any window
  - Tabs playing audio
  - The tab you just opened
- Lowering the budget trims you down to it immediately.
- Tab protection lasts as long as the tab does. It clears when the tab closes or the browser restarts (Chrome tab identities don't survive restarts). Pinning survives restarts, so pin what you want kept forever.

## Domain limits

Tag any domain with its own cap (default 1, editable per domain). When a tab lands on a tagged domain, whether it's a new tab, a link opened in a new tab, or an existing tab navigating there, and the domain is over its cap, the least recently used tab of that same domain is closed. This works independently of the overall budget.

- Domain caps apply across all windows.
- Subdomains match: tagging `x.com` also covers `www.x.com` and `mobile.x.com`.
- The same exemptions hold. Pinned, protected, active, and audio-playing tabs stay.

## Install

The quick way, one file:

1. Download [`release/round-robin.zip`](release/round-robin.zip) and unzip it. You'll get a `round-robin` folder. Keep it somewhere permanent, Chrome loads the extension from that folder.
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `round-robin` folder

(Chrome doesn't allow installing packaged `.crx` files from outside the Web Store, so unzip-and-load is the way until this lands in the store.)

If you cloned the repo instead, skip the download and point **Load unpacked** at the repo folder itself.

One heads-up: if you're currently way over the budget (default: 25 tabs), the extension starts enforcing on the next tab you open. Pin or protect anything you care about first, or set a generous budget and walk it down.

## Under the hood

- `manifest.json` is Manifest V3 and asks for two permissions only: `tabs` and `storage`. No content scripts, no host permissions, nothing reads your pages.
- `background.js` is a service worker that tracks when each tab was last activated (in `chrome.storage.session`, so it survives worker suspension) and enforces the budget and domain caps.
- `popup.html` / `popup.js` hold the settings: budget, scope, per-tab protection, and domain rules. The budget and domain rules live in `chrome.storage.sync`, so they follow your Chrome profile.

Everything runs locally. There is no server, no analytics, and no data leaving your machine.
