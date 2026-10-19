/*
 * Achievement card renderer — pure Canvas 2D, no external dependencies.
 *
 * Generates high-resolution PNGs for sharing on Instagram Story (1080×1920)
 * and social post (1080×1080). Uses only the existing K12Learn2Gether brand
 * palette and system-safe font stacks so the canvas is never tainted by
 * cross-origin images or fonts.
 */

export type CardFormat = 'story' | 'square';

export interface AchievementData {
  missionText: string;
  topicLabel: string;
  subjectName?: string;
  correct: number;
  total: number;
  attemptNumber?: number;
  completedAt?: string | null;
  displayName?: string;
}

export interface RenderOptions {
  format: CardFormat;
  includeDisplayName: boolean;
}

const COLORS = {
  surface: '#faf7f2',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#f1ece3',
  border: '#e6dfd3',
  borderStrong: '#d4cab8',
  ink: '#1f2937',
  inkSoft: '#4b5563',
  inkFaint: '#8b8478',
  accent: '#0d9488',
  accentStrong: '#0f766e',
  accentSoft: '#ccfbf1',
  success: '#16a34a',
} as const;

const FONT_DISPLAY = '"Sora", "Inter", system-ui, -apple-system, sans-serif';
const FONT_BODY = '"Inter", system-ui, -apple-system, sans-serif';

const STORY_W = 1080;
const STORY_H = 1920;
const SQUARE_W = 1080;
const SQUARE_H = 1080;

export function cardDimensions(format: CardFormat): { width: number; height: number } {
  return format === 'story' ? { width: STORY_W, height: STORY_H } : { width: SQUARE_W, height: SQUARE_H };
}

function roundRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Wraps text into lines that fit within maxWidth, using the current font.
 * Returns the array of lines (without truncation — long words are split).
 */
function wrapText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const metrics = ctx.measureText(candidate);
    if (metrics.width > maxWidth && current) {
      lines.push(current);
      // If a single word is wider than maxWidth, split it by characters.
      let chunk = word;
      while (ctx.measureText(chunk).width > maxWidth) {
        let cut = chunk.length - 1;
        while (cut > 0 && ctx.measureText(chunk.slice(0, cut)).width > maxWidth) cut--;
        if (cut <= 0) cut = 1;
        lines.push(chunk.slice(0, cut));
        chunk = chunk.slice(cut);
      }
      current = chunk;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function accuracyPct(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 100);
}

function formatCompletedDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function drawProgressArc(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  stroke: number,
  pct: number
) {
  // Background track
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = COLORS.surfaceSunken;
  ctx.lineWidth = stroke;
  ctx.stroke();

  // Progress arc — clamped to 100%
  const clamped = Math.max(0, Math.min(1, pct));
  if (clamped > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + clamped * Math.PI * 2);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = stroke;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function drawOrnamentDots(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  spread: number
) {
  for (let i = 0; i < count; i++) {
    const dx = (i - (count - 1) / 2) * spread;
    ctx.beginPath();
    ctx.arc(x + dx, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.accent;
    ctx.globalAlpha = 0.25 + (i % 2) * 0.1;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Renders the achievement card to a canvas context. Exported for testing
 * with OffscreenCanvas; the UI layer wraps this with a real <canvas>.
 */
export function renderAchievement(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  data: AchievementData,
  options: RenderOptions
): void {
  const { format, includeDisplayName } = options;
  const { width: W, height: H } = cardDimensions(format);

  // ---- Background: warm paper with subtle layered depth ----
  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(0, 0, W, H);

  // Soft top band
  const bandGrad = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  bandGrad.addColorStop(0, COLORS.accentSoft);
  bandGrad.addColorStop(1, 'rgba(204,251,241,0)');
  ctx.fillStyle = bandGrad;
  ctx.fillRect(0, 0, W, H * 0.4);

  // Inner card panel
  const margin = Math.round(W * 0.07);
  const cardX = margin;
  const cardY = margin;
  const cardW = W - margin * 2;
  const cardH = H - margin * 2;
  const cardR = Math.round(W * 0.04);

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.fillStyle = COLORS.surfaceRaised;
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ---- Layout positions ----
  const isStory = format === 'story';
  const centerX = W / 2;
  const topY = cardY + Math.round(cardH * 0.06);
  const pct = accuracyPct(data.correct, data.total);

  // ---- Background + inner card (drawn once, cleanly) ----
  const letterSpacing = Math.round(W * 0.004);
  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = bandGrad;
  ctx.fillRect(0, 0, W, H * 0.4);
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
  ctx.fillStyle = COLORS.surfaceRaised;
  ctx.fill();
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ---- Brand label (centered, uppercase, tracked — drawn character by character) ----
  ctx.font = `600 ${Math.round(W * 0.016)}px ${FONT_BODY}`;
  ctx.fillStyle = COLORS.accentStrong;
  const brandUpper = 'K12LEARN2GETHER';
  const charW = ctx.measureText('M').width;
  const totalBrandW = charW * brandUpper.length + letterSpacing * (brandUpper.length - 1);
  let bx = centerX - totalBrandW / 2;
  for (const ch of brandUpper) {
    ctx.textAlign = 'left';
    ctx.fillText(ch, bx, topY);
    bx += ctx.measureText(ch).width + letterSpacing;
  }

  // ---- Headline ----
  ctx.textAlign = 'center';
  const headlineSize = Math.round(W * (isStory ? 0.052 : 0.06));
  ctx.font = `700 ${headlineSize}px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLORS.ink;
  const headline = 'Knowledge looks good on you.';
  ctx.fillText(headline, centerX, topY + headlineSize * 1.4);

  // ---- Progress ring ----
  const ringY = isStory ? topY + Math.round(H * 0.22) : topY + Math.round(H * 0.18);
  const ringRadius = Math.round(W * (isStory ? 0.12 : 0.13));
  const ringStroke = Math.round(ringRadius * 0.12);

  drawProgressArc(ctx, centerX, ringY, ringRadius, ringStroke, data.total > 0 ? data.correct / data.total : 0);

  // Ring center text
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(ringRadius * 0.7)}px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(`${pct}%`, centerX, ringY + Math.round(ringRadius * 0.15));

  ctx.font = `500 ${Math.round(ringRadius * 0.22)}px ${FONT_BODY}`;
  ctx.fillStyle = COLORS.inkSoft;
  ctx.fillText(`${data.correct}/${data.total} correct`, centerX, ringY + Math.round(ringRadius * 0.42));

  // ---- Mission text (wrapped) ----
  const missionY = ringY + ringRadius + Math.round(H * (isStory ? 0.08 : 0.06));
  const maxMissionWidth = cardW - Math.round(W * 0.1);
  const missionFontSize = Math.round(W * (isStory ? 0.034 : 0.04));
  ctx.font = `700 ${missionFontSize}px ${FONT_DISPLAY}`;
  ctx.fillStyle = COLORS.ink;

  const missionLines = wrapText(ctx, data.missionText, maxMissionWidth);
  const missionLineH = missionFontSize * 1.3;
  for (let i = 0; i < missionLines.length; i++) {
    ctx.fillText(missionLines[i], centerX, missionY + i * missionLineH);
  }

  // ---- Topic + subject badge ----
  const badgeY = missionY + missionLines.length * missionLineH + Math.round(H * 0.03);
  const badgeText = data.subjectName ? `${data.subjectName} · ${data.topicLabel}` : data.topicLabel;
  ctx.font = `600 ${Math.round(W * 0.022)}px ${FONT_BODY}`;
  const badgePadX = Math.round(W * 0.025);
  const badgePadY = Math.round(W * 0.012);
  const badgeTextW = ctx.measureText(badgeText).width;
  const badgeW = badgeTextW + badgePadX * 2;
  const badgeH = Math.round(W * 0.045) + badgePadY;
  const badgeX = centerX - badgeW / 2;

  ctx.save();
  roundRect(ctx, badgeX, badgeY - badgeH + badgePadY, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = COLORS.accentSoft;
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.accentStrong;
  ctx.fillText(badgeText, centerX, badgeY);
  ctx.textBaseline = 'alphabetic';

  // ---- Optional attempt number ----
  let metaY = badgeY + Math.round(H * 0.04);
  if (data.attemptNumber && data.attemptNumber > 1) {
    ctx.font = `500 ${Math.round(W * 0.02)}px ${FONT_BODY}`;
    ctx.fillStyle = COLORS.inkFaint;
    ctx.fillText(`Attempt ${data.attemptNumber}`, centerX, metaY);
    metaY += Math.round(H * 0.03);
  }

  // ---- Optional completion date ----
  const dateStr = formatCompletedDate(data.completedAt ?? null);
  if (dateStr) {
    ctx.font = `500 ${Math.round(W * 0.02)}px ${FONT_BODY}`;
    ctx.fillStyle = COLORS.inkFaint;
    ctx.fillText(`Completed ${dateStr}`, centerX, metaY);
    metaY += Math.round(H * 0.03);
  }

  // ---- Optional display name ----
  if (includeDisplayName && data.displayName) {
    ctx.font = `600 ${Math.round(W * 0.024)}px ${FONT_BODY}`;
    ctx.fillStyle = COLORS.inkSoft;
    ctx.fillText(data.displayName, centerX, metaY);
    metaY += Math.round(H * 0.025);
  }

  // ---- Ornament dots ----
  const ornamentY = isStory ? cardY + cardH - Math.round(H * 0.08) : metaY + Math.round(H * 0.02);
  drawOrnamentDots(ctx, centerX, ornamentY, 5, Math.round(W * 0.03));

  // ---- Footer ----
  ctx.font = `500 ${Math.round(W * 0.016)}px ${FONT_BODY}`;
  ctx.fillStyle = COLORS.inkFaint;
  ctx.textAlign = 'center';
  ctx.fillText('Shared from K12Learn2Gether — real practice, real progress.', centerX, cardY + cardH - Math.round(H * 0.04));
}

/**
 * Renders the achievement to a PNG Blob using a real <canvas> element.
 * Falls back to OffscreenCanvas if no document is available (e.g. test env).
 */
export async function renderAchievementPng(
  data: AchievementData,
  options: RenderOptions
): Promise<Blob> {
  const { width, height } = cardDimensions(options.format);

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    (canvas as HTMLCanvasElement).width = width;
    (canvas as HTMLCanvasElement).height = height;
  } else {
    canvas = new OffscreenCanvas(width, height);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  renderAchievement(ctx, data, options);

  if (canvas instanceof HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('PNG generation failed'));
      }, 'image/png');
    });
  }
  // OffscreenCanvas
  return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
}

/**
 * Generates a safe filename for the download.
 */
export function achievementFilename(data: AchievementData, format: CardFormat): string {
  const slug = data.topicLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const fmt = format === 'story' ? 'story' : 'square';
  return `k12learn2gether-${slug}-${fmt}.png`;
}

/**
 * Attempts native Web Share with a real image file. Returns true if shared,
 * false if unsupported (caller should fall back to download).
 */
export async function tryNativeShare(blob: Blob, filename: string, title: string): Promise<boolean> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav || typeof nav.share !== 'function') return false;
  if (!nav.canShare) return false;
  const file = new File([blob], filename, { type: 'image/png' });
  const shareData = { files: [file], title, text: title };
  if (!nav.canShare(shareData)) return false;
  try {
    await nav.share(shareData);
    return true;
  } catch {
    // User cancelled or share failed — fall back
    return false;
  }
}
