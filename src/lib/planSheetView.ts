import type { PlanSheetView } from "./types";

export const PLAN_VIEW_KEY = "xigui.planSheetView";
export const PLAN_VIEW_EVENT = "xigui-plan-view-changed";

/** 计划表已收敛为单一逐日视图 */
export function readPlanSheetView(): PlanSheetView {
  return "weekDaily";
}

export function writePlanSheetView(_view: PlanSheetView) {
  try {
    localStorage.setItem(PLAN_VIEW_KEY, "weekDaily");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(PLAN_VIEW_EVENT, { detail: "weekDaily" }));
}

export function planVariantForView(): "default" {
  return "default";
}
