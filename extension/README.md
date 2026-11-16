# Vren AI extension

A small Chrome extension. It listens to the sound of a tab (or your microphone) and shows the answers. The thinking happens on the server.

## Build and load

```sh
cd extension
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked**, and choose `extension/dist/chrome-mv3`.

To point it at a server other than `http://localhost:8000`: `WXT_API_ORIGIN=https://your-server npm run build`.

## Use it

1. On the Vren website open **Live interview** and press **Start**. You get a 6-digit code.
2. Open your interview tab and click the Vren icon. A small box appears on that tab. This box is the whole extension: there is no side panel.
3. Type the code and press **Connect**, then **Start**.
   - If Chrome cannot listen to that tab directly, it opens its own chooser. Pick the tab and tick **Share tab audio**.
   - Phone or in-person interview: switch on **Phone or in-person interview**. Vren uses your microphone to hear the room.
4. The **Sound check** shows two bars, one for the interviewer and one for you. "Transcribing ✓" means Vren is turning that voice into text. Other words ("Quiet", "No sound", "Can't turn it into text") say what is wrong.

The box is part of the web page, so it shows in a tab share and the page can see it. Check what you are sharing.

## Packaging for the website

`npm run ext:package` (from the repo root) builds the zip and copies it to `public/downloads/vren-ai-extension.zip`. The web app offers it on the dashboard and in Settings until the Chrome Web Store listing exists. The build runs `scripts/check-manifest.mjs`, which fails if the manifest asks for more than the Vren server host and the listed permissions.

## What it can see

Only the tab you click the Vren icon on. It has no access to the other pages you open. The microphone needs your permission once, in a normal Chrome tab.

## Test

```sh
npm test         # logic tests
npm run typecheck
```
