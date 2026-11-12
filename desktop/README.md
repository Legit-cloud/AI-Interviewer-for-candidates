# Vren AI desktop app

For interviews in **Zoom, Teams or any other app**, which the Chrome extension cannot hear. It listens to your computer's sound (and optionally your microphone), sends it to Vren AI, and shows each answer in a small box that stays on top of your screen.

It is built with [Tauri](https://tauri.app) (Rust + a small web page for the two windows).

## What it looks like

- **Control window**: type the 6-digit code from the Vren website, pick the sound to listen to, press Start.
- **Answers box**: a small window that stays on top. Drag it by its top bar. Change the text size and see-through level. **Lock** makes clicks pass through it; press **Ctrl+Shift+L** (Cmd+Shift+L on a Mac) to unlock.

It is an ordinary window with the app's real name. It shows in the taskbar and **can appear if you share your whole screen**. It does not try to hide from screen sharing or monitoring.

## Use it

1. On the Vren website open **Live interview** and press **Start**. You get a 6-digit code.
2. Open this app, type the code, press **Connect**.
3. Pick what to listen to, then **Start**.
4. Questions are answered in the box as they are asked.

### Choosing the sound

| System | What to pick |
|---|---|
| Windows | The speakers or headphones your call plays through (listed as "Computer sound"). |
| Linux | The "Monitor of …" entry for your speakers. |
| Mac | macOS does not let apps record its own sound. Install a free virtual device such as [BlackHole](https://existential.audio/blackhole/), send your call's sound to it, then choose it here. |
| Phone or in person | Switch on **Phone or in-person interview**. It uses your microphone to hear the room. |

### Does it clash with the extension?

No. A session can have only **one** app listening. If the extension is already listening, this app is told so in plain words. To use both, pick **Only show answers** when you connect: the desktop box then shows the answers while the extension does the listening. (Each code works once, so get a new code from the website for the second app.)

## Run it from the source

You need Node 20+ and Rust. On Linux also install the Tauri system packages:

```sh
sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev libasound2-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev build-essential
```

On Windows you need the "Desktop development with C++" build tools and WebView2 (already in Windows 11). On a Mac you need the Xcode command line tools.

```sh
cd desktop
npm install
npm run app:dev        # opens both windows, with live reload
```

Start the Vren backend first (`npm run dev` in the project root). The app talks to `http://localhost:8000` by default. Change it under **Advanced** on the first screen.

### Make an installer

```sh
npm run app:build      # installers appear in desktop/src-tauri/target/release/bundle/
```

Before you share it, replace the placeholder icons: `npx tauri icon path/to/logo.png`. Windows will show a "SmartScreen" warning for an unsigned app until you sign it with a code-signing certificate.

## Test

```sh
cargo test -p vren-capture-core     # sound conversion, live client, pairing
npm run typecheck
```

The Rust tests cover the sound conversion (the pitch survives 48 kHz stereo to 16 kHz mono), the live client against a fake server (message order, reconnect with replay, no retry after a refusal), and pairing. There is also a smoke test against a real server:

```sh
cargo run -p vren-capture-core --example smoke -- http://localhost:8000 123456
```

## Where things are

| Path | What it is |
|---|---|
| `capture-core/` | Rust library: sound conversion, the live client, pairing, sound devices. No window code, so it is testable on its own. |
| `src-tauri/` | The app: windows, commands, the Lock shortcut. |
| `src/` | The two pages. They reuse `../extension/lib` (event reducer, plain wording) so both apps read the server the same way. |

## Not done yet

- It has been built and run on Linux only. Windows and macOS builds are untested.
- Mac needs a virtual device (above). A built-in way to capture a Mac's sound is not implemented.
- The two windows' buttons have not been clicked through by an automated test.
