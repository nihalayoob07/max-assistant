# Max for WhatsApp

A Chrome extension that connects WhatsApp Web to Max's **front desk**: a separate, tool-less AI plus code (`scripts/desk.py` behind `desk/desk-relay.js`). Customer messages never reach main Max or its tools.

Normally you don't install this yourself: with `WHATSAPP=yes` in `max.config`, `bin/install` runs WhatsApp Web with this extension in a browser on your server (`desk/max-wa.sh`), and you approve replies on Telegram through a second bot. The laptop setup below is the alternative, for when you'd rather keep WhatsApp Web open on your own computer.

## How it works

1. Every 5 s it checks WhatsApp Web for unread chats. It opens one, reads the customer's new messages, and sends them to the front desk.
2. The desk works out which business and product it's about, checks every price against your policy in code (`deal_check.sh`, `lead.sh`), and writes the reply. Leads and client notes land where main Max can read them.
3. On the server, each reply comes to you on Telegram with **Send / Edit / Skip** (or goes straight out with auto-send on: `/mode` on the bot). On a laptop, the reply is pasted into the chat for you to send.
4. Prices outside your limits, and questions only you can answer, come to you on Telegram (and ring the Android app, if you use it).

## Safety

- **Only unsaved numbers** (on by default): chats with a saved contact name, groups, and your own "(You)" chat are never read or sent to the AI.
- Messages older than 60 minutes are skipped, so switching it on doesn't answer a backlog.
- **Test mode** (off by default): in your own "(You)" chat, messages starting with `test:` act as a customer message. Test leads are kept under +910000000000.
- A reply that contains your name (`ownerName`) is blocked in code and never put in the chat.
- It never switches chats while you're typing, and never overwrites text in the message box.
- The front desk is reached over an SSH tunnel or on the server's loopback, so it's never exposed to the network.
- **Ban risk:** WhatsApp's terms forbid automated messaging, and numbers that send automated replies from WhatsApp Web can be banned. Keep auto-send off on a number you can't afford to lose, and prefer a separate business number.

## Setup on a laptop (instead of the server)

1. On the server, set `WHATSAPP=yes` in `max.config` and run `bin/install` once (it creates the front desk and its key), then stop the server's browser: `docker rm -f max-wa`.
2. On the laptop (Git Bash or WSL), keep a tunnel open: `MAX_HOST=you@your-server bin/wa-tunnel`, and get the key: `MAX_HOST=you@your-server bin/wa-tunnel token`.
3. Load the extension:
   - **Chrome:** `chrome://extensions` → Developer mode → **Load unpacked** → this `whatsapp-extension` folder.
   - **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `manifest.json` (temporary add-ons go away when the browser restarts).
4. Click the extension icon: paste the key, set your name and business number, click **Test connection**, then tick **On**.
5. Keep a WhatsApp Web tab open, ideally in its own window, since the extension switches chats when a customer writes.
