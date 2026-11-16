/** Short, plain-language text for things the server or Chrome can say. */
export function plainReason(code: string | undefined): string {
  switch (code) {
    case "CAPTURE_CLIENT_ALREADY_CONNECTED":
      return "Another Vren app is already listening to this session.";
    case "PAIRING_REVOKED":
      return "You were disconnected from the website.";
    case "SESSION_ENDED":
      return "This session has ended.";
    case "SESSION_EXPIRED":
      return "This session ran out of time.";
    case undefined:
    case "":
      return "";
    default:
      return "The connection closed.";
  }
}

export function plainStartError(code: string | undefined): string {
  switch (code) {
    case "NO_SOUND":
      return "No sound was shared. In Chrome's window, tick “Share tab audio”.";
    case "CANCELLED":
      return "Nothing was picked. Press Start to try again.";
    case "NO_MIC":
      return "Your microphone is blocked. Allow it, then press Start.";
    default:
      return "Could not start. Click the Vren icon on your meeting tab and try again.";
  }
}
