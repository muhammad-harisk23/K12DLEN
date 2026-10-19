import { useEffect, useRef, useState } from 'react';
import { Check, Download, Image as ImageIcon, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  achievementFilename,
  cardDimensions,
  renderAchievementPng,
  tryNativeShare,
  type AchievementData,
  type CardFormat,
} from '@/lib/achievementCanvas';

interface AchievementSharePanelProps {
  data: AchievementData;
  onClose: () => void;
}

export function AchievementSharePanel({ data, onClose }: AchievementSharePanelProps) {
  const [format, setFormat] = useState<CardFormat>('story');
  const [includeName, setIncludeName] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [shared, setShared] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtnRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Regenerate preview whenever inputs change
  useEffect(() => {
    let revoked = false;
    let prevUrl: string | null = null;
    setGenerating(true);
    setError(null);
    renderAchievementPng(data, { format, includeDisplayName: includeName })
      .then((blob) => {
        if (revoked) return;
        prevUrl = URL.createObjectURL(blob);
        setPreviewUrl(prevUrl);
      })
      .catch(() => {
        if (!revoked) setError('Could not generate the preview. Please try again.');
      })
      .finally(() => {
        if (!revoked) setGenerating(false);
      });
    return () => {
      revoked = true;
      if (prevUrl) URL.revokeObjectURL(prevUrl);
    };
  }, [data, format, includeName]);

  async function handleDownload() {
    if (!previewUrl) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await renderAchievementPng(data, { format, includeDisplayName: includeName });
      const filename = achievementFilename(data, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      window.setTimeout(() => setDownloaded(false), 3000);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleNativeShare() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await renderAchievementPng(data, { format, includeDisplayName: includeName });
      const filename = achievementFilename(data, format);
      const title = `K12Learn2Gether achievement — ${data.topicLabel}`;
      const didShare = await tryNativeShare(blob, filename, title);
      if (didShare) {
        setShared(true);
        window.setTimeout(() => setShared(false), 3000);
      } else {
        // Fallback to download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setDownloaded(true);
        window.setTimeout(() => setDownloaded(false), 3000);
      }
    } catch {
      setError('Sharing failed. Please try downloading instead.');
    } finally {
      setDownloading(false);
    }
  }

  const dims = cardDimensions(format);
  const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div
      className="celebration-overlay fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Share your achievement"
    >
      <div
        ref={panelRef}
        className="celebration-card relative w-full max-w-md overflow-hidden rounded-3xl border border-accent/20 bg-raised shadow-2xl"
      >
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Close share panel"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>

        <div className="p-6 sm:p-7">
          {/* Header */}
          <div className="text-center">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
              <ImageIcon className="h-5 w-5 text-accent-strong" aria-hidden />
            </span>
            <h2 className="mt-3 font-display text-xl font-bold text-ink">Share achievement</h2>
            <p className="mt-1 text-xs text-ink-soft">
              Download a high-resolution image for your story or post.
            </p>
          </div>

          {/* Preview */}
          <div className="mt-5 flex justify-center">
            <div
              className="overflow-hidden rounded-2xl border border-line bg-sunken"
              style={{ maxHeight: '280px' }}
            >
              {generating ? (
                <div className="flex h-[200px] w-[112px] items-center justify-center text-xs text-ink-faint sm:h-[240px] sm:w-[135px]">
                  <span className="animate-pulse">Generating…</span>
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt={`Achievement card preview — ${format === 'story' ? 'Story' : 'Square'} format`}
                  className="block max-h-[280px] w-auto"
                  style={{ maxWidth: '100%' }}
                />
              ) : (
                <div className="flex h-[200px] w-[112px] items-center justify-center text-xs text-red-600 sm:h-[240px] sm:w-[135px]">
                  Preview unavailable
                </div>
              )}
            </div>
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          {/* Format toggle */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Format
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormat('story')}
                className={`rounded-xl border px-4 py-3 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  format === 'story'
                    ? 'border-accent bg-accent-soft/50 shadow-sm'
                    : 'border-line bg-raised hover:border-accent/40'
                }`}
                aria-pressed={format === 'story'}
              >
                <span className="block text-sm font-semibold text-ink">Story</span>
                <span className="block text-xs text-ink-soft">1080 × 1920 · portrait</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('square')}
                className={`rounded-xl border px-4 py-3 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  format === 'square'
                    ? 'border-accent bg-accent-soft/50 shadow-sm'
                    : 'border-line bg-raised hover:border-accent/40'
                }`}
                aria-pressed={format === 'square'}
              >
                <span className="block text-sm font-semibold text-ink">Square</span>
                <span className="block text-xs text-ink-soft">1080 × 1080 · post</span>
              </button>
            </div>
          </div>

          {/* Privacy toggle */}
          <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-line bg-raised px-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">Include my display name</span>
              <span className="block text-xs text-ink-faint">Off by default — your identity stays private.</span>
            </span>
            <input
              type="checkbox"
              checked={includeName}
              onChange={(e) => setIncludeName(e.target.checked)}
              className="h-5 w-5 rounded border-line-strong text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              aria-label="Include my display name on the exported image"
            />
          </label>

          {/* Actions */}
          <div className="mt-5 space-y-2.5">
            <Button onClick={() => void handleDownload()} loading={downloading} className="w-full">
              {downloaded ? (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  Downloaded
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" aria-hidden />
                  Download PNG · {dims.width}×{dims.height}
                </>
              )}
            </Button>
            {hasNativeShare && (
              <Button variant="secondary" onClick={() => void handleNativeShare()} loading={downloading} className="w-full">
                {shared ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden />
                    Shared
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" aria-hidden />
                    Share via…
                  </>
                )}
              </Button>
            )}
          </div>

          <p className="mt-3 text-center text-[10px] text-ink-faint">
            Only your mission, score and topic are included. No email, account ID or private data.
          </p>
        </div>
      </div>
    </div>
  );
}
