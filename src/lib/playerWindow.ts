import { LogicalSize, PhysicalSize } from "@tauri-apps/api/dpi";
import type { PhysicalSize as PhysicalSizeType } from "@tauri-apps/api/dpi";
import type { Window } from "@tauri-apps/api/window";

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 360;
const RESIZE_SETTLE_MS = 280;

export function bindPlayerWindowAspect(win: Window) {
  let aspectRatio: number | null = null;
  let adjusting = false;
  let lastSize: PhysicalSizeType | null = null;
  let resizeTimer: number | undefined;
  let unlistenResize: (() => void) | undefined;

  async function applyVideoAspect(videoWidth: number, videoHeight: number) {
    if (videoWidth <= 0 || videoHeight <= 0) return;

    aspectRatio = videoWidth / videoHeight;
    const width = DEFAULT_WIDTH;
    const height = Math.round(width / aspectRatio);

    await win.setMinSize(
      new LogicalSize(MIN_WIDTH, Math.max(1, Math.round(MIN_WIDTH / aspectRatio))),
    );

    adjusting = true;
    try {
      await win.setSize(new LogicalSize(width, height));
      lastSize = new PhysicalSize(width, height);
    } finally {
      adjusting = false;
    }
  }

  function snapSize(size: PhysicalSizeType) {
    if (!aspectRatio) return size;

    const dw = lastSize ? Math.abs(size.width - lastSize.width) : size.width;
    const dh = lastSize ? Math.abs(size.height - lastSize.height) : size.height;

    if (dw >= dh) {
      return new PhysicalSize(size.width, Math.round(size.width / aspectRatio));
    }
    return new PhysicalSize(Math.round(size.height * aspectRatio), size.height);
  }

  win
    .onResized(({ payload: size }) => {
      if (!aspectRatio || adjusting) return;

      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const next = snapSize(size);
        lastSize = next;

        if (
          Math.abs(size.width - next.width) <= 2 &&
          Math.abs(size.height - next.height) <= 2
        ) {
          return;
        }

        adjusting = true;
        win
          .setSize(next)
          .catch(() => undefined)
          .finally(() => {
            adjusting = false;
          });
      }, RESIZE_SETTLE_MS);
    })
    .then((fn) => {
      unlistenResize = fn;
    })
    .catch(() => undefined);

  return {
    applyVideoAspect,
    dispose: () => {
      window.clearTimeout(resizeTimer);
      unlistenResize?.();
    },
  };
}
