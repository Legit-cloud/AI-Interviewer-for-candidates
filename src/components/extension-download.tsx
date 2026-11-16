import { Button } from "@/components/ui/button";

export const EXTENSION_ZIP = "/downloads/vren-ai-extension.zip";

/** Placeholder until the extension is on the Chrome Web Store. */
export function ExtensionDownload({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild>
          <a href={EXTENSION_ZIP} download>
            Download extension
          </a>
        </Button>
        <span className="text-muted-foreground">Chrome Web Store: coming soon</span>
      </div>
      {!compact && (
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Unzip the file.</li>
          <li>
            Open <code>chrome://extensions</code> and turn on Developer mode.
          </li>
          <li>Click Load unpacked and pick the unzipped folder.</li>
        </ol>
      )}
    </div>
  );
}
