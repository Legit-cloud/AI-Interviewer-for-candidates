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
2. Open your interview tab and click the Vren icon on it. The side panel opens.
3. Type the code and press **Connect**, then **Start**.
   - If Chrome cannot listen to that tab directly, it opens its own chooser. Pick the tab and tick **Share tab audio**.
   - Phone or in-person interview: switch on **Phone or in-person interview**. Vren uses your microphone to hear the room.
4. Want the answers on the page instead? Switch on **Show answers on the page**. The side panel closes and a small box appears on the tab. It has Pause and Stop.

## What it can see

Only the tab you click the Vren icon on. It has no access to the other pages you open. The microphone needs your permission once, in a normal Chrome tab.

## Test

```sh
npm test         # logic tests
npm run typecheck
```
