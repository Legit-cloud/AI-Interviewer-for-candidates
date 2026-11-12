// A normal extension tab can show Chrome's microphone prompt. The side panel cannot, so the panel opens this page.
const msg = document.getElementById("msg") as HTMLElement;

document.getElementById("allow")?.addEventListener("click", async () => {
  msg.className = "";
  msg.textContent = "Waiting for you to allow it…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = "Done. Go back to your meeting tab and press Start again.";
    setTimeout(() => window.close(), 1200);
  } catch {
    msg.className = "err";
    msg.textContent = "The microphone is blocked. Click the lock icon in the address bar, allow the microphone, and try again.";
  }
});
