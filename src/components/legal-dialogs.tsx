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
            An assistive tool only: it never speaks for you and is not a hiring assessment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            <strong className="font-medium text-foreground">Assistance, not an assessment.</strong>{" "}
            Answers and post-session insights help you present your own background and do not
            constitute an objective hiring evaluation. You choose what to say and remain responsible
            for it.
          </p>
          <p>
            <strong className="font-medium text-foreground">Natural, honest answers.</strong> Vren
            AI draws on your verified background when it fits and answers tough role questions
            clearly without fabricating fake employers or qualifications on your CV.
          </p>
          <p>
            <strong className="font-medium text-foreground">Respect meeting rules.</strong> You are
            responsible for ensuring assistive tools are permitted in your interview context. Vren
            AI cannot check this for you and does not hide itself from screen sharing or monitoring.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
