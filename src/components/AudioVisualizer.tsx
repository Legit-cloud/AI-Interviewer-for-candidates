import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface AudioVisualizerProps {
  tabAnalyser: AnalyserNode | null;
  micAnalyser: AnalyserNode | null;
  capturing: boolean;
  className?: string;
}

export function AudioVisualizer({ tabAnalyser, micAnalyser, capturing, className }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tabSpeaking, setTabSpeaking] = useState(false);
  const [micSpeaking, setMicSpeaking] = useState(false);
  const [tabRms, setTabRms] = useState(0);
  const [micRms, setMicRms] = useState(0);

  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Measure tab audio (Interviewer)
      let curTabRms = 0;
      let tabData: Uint8Array | null = null;
      if (tabAnalyser && capturing) {
        tabData = new Uint8Array(tabAnalyser.frequencyBinCount);
        tabAnalyser.getByteTimeDomainData(tabData);
        let sum = 0;
        for (let i = 0; i < tabData.length; i++) {
          const byteVal = tabData[i] ?? 128;
          const val = (byteVal - 128) / 128;
          sum += val * val;
        }
        curTabRms = Math.sqrt(sum / tabData.length);
      }

      // Measure mic audio (Candidate)
      let curMicRms = 0;
      let micData: Uint8Array | null = null;
      if (micAnalyser && capturing) {
        micData = new Uint8Array(micAnalyser.frequencyBinCount);
        micAnalyser.getByteTimeDomainData(micData);
        let sum = 0;
        for (let i = 0; i < micData.length; i++) {
          const byteVal = micData[i] ?? 128;
          const val = (byteVal - 128) / 128;
          sum += val * val;
        }
        curMicRms = Math.sqrt(sum / micData.length);
      }

      setTabRms(curTabRms);
      setMicRms(curMicRms);
      setTabSpeaking(curTabRms > 0.04);
      setMicSpeaking(curMicRms > 0.04);

      // Draw Waveforms on Canvas
      // Top half: Interviewer waveform (Emerald/Green)
      ctx.lineWidth = 2;
      ctx.strokeStyle = curTabRms > 0.04 ? "#10b981" : "#05966955";
      ctx.beginPath();

      const sliceWidth = width / (tabData ? tabData.length : 64);
      let x = 0;
      const topCenterY = height * 0.25;

      if (tabData && capturing) {
        for (let i = 0; i < tabData.length; i++) {
          const v = (tabData[i] ?? 128) / 128.0;
          const y = topCenterY + (v - 1) * (height * 0.2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
      } else {
        ctx.moveTo(0, topCenterY);
        ctx.lineTo(width, topCenterY);
      }
      ctx.stroke();

      // Bottom half: Candidate microphone waveform (Sky/Blue)
      ctx.lineWidth = 2;
      ctx.strokeStyle = curMicRms > 0.04 ? "#38bdf8" : "#0284c755";
      ctx.beginPath();

      x = 0;
      const bottomCenterY = height * 0.75;
      const micSliceWidth = width / (micData ? micData.length : 64);

      if (micData && capturing) {
        for (let i = 0; i < micData.length; i++) {
          const v = (micData[i] ?? 128) / 128.0;
          const y = bottomCenterY + (v - 1) * (height * 0.2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += micSliceWidth;
        }
      } else {
        ctx.moveTo(0, bottomCenterY);
        ctx.lineTo(width, bottomCenterY);
      }
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [tabAnalyser, micAnalyser, capturing]);

  return (
    <div className={cn("rounded-xl border border-border bg-card/60 p-4 backdrop-blur-sm", className)}>
      <div className="mb-3 flex items-center justify-between text-xs font-medium">
        {/* Interviewer status */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2.5 rounded-full transition-all duration-300",
              tabSpeaking
                ? "bg-emerald-500 shadow-[0_0_8px_#10b981]"
                : tabAnalyser
                  ? "bg-emerald-500/40"
                  : "bg-muted-foreground/30",
            )}
          />
          <span className={cn(tabSpeaking ? "text-emerald-400 font-semibold" : "text-muted-foreground")}>
            Interviewer (Meeting Audio)
          </span>
          {tabSpeaking && <span className="text-[10px] uppercase tracking-wide text-emerald-400">Speaking…</span>}
        </div>

        {/* Candidate status */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2.5 rounded-full transition-all duration-300",
              micSpeaking
                ? "bg-sky-400 shadow-[0_0_8px_#38bdf8]"
                : micAnalyser
                  ? "bg-sky-400/40"
                  : "bg-muted-foreground/30",
            )}
          />
          <span className={cn(micSpeaking ? "text-sky-300 font-semibold" : "text-muted-foreground")}>
            You (Microphone)
          </span>
          {micSpeaking && <span className="text-[10px] uppercase tracking-wide text-sky-400">Speaking…</span>}
        </div>
      </div>

      {/* Live Waveform Canvas */}
      <canvas
        ref={canvasRef}
        width={500}
        height={64}
        className="h-16 w-full rounded-lg bg-background/50 border border-border/40"
      />

      {/* Audio Level Meters */}
      <div className="mt-2.5 grid grid-cols-2 gap-4">
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Interviewer Volume</span>
            <span>{Math.round(tabRms * 100)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-75"
              style={{ width: `${Math.min(100, Math.round(tabRms * 300))}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Your Mic Volume</span>
            <span>{Math.round(micRms * 100)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-sky-400 transition-all duration-75"
              style={{ width: `${Math.min(100, Math.round(micRms * 300))}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

