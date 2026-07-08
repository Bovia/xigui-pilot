import type { PlanSheetView } from "./types";

export const PLAN_VIEW_KEY = "xigui.planSheetView";
export const PLAN_VIEW_EVENT = "xigui-plan-view-changed";

export function readPlanSheetView(): PlanSheetView {
  try {
    const raw = localStorage.getItem(PLAN_VIEW_KEY);
    if (raw === "weekDaily" || raw === "wenOverview" || raw === "overview") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return "overview";
}

export function writePlanSheetView(view: PlanSheetView) {
  try {
    localStorage.setItem(PLAN_VIEW_KEY, view);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(PLAN_VIEW_EVENT, { detail: view }));
}

export function planVariantForView(view: PlanSheetView): "v2" | "wen" {
  return view === "wenOverview" ? "wen" : "v2";
}
