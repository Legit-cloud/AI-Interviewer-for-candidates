
> Act as an expert Chrome Extension developer. I am building a discreet interview assistant overlay. I know Chrome extensions are sandboxed and cannot use native OS APIs (like SetWindowDisplayAffinity) to hide from full-desktop screen shares.
> I need you to write the manifest.json (V3), background script, and content script for an extension that does the following:
>  * WebSocket Connection: The background script connects to my WebSocket server (wss://[api.mywebapp.com/stream?pin=1234](https://api.mywebapp.com/stream?pin=1234)) and listens for incoming text tokens.
>  * DOM Injection (The Overlay): The content script injects a floating, semi-transparent div into the current webpage. It must have a maximum z-index so it floats above everything.
>  * Draggable Handle: The overlay needs a top bar that the user can click and drag to reposition the window around the screen.
>  * Click-Through Body: The main body of the overlay where the text appears must have pointer-events: none applied via CSS, so if the user accidentally clicks the text, the click passes through to the webpage behind it.
>  * Message Passing: When the background script receives WebSocket data, it forwards it to the content script to update the injected overlay in real-time.
> Provide the complete, minimal code structure to achieve this.
> 
