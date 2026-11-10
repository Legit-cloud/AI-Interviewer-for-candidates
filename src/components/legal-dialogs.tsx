import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ReactNode } from "react";

export function PrivacyDialog({ trigger }: { trigger: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Privacy commitments</DialogTitle>
          <DialogDescription>
            How Vren AI handles audio, CVs, transcripts, and browser permissions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            <strong className="font-medium text-foreground">Raw audio is not retained.</strong> Live
            audio streams only while a session is active and is discarded immediately after
            transcription.
          </p>
          <p>
            <strong className="font-medium text-foreground">Explicit capture only.</strong> Capture
            never starts automatically. Tab audio and microphone permissions are separate toggles,
            with a visible Listening indicator and Stop control at all times.
          </p>
          <p>
            <strong className="font-medium text-foreground">Transcript retention is opt-in.</strong>{" "}
            Transcripts are off by default unless you enable retention for a session or in your
            workspace defaults.
          </p>
          <p>
            <strong className="font-medium text-foreground">No browsing history.</strong> Connecting
            the Chrome extension records only the connection timestamp and extension version.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TermsDialog({ trigger }: { trigger: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Terms & product boundaries</DialogTitle>
          <DialogDescription>
            Coaching guidance only, never candidate impersonation or hiring assessment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            <strong className="font-medium text-foreground">Coaching, not an assessment.</strong>{" "}
            Suggestions and post-session insights help you organise your own background and do not
            constitute an objective hiring evaluation.
          </p>
          <p>
            <strong className="font-medium text-foreground">Candidate truth.</strong> Vren AI cites
            only experience and skills you have verified and refuses to fabricate employment history
            or qualifications.
          </p>
          <p>
            <strong className="font-medium text-foreground">Respect meeting rules.</strong> You are
            responsible for ensuring interview coaching tools are permitted in your interview context.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

