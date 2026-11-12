export interface TabEligibility {
  eligible: boolean;
  reason: string;
  hostLabel: string;
  isLikelyMeeting: boolean;
}

const BLOCKED_HOSTS = new Set([
  "chromewebstore.google.com",
  "chrome.google.com",
]);

const MEETING_HOST_PATTERNS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "webex.com",
  "whereby.com",
  "chime.aws",
  "coderpad.io",
  "hackerrank.com",
  "codesignal.com",
];

export function checkTabEligibility(url?: string | null): TabEligibility {
  if (!url) {
    return {
      eligible: false,
      reason: "Open an interview tab (Google Meet, Zoom web, Teams, or a browser call) before starting.",
      hostLabel: "No active tab URL",
      isLikelyMeeting: false,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      eligible: false,
      reason: "The current tab URL could not be read. Switch to your interview tab and retry.",
      hostLabel: "Unsupported tab",
      isLikelyMeeting: false,
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return {
      eligible: false,
      reason: `Chrome does not allow tab capture on ${protocol.replace(":", "")} pages. Pick an interview tab or Screen / Window mode.`,
      hostLabel: `${protocol.replace(":", "")} page`,
      isLikelyMeeting: false,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    return {
      eligible: false,
      reason: "Chrome restricts capture on Chrome Web Store pages. Pick your interview tab or Screen / Window mode.",
      hostLabel: host,
      isLikelyMeeting: false,
    };
  }

  const isLikelyMeeting = MEETING_HOST_PATTERNS.some(
    (pattern) => host === pattern || host.endsWith(`.${pattern}`),
  );

  return {
    eligible: true,
    reason: "Tab is ready for audio capture.",
    hostLabel: parsed.port ? `${host}:${parsed.port}` : host,
    isLikelyMeeting,
  };
}

