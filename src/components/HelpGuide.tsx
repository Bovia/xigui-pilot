type Props = {
  open: boolean;
  quizName: string;
  onClose: () => void;
};

export default function HelpGuide({ open, quizName, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-slate-900/20 p-3"
      onClick={onClose}
    >
      <div
        className="panel-scroll max-h-[85%] w-full overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-slate-900">使用说明</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 text-xs leading-5 text-slate-600">
          <section>
            <div className="mb-1 font-medium text-slate-800">打开与关闭</div>
            <p>
              App 在屏幕<strong>顶部菜单栏</strong>，不在 Dock。点图标打开任务面板；取消固定后点击其他窗口会隐藏面板。设置里可「退出」完全关闭。
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">首次使用</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>设置 → 选择资料目录（如 Desktop/系规）</li>
              <li>设置 → 选择教材 PDF（官方带书签版）</li>
            </ol>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">课程按钮</div>
            <ul className="space-y-1">
              <li>
                <span className="font-medium text-blue-600">▶ 播放</span>
                ：内置播放器续播
              </li>
              <li>
                <span className="font-medium text-amber-600">书</span>
                ：Preview 打开教材并跳到对应页（页码来自 PDF 书签）
              </li>
              <li>
                <span className="font-medium text-emerald-600">题</span>
                ：复制小程序链接并打开微信（{quizName}）
              </li>
            </ul>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">教材跳页</div>
            <p>
              需在「系统设置 → 隐私与安全性 → 辅助功能」中允许<strong>系规助手</strong>。修改后请完全退出并重新打开 App。
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">更新视频</div>
            <p>
              把新视频放进对应文件夹（基础课 <code className="text-[11px]">01：…</code>，专题{" "}
              <code className="text-[11px]">02：…</code>），文件名保持{" "}
              <code className="text-[11px]">[编号]--标题.mp4</code>，然后在终端执行：
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              cd ~/Projects/xigui-pilot && pnpm gen:plan && ./scripts/update-desktop-app.sh
            </p>
            <p className="mt-1">
              已有观看进度按<strong>课节编号</strong>保存，编号不变的课进度会保留；专题课使用
              901 起的内部编号（界面显示为「专01」）。
            </p>
          </section>

          <section>
            <div className="mb-1 font-medium text-slate-800">更新 App</div>
            <p className="font-mono text-[11px] text-slate-500">
              cd ~/Projects/xigui-pilot && ./scripts/update-desktop-app.sh
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
